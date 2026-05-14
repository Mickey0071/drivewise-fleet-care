import { createServerFn } from "@tanstack/react-start";
import { createStripeClient, type StripeEnv } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";

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
      success_url: "https://rentalprise.app/paid?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://rentalprise.app/paid?canceled=1",
      metadata: {
        kind: "payment_link",
        ...(data.rentalId ? { rental_id: data.rentalId } : {}),
        ...(data.paymentId ? { payment_id: data.paymentId } : {}),
      },
    });
    if (!session.url) throw new Error("Stripe did not return a checkout URL");
    const amt = `$${(data.amountCents / 100).toFixed(2)}`;
    const msg = `Rentalprise Auto: Please pay ${amt} for ${data.description}. Secure link: ${session.url}`;
    await sendSms(data.phone, msg, data.name ?? null);
    return { ok: true, url: session.url };
  });