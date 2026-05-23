import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";
import { getRequestHeader } from "@tanstack/react-start/server";

const ADMIN_PHONE = "+12672213977";

/**
 * Renter-initiated extension. Only available for weekly active rentals owned
 * by the authenticated renter. Creates a Stripe Payment Link for
 * (periods × weekly_rate). The webhook applies the extension on payment.
 */
export const requestRentalExtension = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string; periods: number }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    const n = Number(d.periods);
    if (!Number.isInteger(n) || n < 1 || n > 12) throw new Error("Periods must be 1–12");
    return { rentalId: d.rentalId, periods: n };
  })
  .handler(async ({ data, context }) => {
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("driver_ref").eq("id", context.userId).maybeSingle();
    const driverId = profile?.driver_ref;
    if (!driverId) throw new Error("No renter profile linked to this account.");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, reservation_status, billing_period, weekly_rate, rate, end_date")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!rental || rental.driver_id !== driverId) throw new Error("Rental not found");
    if (rental.reservation_status !== "active") {
      throw new Error("Extensions are only available for active rentals.");
    }
    if ((rental.billing_period || "weekly") !== "weekly") {
      throw new Error("Extensions are only available for weekly rentals.");
    }

    const weeklyRate = Number(rental.rate ?? rental.weekly_rate ?? 0);
    if (weeklyRate <= 0) throw new Error("Rental rate is not set.");
    const amountCents = Math.round(weeklyRate * data.periods * 100);

    const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
    const stripe = createStripeClient(env);

    const originHeader = getRequestHeader("origin") || getRequestHeader("referer");
    let origin = process.env.PUBLIC_APP_ORIGIN ?? "";
    if (originHeader) { try { origin = new URL(originHeader).origin; } catch {} }

    const metadata = {
      kind: "renter_extension",
      rental_id: rental.id,
      periods: String(data.periods),
    };
    const product = await stripe.products.create({
      name: `Camauto Rentals — Extend ${data.periods} week${data.periods === 1 ? "" : "s"}`.slice(0, 250),
      metadata: { rental_id: rental.id },
    });
    const price = await stripe.prices.create({
      product: product.id, currency: "usd", unit_amount: amountCents,
    });
    const link = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata,
      payment_intent_data: { metadata },
      ...(origin ? {
        after_completion: {
          type: "redirect" as const,
          redirect: { url: `${origin}/my-rentals/${encodeURIComponent(rental.id)}?paid=1` },
        },
      } : {}),
      restrictions: { completed_sessions: { limit: 1 } },
    });
    if (!link.url) throw new Error("Stripe did not return a payment link URL");
    return { url: link.url, amountCents };
  });

/**
 * Admin/VA-only cancellation of a rental. Cancels immediately, frees the
 * vehicle, and SMSes the renter.
 */
export const cancelRentalByAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { rentalId: string }) => {
    if (!d?.rentalId || typeof d.rentalId !== "string") throw new Error("rentalId required");
    return d;
  })
  .handler(async ({ data, context }) => {
    // Authorize: admin or runner (VA) only.
    const { data: roles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", context.userId);
    const allowed = (roles ?? []).some((r) => r.role === "admin" || r.role === "runner" || r.role === "va");
    if (!allowed) throw new Error("Not authorized");

    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id, reservation_status")
      .eq("id", data.rentalId).maybeSingle();
    if (!rental) throw new Error("Rental not found");
    if (rental.reservation_status === "cancelled" || rental.reservation_status === "returned") {
      throw new Error(`Rental is already ${rental.reservation_status}`);
    }

    const nowIso = new Date().toISOString();
    await supabaseAdmin.from("rentals").update({
      reservation_status: "cancelled",
      returned_at: nowIso,
      updated_at: nowIso,
    }).eq("id", rental.id);

    if (rental.vehicle_id) {
      await supabaseAdmin.from("vehicles").update({ status: "available" }).eq("id", rental.vehicle_id);
    }

    // Notify the renter.
    const { data: drv } = await supabaseAdmin
      .from("drivers").select("full_name, phone").eq("id", rental.driver_id).maybeSingle();
    if (drv?.phone) {
      try {
        await sendSms(drv.phone, "Camauto Rentals: Your rental has been canceled. Contact us at 1-866-625-5550 with any questions.", drv.full_name);
      } catch (e) { console.error("[cancelRentalByAdmin] renter SMS failed", e); }
    }
    try {
      await sendSms(ADMIN_PHONE, `Rental ${rental.id} canceled by admin/VA.`, null);
    } catch {}

    return { ok: true };
  });