import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { getRequestHeader } from "@tanstack/react-start/server";
import { extractNameFromIdImage, uploadPayerIdImage } from "@/lib/payer-id-ocr.server";

// Card verification: when the renter says the payment card is NOT in their
// name, they must upload the card owner's ID before paying. We store the ID
// photo on the rental, flag it as a third-party payer, and try to OCR the
// cardholder name for staff review.
export const uploadCardOwnerId = createServerFn({ method: "POST" })
  .inputValidator((d: { rentalId: string; payerIdDataUrl: string; payerPhone?: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    if (!d?.payerIdDataUrl?.startsWith("data:image/")) throw new Error("Card owner's ID photo required");
    if (d.payerPhone && d.payerPhone.length > 30) throw new Error("Invalid payer phone");
    return d;
  })
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Reservation not found");

    const imageUrl = await uploadPayerIdImage(data.rentalId, data.payerIdDataUrl);
    const extractedName = await extractNameFromIdImage(data.payerIdDataUrl).catch(() => null);

    const { error: uErr } = await supabaseAdmin
      .from("rentals")
      .update({
        third_party_payer: true,
        payer_id_image_url: imageUrl,
        payer_name_extracted: extractedName,
        payer_phone: data.payerPhone?.trim() || null,
      })
      .eq("id", data.rentalId);
    if (uErr) throw new Error(uErr.message);

    console.log(`[card-verification] Card owner ID uploaded: ${imageUrl}${extractedName ? ` (name: ${extractedName})` : ""}`);
    return { ok: true as const, imageUrl, extractedName };
  });

// Public portal — keyed by the rental UUID, which the renter receives in the
// post-payment redirect URL. Returns just the data needed to show the
// reservation and payment status; no PII beyond what the renter already
// supplied themselves.
export const getRenterPortal = createServerFn({ method: "POST" })
  .inputValidator((d: { rentalId: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string" || d.rentalId.length > 100) {
      throw new Error("rentalId required");
    }
    return d;
  })
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select(
        "id, vehicle_id, driver_id, start_date, end_date, billing_period, rate, weekly_rate, payment_status, reservation_status, payment_received",
      )
      .eq("id", data.rentalId)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Reservation not found");

    const [{ data: vehicle }, { data: driver }, { data: pays }] = await Promise.all([
      supabaseAdmin
        .from("vehicles")
        .select("id, year, make, model, plate, image_url")
        .eq("id", rental.vehicle_id)
        .maybeSingle(),
      supabaseAdmin
        .from("drivers")
        .select("id, full_name, email, phone")
        .eq("id", rental.driver_id)
        .maybeSingle(),
      supabaseAdmin
        .from("payments")
        .select("id, amount, due_date, paid_date, method, status")
        .eq("rental_id", rental.id)
        .order("due_date", { ascending: true }),
    ]);

    return { rental, vehicle, driver, payments: pays ?? [] };
  });

// Mint a one-off Stripe Payment Link for a specific outstanding payment on
// this rental. Public — but we always look up the canonical amount from the
// DB so the renter can't supply their own price.
export const createRenterPaymentLink = createServerFn({ method: "POST" })
  .inputValidator((d: { rentalId: string; paymentId: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    if (!d?.paymentId || typeof d.paymentId !== "string") throw new Error("paymentId required");
    return d;
  })
  .handler(async ({ data }) => {
    const { data: payment, error: pErr } = await supabaseAdmin
      .from("payments")
      .select("id, rental_id, amount, status")
      .eq("id", data.paymentId)
      .eq("rental_id", data.rentalId)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!payment) throw new Error("Payment not found");
    if (payment.status === "paid") throw new Error("This payment is already paid");

    const amountCents = Math.max(50, Math.round(Number(payment.amount) * 100));
    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    if (originHeader) {
      try { origin = new URL(originHeader).origin; } catch { /* keep default */ }
    }

    const metadata = {
      kind: "renter_portal_payment",
      rental_id: payment.rental_id,
      payment_id: payment.id,
    };
    const product = await stripe.products.create({
      name: `Camauto Rentals — payment due`,
      metadata: { rental_id: payment.rental_id, payment_id: payment.id },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: amountCents,
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
                url: `${origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}&rental_id=${encodeURIComponent(payment.rental_id)}`,
              },
            },
          }
        : {}),
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");
    return { url: link.url };
  });