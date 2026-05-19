import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

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
      .select("id, vehicle_id, driver_id, start_date, end_date, signed_at, created_at, billing_cadence, rate_amount, skip_daily_minimum, mileage_out, returned_at, reservation_status, final_charge_amount")
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

    const cadence = (rental.billing_cadence as "daily" | "weekly" | null) ?? null;
    const rate = rental.rate_amount != null ? Number(rental.rate_amount) : null;
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

    const { error: upErr } = await supabaseAdmin
      .from("rentals")
      .update({
        returned_at: nowIso,
        return_inspection_id: data.inspection_id,
        mileage_in: data.mileage_in,
        final_charge_amount: finalCharge,
        final_charge_breakdown: breakdown,
        reservation_status: "returned",
      })
      .eq("id", rental.id);
    if (upErr) throw new Error(`Failed to close out rental: ${upErr.message}`);

    // Flip vehicle back to available if it was rented.
    await supabaseAdmin
      .from("vehicles")
      .update({ status: "available" })
      .eq("id", rental.vehicle_id)
      .eq("status", "rented");

    // Fire-and-forget SMS receipt to the customer.
    let smsStatus: "sent" | "skipped_no_phone" | "skipped_no_charge" = "skipped_no_phone";
    if (finalCharge == null) {
      smsStatus = "skipped_no_charge";
    } else {
      try {
        const { data: driver } = await supabaseAdmin
          .from("drivers")
          .select("phone, full_name")
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
          // Intentionally not awaited.
          void sendSms(driver.phone, lines.join("\n"), driver.full_name ?? null)
            .then(() => console.log(`[return-receipt] rental=${rental.id} sent ok`))
            .catch((e) =>
              console.error(
                `[return-receipt] rental=${rental.id} FAILED: ${e instanceof Error ? e.message : String(e)}`,
              ),
            );
          smsStatus = "sent";
        }
      } catch (e) {
        console.error(`[return-receipt] rental=${rental.id} lookup failed:`, e);
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