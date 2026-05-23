import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { getRequestHeader } from "@tanstack/react-start/server";

/**
 * Renter-initiated custom payment. Only available for rentals owned by the
 * authenticated renter where the reservation is active or returned (i.e. the
 * initial payment has been made). Creates a one-off Stripe Payment Link and
 * returns its URL — the webhook records the payment row when paid.
 */
export const createCustomRenterPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; amount: number; note?: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    const amt = Number(d.amount);
    if (!Number.isFinite(amt)) throw new Error("Amount required");
    if (amt < 1) throw new Error("Minimum payment is $1");
    if (amt > 10000) throw new Error("Maximum payment is $10,000");
    const note = (d.note || "").trim();
    if (note.length > 200) throw new Error("Note too long (max 200 chars)");
    return { rentalId: d.rentalId, amount: amt, note };
  })
  .handler(async ({ data, context }) => {
    // Verify the rental belongs to the authenticated renter and is paid up
    // (i.e. status is active or returned).
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("driver_ref")
      .eq("id", context.userId)
      .maybeSingle();
    const driverId = profile?.driver_ref;
    if (!driverId) throw new Error("No renter profile linked to this account.");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, reservation_status")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental || rental.driver_id !== driverId) {
      throw new Error("Rental not found");
    }
    if (rental.reservation_status !== "active" && rental.reservation_status !== "returned") {
      throw new Error("Custom payments are only available after your rental is active.");
    }

    const amountCents = Math.round(data.amount * 100);
    const note = data.note || "Additional payment";
    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    if (originHeader) {
      try { origin = new URL(originHeader).origin; } catch { /* keep default */ }
    }

    const metadata = {
      kind: "custom_renter_payment",
      rental_id: rental.id,
      note: note.slice(0, 200),
    };
    const product = await stripe.products.create({
      name: `Camauto Rentals — ${note}`.slice(0, 250),
      metadata: { rental_id: rental.id },
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
                url: `${origin}/my-rentals/${encodeURIComponent(rental.id)}?paid=1`,
              },
            },
          }
        : {}),
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");
    return { url: link.url };
  });