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

    // 1) Create a Stripe Payment Link.
    // Unlike Checkout Sessions (which expire in 24h and use long `cs_…` tokens
    // that get truncated in SMS — producing "invalid token" errors), Payment
    // Links return a short `https://buy.stripe.com/…` URL that does not
    // expire, is SMS-friendly, and creates a fresh Checkout Session for the
    // driver on click. Metadata on the link is propagated onto the resulting
    // session and payment intent so the existing webhook handler still finds
    // `rental_id` and flips the reservation to active on payment.
    let linkUrl: string;
    let linkId: string;
    try {
      const stripe = createStripeClient(data.environment);
      const metadata: Record<string, string> = {
        kind: data.rentalId ? "first_payment" : "payment_link",
        ...(data.rentalId ? { rental_id: data.rentalId } : {}),
        ...(data.paymentId ? { payment_id: data.paymentId } : {}),
      };
      console.log("[sendPaymentLink] creating Stripe payment link", {
        environment: data.environment,
        amountCents: data.amountCents,
        rentalId: data.rentalId,
      });

      // Payment Links require a saved Price (not inline price_data), so we
      // mint a one-off product + price for this rental's first payment.
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
        // Propagate metadata to the Checkout Session and Payment Intent that
        // Stripe creates when the driver opens the link — the webhook reads
        // `session.metadata.rental_id` to activate the reservation.
        payment_intent_data: { metadata },
        ...(origin
          ? {
              after_completion: {
                type: "redirect" as const,
                redirect: { url: `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}` },
              },
            }
          : {}),
        // One-time use — driver can only pay once through this link.
        restrictions: { completed_sessions: { limit: 1 } },
      });

      if (!link.url) throw new Error("Stripe did not return a payment link URL");
      linkUrl = link.url;
      linkId = link.id;
      console.log("[sendPaymentLink] Stripe payment link created", {
        linkId,
        url: linkUrl,
        urlLength: linkUrl.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendPaymentLink] Stripe payment link create failed:", e);
      throw new Error(`Stripe payment link failed: ${msg}`);
    }

    // 2) Send via GHL SMS — short body to stay within a single SMS segment
    // so carriers don't truncate the URL.
    try {
      const amt = `$${(data.amountCents / 100).toFixed(2)}`;
      const msg = `Rentalprise Auto: ${amt} due. Pay: ${linkUrl}`;
      console.log("[sendPaymentLink] sending SMS via GHL", {
        linkId,
        bodyLength: msg.length,
      });
      await sendSms(data.phone, msg, data.name ?? null);
      console.log("[sendPaymentLink] SMS sent successfully");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[sendPaymentLink] GHL SMS send failed (Stripe session was created OK):", e);
      throw new Error(`SMS send failed (Stripe payment link ${linkId} created OK): ${msg}`);
    }

    return { ok: true, url: linkUrl };
  });