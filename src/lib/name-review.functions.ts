import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createStripeClient } from "@/lib/stripe.server";
import { sendSms } from "@/lib/ghl.server";

async function assertAdmin(userId: string) {
  const { data: roles } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  const isAdmin = (roles ?? []).some((r: any) => r.role === "admin");
  if (!isAdmin) throw new Error("Only admins can manage payment reviews");
}

/** Refund the latest succeeded PaymentIntent for a Stripe customer. */
async function refundCustomerLatest(customerId: string, amount: number) {
  const env = process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox";
  const stripe = createStripeClient(env);
  const amountCents = Math.round(amount * 100);
  const list = await stripe.paymentIntents.list({ customer: customerId, limit: 25 });
  const candidate = list.data.find((pi) => {
    if (pi.status !== "succeeded") return false;
    const refundable = (pi.amount_received ?? pi.amount) - ((pi as any).amount_refunded ?? 0);
    return refundable >= amountCents;
  });
  if (!candidate) throw new Error("No matching succeeded payment found to refund in Stripe.");
  await stripe.refunds.create({ payment_intent: candidate.id, amount: amountCents });
}

export const listNameReviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.userId);

    const [{ data: rentals }, { data: exts }] = await Promise.all([
      supabaseAdmin
        .from("rentals")
        .select("id, driver_id, cardholder_name, name_match_score, updated_at")
        .eq("name_match_status", "pending_review")
        .order("updated_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("extension_requests")
        .select("id, rental_id, cardholder_name, name_match_score, additional_amount, paid_at")
        .eq("name_match_status", "pending_review")
        .order("paid_at", { ascending: false })
        .limit(100),
    ]);

    const driverIds = new Set<string>();
    (rentals ?? []).forEach((r: any) => r.driver_id && driverIds.add(r.driver_id));
    const extRentalIds = (exts ?? []).map((e: any) => e.rental_id).filter(Boolean);
    let extRentalMap: Record<string, string> = {};
    if (extRentalIds.length) {
      const { data: er } = await supabaseAdmin
        .from("rentals").select("id, driver_id").in("id", extRentalIds);
      (er ?? []).forEach((r: any) => {
        extRentalMap[r.id] = r.driver_id;
        if (r.driver_id) driverIds.add(r.driver_id);
      });
    }
    let driverMap: Record<string, string> = {};
    if (driverIds.size) {
      const { data: drivers } = await supabaseAdmin
        .from("drivers").select("id, full_name").in("id", Array.from(driverIds));
      driverMap = Object.fromEntries((drivers ?? []).map((d: any) => [d.id, d.full_name]));
    }

    const items = [
      ...(rentals ?? []).map((r: any) => ({
        kind: "rental" as const,
        id: r.id,
        ref: r.id,
        renter_name: driverMap[r.driver_id] ?? r.driver_id,
        card_name: r.cardholder_name ?? "—",
        score: r.name_match_score ?? 0,
        pending_since: r.updated_at,
      })),
      ...(exts ?? []).map((e: any) => ({
        kind: "extension" as const,
        id: e.id,
        ref: e.rental_id,
        renter_name: driverMap[extRentalMap[e.rental_id] ?? ""] ?? e.rental_id,
        card_name: e.cardholder_name ?? "—",
        score: e.name_match_score ?? 0,
        pending_since: e.paid_at,
      })),
    ];
    return { items };
  });

export const resolveNameReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { kind: "rental" | "extension"; id: string; action: "approve" | "refund" }) => {
    if (d?.kind !== "rental" && d?.kind !== "extension") throw new Error("Invalid kind");
    if (!d?.id || typeof d.id !== "string") throw new Error("id required");
    if (d?.action !== "approve" && d?.action !== "refund") throw new Error("Invalid action");
    return d;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.userId);

    // Resolve the rental + driver for SMS + refund.
    let rentalId: string;
    let refundAmount = 0;
    if (data.kind === "rental") {
      rentalId = data.id;
    } else {
      const { data: ext } = await supabaseAdmin
        .from("extension_requests")
        .select("rental_id, additional_amount")
        .eq("id", data.id)
        .maybeSingle();
      if (!ext) throw new Error("Extension not found");
      rentalId = ext.rental_id;
      refundAmount = Number(ext.additional_amount) || 0;
    }
    const { data: rental } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, stripe_customer_id, final_charge_amount, weekly_rate, rate")
      .eq("id", rentalId)
      .maybeSingle();
    if (!rental) throw new Error("Rental not found");
    const { data: driver } = await supabaseAdmin
      .from("drivers").select("full_name, phone").eq("id", rental.driver_id).maybeSingle();

    const table = data.kind === "rental" ? "rentals" : "extension_requests";

    if (data.action === "approve") {
      await supabaseAdmin.from(table).update({ name_match_status: "approved" }).eq("id", data.id);
      if (driver?.phone) {
        try {
          await sendSms(driver.phone, "Camauto Rentals: Your payment has been approved. Thank you!", driver.full_name ?? null);
        } catch (e) { console.error("[resolveNameReview] approve SMS failed", e); }
      }
      return { ok: true, status: "approved" as const };
    }

    // Refund path.
    if (!rental.stripe_customer_id) throw new Error("No Stripe customer on file — cannot refund.");
    if (data.kind === "rental") {
      refundAmount = Number(rental.weekly_rate) || Number(rental.rate) || Number(rental.final_charge_amount) || 0;
    }
    if (refundAmount <= 0) throw new Error("Could not determine refund amount.");
    await refundCustomerLatest(rental.stripe_customer_id, refundAmount);
    await supabaseAdmin
      .from(table)
      .update({ name_match_status: "refunded_manual_review" })
      .eq("id", data.id);
    if (driver?.phone) {
      try {
        await sendSms(driver.phone, "Camauto Rentals: Your payment was declined and refunded. Please contact us.", driver.full_name ?? null);
      } catch (e) { console.error("[resolveNameReview] refund SMS failed", e); }
    }
    return { ok: true, status: "refunded_manual_review" as const };
  });