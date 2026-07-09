import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { notifyRenter } from "@/lib/renter-notify.server";
import { sendReceiptToCustomer } from "@/lib/receipt.functions";

/**
 * Day count, inclusive of both endpoints, computed in UTC days.
 * Always returns at least 1.
 */
function inclusiveDaysBetween(startIso: string, endIso: string): number {
  const MS = 24 * 60 * 60 * 1000;
  const s = new Date(startIso);
  const e = new Date(endIso);
  const sUtc = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const eUtc = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  const days = Math.floor((eUtc - sUtc) / MS) + 1;
  return Math.max(1, days);
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export const closeoutRental = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    rental_id: string;
    inspection_id: string;
    mileage_in: number;
  }) =>
    z.object({
      rental_id: z.string().min(1).max(120),
      inspection_id: z.string().min(1).max(120),
      mileage_in: z.number().int().min(0).max(10_000_000),
    }).parse(input)
  )
  .handler(async ({ data }) => {
    const { data: rental, error: rErr } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, driver_id, start_date, end_date, signed_at, created_at, activated_at, billing_cadence, billing_period, rate_amount, rate, weekly_rate, skip_daily_minimum, mileage_out, returned_at, reservation_status, final_charge_amount")
      .eq("id", data.rental_id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!rental) throw new Error("Rental not found");
    const trulyClosed =
      !!rental.returned_at &&
      (rental.reservation_status === "returned" ||
        rental.reservation_status === "completed" ||
        rental.final_charge_amount != null);
    if (trulyClosed) {
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
      return { ok: true, alreadyReturned: true as const };
    }

    // Mark the inspection as a return inspection.
    await supabaseAdmin
      .from("inspections")
      .update({ is_return_inspection: true })
      .eq("id", data.inspection_id);

    // Latest expected end = max(rental.end_date, max(extension.new_end_date))
    const { data: exts } = await supabaseAdmin
      .from("rental_extensions")
      .select("new_end_date")
      .eq("rental_id", rental.id);
    const extensionCount = exts?.length ?? 0;
    const wasExtended = extensionCount > 0;
    let expectedEnd: string | null = rental.end_date ?? null;
    for (const e of exts ?? []) {
      if (!expectedEnd || (e.new_end_date && e.new_end_date > expectedEnd)) {
        expectedEnd = e.new_end_date;
      }
    }

    const startIso = rental.start_date || rental.signed_at || rental.created_at;
    const nowIso = new Date().toISOString();
    const daysUsed = startIso ? inclusiveDaysBetween(startIso, nowIso) : 1;

    // Read from the fields the rest of the app actually writes
    // (billing_period / rate / weekly_rate). Fall back to the legacy
    // billing_cadence / rate_amount columns when present.
    const rawCadence = (rental.billing_cadence as string | null)
      ?? (rental.billing_period as string | null)
      ?? "weekly";
    const c = rawCadence.toLowerCase();
    const cadence: "daily" | "weekly" = c.startsWith("day") ? "daily" : "weekly";
    const rawRate = rental.rate_amount ?? rental.rate
      ?? (cadence === "weekly" ? rental.weekly_rate : null);
    const rate = rawRate != null ? Number(rawRate) : null;
    const skipDailyMin = !!rental.skip_daily_minimum;

    let minimumPeriods = 0;
    let periodsBilled = 0;
    let finalCharge: number | null = null;
    if (!cadence || rate == null || !Number.isFinite(rate)) {
      console.warn(`[return] rental=${rental.id} missing rate/cadence — admin must finalize manually`);
    } else if (cadence === "daily") {
      minimumPeriods = skipDailyMin ? 1 : 2;
      periodsBilled = Math.max(daysUsed, minimumPeriods);
      finalCharge = +(periodsBilled * rate).toFixed(2);
    } else {
      // weekly
      minimumPeriods = 1;
      periodsBilled = Math.max(1, Math.ceil(daysUsed / 7));
      finalCharge = +(periodsBilled * rate).toFixed(2);
    }

    const milesDriven =
      rental.mileage_out != null ? Math.max(0, data.mileage_in - rental.mileage_out) : null;

    const breakdown = {
      start_date: startIso ?? null,
      expected_return: expectedEnd,
      actual_return: nowIso,
      days_used: daysUsed,
      billing_cadence: cadence,
      rate_amount: rate,
      skip_daily_minimum: skipDailyMin,
      minimum_periods: minimumPeriods,
      periods_billed: periodsBilled,
      final_charge: finalCharge,
      mileage_out: rental.mileage_out ?? null,
      mileage_in: data.mileage_in,
      miles_driven: milesDriven,
      was_extended: wasExtended,
      extension_count: extensionCount,
    };

    const { data: updatedRental, error: upErr } = await supabaseAdmin
      .from("rentals")
      .update({
        returned_at: nowIso,
        return_inspection_id: data.inspection_id,
        mileage_in: data.mileage_in,
        final_charge_amount: finalCharge,
        final_charge_breakdown: breakdown,
        reservation_status: "returned",
      })
      .eq("id", rental.id)
      .select("id, reservation_status, returned_at")
      .maybeSingle();
    if (upErr) throw new Error(`Failed to close out rental: ${upErr.message}`);
    if (!updatedRental || updatedRental.reservation_status !== "returned") {
      throw new Error("Failed to close out rental: returned status did not persist");
    }

    // Flip vehicle back to available and roll the return odometer forward.
    // Increase-only: only advance the vehicle's current mileage when the
    // return reading is higher than what's on record (odometers only go up).
    const { data: curVehicle } = await supabaseAdmin
      .from("vehicles")
      .select("mileage")
      .eq("id", rental.vehicle_id)
      .maybeSingle();
    const vehiclePatch: { status: string; mileage?: number } = { status: "available" };
    if (
      typeof data.mileage_in === "number" &&
      data.mileage_in > (curVehicle?.mileage ?? 0)
    ) {
      vehiclePatch.mileage = data.mileage_in;
    }
    const { data: updatedVehicle, error: vehicleErr } = await supabaseAdmin
      .from("vehicles")
      .update(vehiclePatch)
      .eq("id", rental.vehicle_id)
      .select("id, status")
      .maybeSingle();
    if (vehicleErr) throw new Error(`Failed to mark vehicle available: ${vehicleErr.message}`);
    if (!updatedVehicle || updatedVehicle.status !== "available") {
      throw new Error("Failed to mark vehicle available after return");
    }

    // Log the final charge to rental_charges (audit trail) and deliver a
    // branded SMS + email receipt to the renter.
    let smsStatus: "sent" | "skipped_no_phone" | "skipped_no_charge" = "skipped_no_phone";
    if (finalCharge == null) {
      smsStatus = "skipped_no_charge";
    } else {
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
        console.error(`[return] rental_charges insert failed for ${rental.id}:`, e);
      }
      try {
        const { data: driver } = await supabaseAdmin
          .from("drivers")
          .select("phone, full_name, email")
          .eq("id", rental.driver_id)
          .maybeSingle();
        if (driver?.phone) {
          const unit = cadence === "daily" ? "day" : "week";
          const lineTotal = +(periodsBilled * (rate ?? 0)).toFixed(2);
          const dayWord = daysUsed === 1 ? "day" : "days";
          const milesLine =
            milesDriven != null ? `${milesDriven.toLocaleString()} miles driven.` : null;
          const lines = [
            `Camauto Receipt: Rental returned. ${fmtMoney(finalCharge)}.`,
            `${daysUsed} ${dayWord} @ ${fmtMoney(rate ?? 0)}/${unit} = ${fmtMoney(lineTotal)}.`,
            milesLine,
            wasExtended ? "Includes extension." : null,
            "Thanks for renting with us.",
          ].filter(Boolean) as string[];
          try {
            await notifyRenter({
              phone: driver.phone,
              email: driver.email ?? null,
              name: driver.full_name ?? null,
              sms: lines.join("\n"),
              emailSubject: "Your Camauto Rental Receipt",
              emailHeading: "Rental Returned — Receipt",
              emailIntro: "Thank you for renting with Camauto. Your rental has been returned and the final charges are summarized below.",
              emailDetails: [
                { label: "Final Charge", value: fmtMoney(finalCharge) },
                { label: "Billing", value: `${daysUsed} ${dayWord} @ ${fmtMoney(rate ?? 0)}/${unit}` },
                { label: "Periods Billed", value: `${periodsBilled} ${unit}${periodsBilled === 1 ? "" : "s"}` },
                ...(milesDriven != null ? [{ label: "Miles Driven", value: milesDriven.toLocaleString() }] : []),
                ...(wasExtended ? [{ label: "Extensions", value: `${extensionCount} applied` }] : []),
              ],
              emailFootnote: "A detailed receipt PDF will arrive in a separate message.",
            });
            console.log(`[return-receipt] rental=${rental.id} sent ok`);
            smsStatus = "sent";
          } catch (e) {
            console.error(
              `[return-receipt] rental=${rental.id} FAILED: ${e instanceof Error ? e.message : String(e)}`,
            );
          }
        }
      } catch (e) {
        console.error(`[return-receipt] rental=${rental.id} lookup failed:`, e);
      }
      // Generate and deliver the receipt PDF (SMS + email with attachment).
      try {
        await sendReceiptToCustomer({
          data: {
            rentalId: rental.id,
            paymentAmountCents: Math.round(finalCharge * 100),
            paymentMethod: "Final Charge",
            paymentReference: `return-${Date.now()}`,
          },
        });
      } catch (e) {
        console.error(`[return-receipt-pdf] rental=${rental.id} FAILED:`, e);
      }
    }

    return {
      ok: true,
      alreadyReturned: false as const,
      final_charge: finalCharge,
      days_used: daysUsed,
      miles_driven: milesDriven,
      was_extended: wasExtended,
      sms_status: smsStatus,
      breakdown,
    };
  });