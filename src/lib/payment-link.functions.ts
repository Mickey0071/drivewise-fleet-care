import { createServerFn } from "@tanstack/react-start";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";
import { getRequestHeader } from "@tanstack/react-start/server";

export const sendPaymentLink = createServerFn({ method: "POST" })
  .inputValidator((d: {
    phone: string;
    name?: string;
    amountCents: number;
    description: string;
    environment: StripeEnv;
    rentalId?: string;
    paymentId?: string;
  }) => {
    if (!d.phone || typeof d.phone !== "string") throw new Error("phone required");
    if (!Number.isFinite(d.amountCents) || d.amountCents < 50) throw new Error("amount must be at least $0.50");
    if (!d.description || d.description.length > 200) throw new Error("description required (<=200 chars)");
    if (d.environment !== "sandbox" && d.environment !== "live") throw new Error("invalid environment");
    return d;
  })
  .handler(async ({ data }) => {
    // Pre-flight: confirm GHL secrets exist so we fail fast with a clear message.
    if (!process.env.ghlPitToken) {
      console.error("[sendPaymentLink] missing env ghlPitToken");
      throw new Error("SMS provider not configured: ghlPitToken secret is missing");
    }
    if (!process.env.ghlLocationId) {
      console.error("[sendPaymentLink] missing env ghlLocationId");
      throw new Error("SMS provider not configured: ghlLocationId secret is missing");
    }

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    if (originHeader) {
      try { origin = new URL(originHeader).origin; } catch { /* keep default */ }
    }

    // 1) Create Stripe Checkout session
    let sessionUrl: string;
    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: data.description },
            unit_amount: Math.round(data.amountCents),
          },
          quantity: 1,
        }],
        success_url: `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${origin}/rent/paid?canceled=1`,
        metadata: {
          kind: data.rentalId ? "first_payment" : "payment_link",
          ...(data.rentalId ? { rental_id: data.rentalId } : {}),
          ...(data.paymentId ? { payment_id: data.paymentId } : {}),
        },
      });
      if (!session.url) throw new Error("Stripe did not return a checkout URL");
      sessionUrl = session.url;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendPaymentLink] Stripe checkout create failed:", msg);
      throw new Error(`Stripe checkout failed: ${msg}`);
    }

    // 2) Send via GHL SMS
    try {
      const amt = `$${(data.amountCents / 100).toFixed(2)}`;
      const msg = `Rentalprise Auto: Please pay ${amt} for ${data.description}. Secure link: ${sessionUrl}`;
      await sendSms(data.phone, msg, data.name ?? null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendPaymentLink] GHL SMS send failed:", msg);
      throw new Error(`SMS send failed: ${msg}`);
    }

    return { ok: true, url: sessionUrl };
  });