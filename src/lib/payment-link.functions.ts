import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";
import { getRequestHeader } from "@tanstack/react-start/server";

export interface PaymentLinkInput {
  phone: string;
  name?: string;
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
export async function sendPaymentLinkInternal(data: PaymentLinkInput): Promise<{ ok: true; url: string }> {
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
  const price = await stripe.prices.create({
    product: product.id,
    currency: "usd",
    unit_amount: Math.round(data.amountCents),
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata,
    payment_intent_data: { metadata },
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
  const msg = `Rentalprise Auto: ${amt} due. Pay: ${link.url}`;
  await sendSms(data.phone, msg, data.name ?? null);

  return { ok: true, url: link.url };
}

export const sendPaymentLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: PaymentLinkInput) => {
    if (!d.phone || typeof d.phone !== "string") throw new Error("phone required");
    if (!Number.isFinite(d.amountCents) || d.amountCents < 50) throw new Error("amount must be at least $0.50");
    if (!d.description || d.description.length > 200) throw new Error("description required (<=200 chars)");
    if (d.environment !== "sandbox" && d.environment !== "live") throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }) => {
    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    if (originHeader) {
      try { origin = new URL(originHeader).origin; } catch { /* keep default */ }
    }
    console.log("[sendPaymentLink] creating Stripe payment link", {
      environment: data.environment,
      amountCents: data.amountCents,
      rentalId: data.rentalId,
    });
    try {
      const result = await sendPaymentLinkInternal({ ...data, origin });
      console.log("[sendPaymentLink] payment link sent", { url: result.url });
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendPaymentLink] failed:", e);
      throw new Error(msg);
    }
  });