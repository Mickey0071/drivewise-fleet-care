import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { sendReceiptToCustomer } from "@/lib/receipt.functions";
import { syncVehicleAvailabilityToGhl } from "@/lib/ghl-vehicle-sync.server";

function inclusiveDaysBetween(startIso: string, endIso: string): number {
  const MS = 24 * 60 * 60 * 1000;
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sUtc = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const eUtc = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  return Math.max(1, Math.floor((eUtc - sUtc) / MS) + 1);
}
function fmtMoney(n: number) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Admin-only override: close out a rental without going through the
 * normal return-inspection workflow. Logs who did it + when in
 * rentals.notes and rentals.final_charge_breakdown.
 */
export const adminOverrideReturn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { rental_id: string }) =>
    z.object({ rental_id: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { userId } = context;

    // Verify caller is an admin (NOT runner / driver / va).
    const { data: roleRows, error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId);
    if (roleErr) throw new Error(roleErr.message);
    const isAdmin = (roleRows ?? []).some((r) => r.role === "admin");
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    // Look up actor name for the audit trail.
    const { data: actorProfile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();
    const actorLabel =
      actorProfile?.full_name?.trim() ||
      actorProfile?.email ||
      userId;

    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id, returned_at, reservation_status, notes, final_charge_breakdown, start_date, activated_at, signed_at, created_at, billing_period, billing_cadence, rate, weekly_rate, rate_amount, skip_daily_minimum")
      .eq("id", data.rental_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Rental not found");

    if (
      rental.returned_at &&
      (rental.reservation_status === "returned" ||
        rental.reservation_status === "completed")
    ) {
      if (rental.reservation_status !== "returned") {
        const { data: repairedRental, error: repairErr } = await supabaseAdmin
          .from("rentals")
          .update({ reservation_status: "returned" })
          .eq("id", rental.id)
          .select("id, reservation_status")
          .maybeSingle();
        if (repairErr) throw new Error(`Failed to repair returned status: ${repairErr.message}`);
        if (!repairedRental || repairedRental.reservation_status !== "returned") {
          throw new Error("Failed to repair returned status: update did not persist");
        }
      }
      await supabaseAdmin
        .from("vehicles")
        .update({ status: "available" })
        .eq("id", rental.vehicle_id);
      try { await syncVehicleAvailabilityToGhl(rental.vehicle_id); } catch (e) { console.error("[admin-override-return] ghl sync failed", e); }
      return { ok: true, alreadyReturned: true as const };
    }

    const nowIso = new Date().toISOString();
    const stamp = `[${nowIso}] Admin override return by ${actorLabel} (no inspection)`;
    const newNotes = rental.notes ? `${rental.notes}\n${stamp}` : stamp;

    // ---- Compute the final charge from the actual rate/cadence ----
    const rawCadence = (rental.billing_cadence as string | null)
      ?? (rental.billing_period as string | null)
      ?? "weekly";
    const cadence: "daily" | "weekly" =
      rawCadence.toLowerCase().startsWith("day") ? "daily" : "weekly";
    const rawRate = rental.rate_amount ?? rental.rate
      ?? (cadence === "weekly" ? rental.weekly_rate : null);
    const rate = rawRate != null ? Number(rawRate) : null;
    const startIso = (rental.activated_at as string | null)
      ?? (rental.start_date as string | null)
      ?? (rental.signed_at as string | null)
      ?? (rental.created_at as string | null);
    const daysUsed = startIso ? inclusiveDaysBetween(startIso, nowIso) : 1;
    let finalCharge: number | null = null;
    let periodsBilled = 0;
    if (rate != null && Number.isFinite(rate)) {
      if (cadence === "daily") {
        const minPeriods = rental.skip_daily_minimum ? 1 : 2;
        periodsBilled = Math.max(daysUsed, minPeriods);
      } else {
        periodsBilled = Math.max(1, Math.ceil(daysUsed / 7));
      }
      finalCharge = +(periodsBilled * rate).toFixed(2);
    }

    const prevBreakdown =
      (rental.final_charge_breakdown as Record<string, unknown> | null) ?? {};
    const breakdown = {
      ...prevBreakdown,
      admin_override: true,
      admin_override_by: actorLabel,
      admin_override_user_id: userId,
      admin_override_at: nowIso,
      actual_return: nowIso,
      start_date: startIso,
      days_used: daysUsed,
      billing_cadence: cadence,
      rate_amount: rate,
      periods_billed: periodsBilled,
      final_charge: finalCharge,
    };

    const { data: updatedRental, error: upErr } = await supabaseAdmin
      .from("rentals")
      .update({
        returned_at: nowIso,
        reservation_status: "returned",
        notes: newNotes,
        final_charge_breakdown: breakdown,
        final_charge_amount: finalCharge,
      })
      .eq("id", rental.id)
      .select("id, reservation_status, returned_at")
      .maybeSingle();
    if (upErr) throw new Error(`Failed to close out rental: ${upErr.message}`);
    if (!updatedRental || updatedRental.reservation_status !== "returned") {
      throw new Error("Failed to close out rental: returned status did not persist");
    }

    // Flip vehicle back to available immediately after the rental is returned.
    const { data: updatedVehicle, error: vehicleErr } = await supabaseAdmin
      .from("vehicles")
      .update({ status: "available" })
      .eq("id", rental.vehicle_id)
      .select("id, status")
      .maybeSingle();
    if (vehicleErr) throw new Error(`Failed to mark vehicle available: ${vehicleErr.message}`);
    if (!updatedVehicle || updatedVehicle.status !== "available") {
      throw new Error("Failed to mark vehicle available after return");
    }
    try { await syncVehicleAvailabilityToGhl(rental.vehicle_id); } catch (e) { console.error("[admin-override-return] ghl sync failed", e); }

    // Log charge + deliver SMS/email receipt (best-effort).
    let smsStatus: "sent" | "skipped_no_phone" | "failed" | "skipped_no_charge" = "skipped_no_phone";
    if (finalCharge != null) {
      try {
        await supabaseAdmin.from("rental_charges").insert({
          rental_id: rental.id,
          amount: finalCharge,
          charge_date: nowIso,
          period_label: cadence === "daily" ? "day" : "week",
          status: "recorded",
          environment: process.env.STRIPE_LIVE_API_KEY ? "live" : "sandbox",
        } as any);
      } catch (e) {
        console.error(`[admin-override-return] rental_charges insert failed:`, e);
      }
    } else {
      smsStatus = "skipped_no_charge";
    }
    try {
      const { data: driver } = await supabaseAdmin
        .from("drivers")
        .select("phone, full_name, email")
        .eq("id", rental.driver_id)
        .maybeSingle();
      if (driver?.phone && finalCharge != null) {
        const unit = cadence === "daily" ? "day" : "week";
        const dayWord = daysUsed === 1 ? "day" : "days";
        try {
          await notifyRenter({
            phone: driver.phone,
            email: driver.email ?? null,
            name: driver.full_name ?? null,
            sms: `Camauto Receipt: Rental returned. ${fmtMoney(finalCharge)}. ${daysUsed} ${dayWord} @ ${fmtMoney(rate ?? 0)}/${unit}. Thanks for renting with us.`,
            emailSubject: "Your Camauto Rental Receipt",
            emailHeading: "Rental Returned — Receipt",
            emailIntro: "Thank you for renting with Camauto. Your rental has been returned and the final charges are summarized below.",
            emailDetails: [
              { label: "Final Charge", value: fmtMoney(finalCharge) },
              { label: "Billing", value: `${daysUsed} ${dayWord} @ ${fmtMoney(rate ?? 0)}/${unit}` },
              { label: "Periods Billed", value: `${periodsBilled} ${unit}${periodsBilled === 1 ? "" : "s"}` },
            ],
          });
          smsStatus = "sent";
        } catch (e) {
          smsStatus = "failed";
          console.error(
            `[admin-override-return] rental=${rental.id} notify FAILED:`,
            e instanceof Error ? e.message : String(e),
          );
        }
      } else if (driver?.phone) {
        // No charge computed — just send a plain notice.
        try {
          await sendSms(
            driver.phone,
            "Camauto: Your rental has been returned. Thanks for renting with us.",
            driver.full_name ?? null,
          );
          smsStatus = "sent";
        } catch (e) {
          smsStatus = "failed";
        }
      }
    } catch (e) {
      console.error(`[admin-override-return] driver lookup failed:`, e);
    }

    if (finalCharge != null) {
      try {
        await sendReceiptToCustomer({
          data: {
            rentalId: rental.id,
            paymentAmountCents: Math.round(finalCharge * 100),
            paymentMethod: "Final Charge",
            paymentReference: `override-${Date.now()}`,
          },
        });
      } catch (e) {
        console.error(`[admin-override-return] receipt PDF FAILED:`, e);
      }
    }

    console.log(
      `[admin-override-return] rental=${rental.id} by=${actorLabel} at=${nowIso} sms=${smsStatus}`,
    );

    return {
      ok: true,
      alreadyReturned: false as const,
      returned_at: nowIso,
      override_by: actorLabel,
      sms_status: smsStatus,
      final_charge: finalCharge,
    };
  });