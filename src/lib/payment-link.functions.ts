import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { getRequestHeader } from "@tanstack/react-start/server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface PaymentLinkInput {
  phone: string;
  name?: string;
  email?: string | null;
  amountCents: number;
  description: string;
  environment: StripeEnv;
  rentalId?: string;
  paymentId?: string;
  origin?: string;
  customMessage?: string;
  reason?: string;
  sendSms?: boolean;
  sendEmail?: boolean;
  /** When true, the renter chooses the amount at checkout (pay-what-you-can). */
  customerChoosesAmount?: boolean;
  /** Minimum amount (cents) the renter must pay when choosing their own amount. */
  minAmountCents?: number;
}

/**
 * Internal helper that creates a Stripe Payment Link and texts it to the
 * renter. Has NO auth — only call from trusted server contexts (e.g. the
 * public signing endpoint after we've verified a valid sign_token).
 */
export async function sendPaymentLinkInternal(
  data: PaymentLinkInput,
): Promise<{ ok: true; url: string }> {
  if (!process.env.ghlPitToken) {
    throw new Error("SMS provider not configured: ghlPitToken secret is missing");
  }
  if (!process.env.ghlLocationId) {
    throw new Error("SMS provider not configured: ghlLocationId secret is missing");
  }

  const origin = data.origin || process.env.PUBLIC_APP_ORIGIN || "";

  const stripe = createStripeClient(data.environment);
  const metadata: Record<string, string> = {
    kind: data.rentalId ? "first_payment" : "payment_link",
    ...(data.rentalId ? { rental_id: data.rentalId } : {}),
    ...(data.paymentId ? { payment_id: data.paymentId } : {}),
  };

  const product = await stripe.products.create({
    name: data.description.slice(0, 250),
    ...(data.rentalId ? { metadata: { rental_id: data.rentalId } } : {}),
  });
  const price = data.customerChoosesAmount
    ? await stripe.prices.create({
        product: product.id,
        currency: "usd",
        custom_unit_amount: {
          enabled: true,
          preset: Math.round(data.amountCents),
          minimum: Math.max(50, Math.round(data.minAmountCents ?? 100)),
        },
      })
    : await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: Math.round(data.amountCents),
      });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    customer_creation: "always",
    payment_intent_data: { metadata, setup_future_usage: "off_session" },
    ...(origin
      ? {
          after_completion: {
            type: "redirect" as const,
            redirect: {
              url: data.rentalId
                ? `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}&rental_id=${encodeURIComponent(data.rentalId)}`
                : `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}`,
            },
          },
        }
      : {}),
    restrictions: { completed_sessions: { limit: 1 } },
  });

  if (!link.url) throw new Error("Stripe did not return a payment link URL");

  const amt = `$${(data.amountCents / 100).toFixed(2)}`;
  const custom = (data.customMessage || "").trim();
  const msg = custom
    ? `${custom} Pay: ${link.url}`
    : data.customerChoosesAmount
      ? `Camauto Rentals: Pay any amount toward your balance: ${link.url}`
      : `Camauto Rentals: ${amt} due. Pay: ${link.url}`;
  // Default both channels on when neither flag is provided (back-compat).
  const wantSms = data.sendSms !== false;
  const wantEmail = data.sendEmail !== false;
  await notifyRenter({
    phone: wantSms ? data.phone : null,
    email: wantEmail ? (data.email ?? null) : null,
    name: data.name ?? null,
    sms: msg,
    emailSubject: "Complete Your Payment — Camauto Rentals",
    emailHeading: "Complete Your Payment",
    emailIntro: custom
      ? `${custom}<br/><br/>Tap the button below to pay <strong>${amt}</strong> securely via Stripe.`
      : `Your payment of <strong>${amt}</strong> is ready. Tap the button below to pay securely via Stripe.`,
    emailCta: { label: `Pay ${amt} Now`, url: link.url },
    emailDetails: [
      { label: "Amount Due", value: amt },
      { label: "Description", value: data.description },
    ],
    emailFootnote:
      "This link is single-use. If you have any trouble, reply to this email or call us.",
  });

  return { ok: true, url: link.url };
}

export const sendPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PaymentLinkInput) => {
    if (!d.phone || typeof d.phone !== "string") throw new Error("phone required");
    if (!Number.isFinite(d.amountCents) || d.amountCents < 50)
      throw new Error("amount must be at least $0.50");
    if (!d.description || d.description.length > 200)
      throw new Error("description required (<=200 chars)");
    if (d.environment !== "sandbox" && d.environment !== "live")
      throw new Error("invalid environment");
    if (d.customMessage && d.customMessage.length > 300)
      throw new Error("custom message too long (<=300 chars)");
    return d;
  })
  .handler(async ({ data }) => {
    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    if (originHeader) {
      try {
        origin = new URL(originHeader).origin;
      } catch {
        /* keep default */
      }
    }
    console.log("[sendPaymentLink] creating Stripe payment link", {
      environment: data.environment,
      amountCents: data.amountCents,
      rentalId: data.rentalId,
    });
    try {
      const result = await sendPaymentLinkInternal({ ...data, origin });
      console.log("[sendPaymentLink] payment link sent", { url: result.url });
      // Record the send in the payment link history.
      if (data.rentalId) {
        const channels: string[] = [];
        if (data.sendSms !== false) channels.push("sms");
        if (data.sendEmail !== false) channels.push("email");
        try {
          await supabaseAdmin.from("payment_link_logs").insert({
            rental_id: data.rentalId,
            amount_cents: Math.round(data.amountCents),
            reason: data.reason ?? null,
            channels,
            link_url: result.url,
            custom_message: data.customMessage ?? null,
          });
        } catch (e) {
          console.error("[sendPaymentLink] failed to log:", e);
        }
      }
      // Mark the rental as reviewed by staff — clears the dashboard badge.
      if (data.rentalId) {
        try {
          await supabaseAdmin
            .from("rentals")
            .update({ staff_review_status: "reviewed" })
            .eq("id", data.rentalId);
        } catch (e) {
          console.error("[sendPaymentLink] failed to mark reviewed:", e);
        }
      }
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendPaymentLink] failed:", e);
      throw new Error(msg);
    }
  });

export interface PaymentLinkLog {
  id: string;
  rentalId: string;
  amountCents: number;
  reason: string | null;
  channels: string[];
  createdAt: string;
}

export const getPaymentLinkLogs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string }) => {
    if (!d.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    return d;
  })
  .handler(async ({ data }): Promise<PaymentLinkLog[]> => {
    const { data: rows, error } = await supabaseAdmin
      .from("payment_link_logs")
      .select("id, rental_id, amount_cents, reason, channels, created_at")
      .eq("rental_id", data.rentalId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      rentalId: r.rental_id as string,
      amountCents: r.amount_cents as number,
      reason: (r.reason as string | null) ?? null,
      channels: (r.channels as string[]) ?? [],
      createdAt: r.created_at as string,
    }));
  });
