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

  // For rental (first / deposit) payments, route the renter to our own
  // verification page first instead of straight to Stripe. The verification
  // page asks "Is the card in your name?" and mints the Stripe link itself
  // (via createRenterPaymentLink) once the renter is ready to pay.
  if (data.rentalId) {
    if (!origin) {
      throw new Error("App origin not configured: cannot build verification link");
    }
    const verifyUrl = `${origin}/verify-payment/${encodeURIComponent(data.rentalId)}`;
    const amt = `$${(data.amountCents / 100).toFixed(2)}`;
    const msg = `Camauto Rentals: ${amt} due. Complete your payment: ${verifyUrl}`;
    await notifyRenter({
      phone: data.phone,
      email: data.email ?? null,
      name: data.name ?? null,
      sms: msg,
      emailSubject: "Complete Your Payment — Camauto Rentals",
      emailHeading: "Complete Your Payment",
      emailIntro: `Your payment of <strong>${amt}</strong> is ready. Tap the button below to verify and pay securely.`,
      emailCta: { label: `Verify & Pay ${amt}`, url: verifyUrl },
      emailDetails: [
        { label: "Amount Due", value: amt },
        { label: "Description", value: data.description },
      ],
      emailFootnote:
        "You'll confirm a quick card-ownership question before paying. If you have any trouble, reply to this email or call us.",
    });
    return { ok: true, url: verifyUrl };
  }

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
  const price = await stripe.prices.create({
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
  const msg = `Camauto Rentals: ${amt} due. Pay: ${link.url}`;
  await notifyRenter({
    phone: data.phone,
    email: data.email ?? null,
    name: data.name ?? null,
    sms: msg,
    emailSubject: "Complete Your Payment — Camauto Rentals",
    emailHeading: "Complete Your Payment",
    emailIntro: `Your payment of <strong>${amt}</strong> is ready. Tap the button below to pay securely via Stripe.`,
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
