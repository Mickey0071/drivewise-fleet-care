import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

// Resolve the driver_ref attached to the current authenticated user's
// profile. Returns null if the user isn't linked to a renter record.
async function currentDriverId(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("driver_ref")
    .eq("id", userId)
    .maybeSingle();
  return data?.driver_ref ?? null;
}

export const listMyRentals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const driverId = await currentDriverId(context.userId);
    if (!driverId) return { driverId: null, rentals: [] as Array<any> };

    const { data: rs, error } = await supabaseAdmin
      .from("rentals")
      .select(
        "id, vehicle_id, start_date, end_date, returned_at, reservation_status, billing_period, rate, weekly_rate, final_charge_amount",
      )
      .eq("driver_id", driverId)
      .order("start_date", { ascending: false });
    if (error) throw new Error(error.message);

    const vehicleIds = Array.from(new Set((rs ?? []).map((r) => r.vehicle_id).filter(Boolean)));
    const { data: vehicles } = vehicleIds.length
      ? await supabaseAdmin
          .from("vehicles")
          .select("id, year, make, model, plate, image_url")
          .in("id", vehicleIds)
      : { data: [] as any[] };
    const vMap = new Map((vehicles ?? []).map((v) => [v.id, v]));

    return {
      driverId,
      rentals: (rs ?? []).map((r) => ({ ...r, vehicle: vMap.get(r.vehicle_id) ?? null })),
    };
  });

export const getMyRentalDetail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rentalId: z.string().min(1).max(100) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const driverId = await currentDriverId(context.userId);
    if (!driverId) throw new Error("No renter profile linked to this account.");

    const { data: rental, error } = await supabaseAdmin
      .from("rentals")
      .select("*")
      .eq("id", data.rentalId)
      .eq("driver_id", driverId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!rental) throw new Error("Rental not found");

    const [{ data: vehicle }, { data: driver }, { data: payments }, { data: violations }, { data: inspections }, { data: extensions }] =
      await Promise.all([
        supabaseAdmin
          .from("vehicles")
          .select("id, year, make, model, plate, vin, image_url, color")
          .eq("id", rental.vehicle_id)
          .maybeSingle(),
        supabaseAdmin
          .from("drivers")
          .select("id, full_name, email, phone, license_number, dl_state")
          .eq("id", rental.driver_id)
          .maybeSingle(),
        supabaseAdmin
          .from("payments")
          .select("id, amount, due_date, paid_date, method, status")
          .eq("rental_id", rental.id)
          .order("due_date", { ascending: true }),
        supabaseAdmin
          .from("violations")
          .select("id, type, amount, date_issued, status, notes")
          .eq("vehicle_id", rental.vehicle_id)
          .eq("driver_id", driverId)
          .gte("date_issued", rental.start_date)
          .lte(
            "date_issued",
            rental.end_date ?? new Date().toISOString().slice(0, 10),
          ),
        supabaseAdmin
          .from("inspections")
          .select(
            "id, date, type, mileage, fuel_level, damage_noted, ready_to_rent, notes, inspector_name, is_return_inspection, checklist_items",
          )
          .eq("rental_id", rental.id)
          .order("date", { ascending: true }),
        supabaseAdmin
          .from("rental_extensions")
          .select("id, periods, period_label, additional_amount, previous_end_date, new_end_date, extended_at")
          .eq("rental_id", rental.id)
          .order("extended_at", { ascending: true }),
      ]);

    return {
      rental,
      vehicle,
      driver,
      payments: payments ?? [],
      violations: violations ?? [],
      inspections: inspections ?? [],
      extensions: extensions ?? [],
    };
  });

// Public — given any rental ID, return the other rentals belonging to the
// same renter. Used from the SMS portal so the renter can jump between
// their own reservations without logging in.
export const getRenterHistoryByRentalId = createServerFn({ method: "POST" })
  .inputValidator((input: { rentalId: string }) => {
    if (!input?.rentalId || typeof input.rentalId !== "string" || input.rentalId.length > 100) {
      throw new Error("rentalId required");
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { data: root } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id")
      .eq("id", data.rentalId)
      .maybeSingle();
    if (!root) return { rentals: [] as Array<any> };

    const { data: rs } = await supabaseAdmin
      .from("rentals")
      .select("id, vehicle_id, start_date, end_date, returned_at, reservation_status, agreement_pdf_url, receipt_pdf_url")
      .eq("driver_id", root.driver_id)
      .order("start_date", { ascending: false });

    const vehicleIds = Array.from(new Set((rs ?? []).map((r) => r.vehicle_id).filter(Boolean)));
    const { data: vehicles } = vehicleIds.length
      ? await supabaseAdmin
          .from("vehicles")
          .select("id, year, make, model, plate")
          .in("id", vehicleIds)
      : { data: [] as any[] };
    const vMap = new Map((vehicles ?? []).map((v) => [v.id, v]));

    return {
      rentals: (rs ?? []).map((r) => ({ ...r, vehicle: vMap.get(r.vehicle_id) ?? null })),
    };
  });