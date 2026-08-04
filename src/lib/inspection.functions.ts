import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendSms } from "@/lib/ghl.server";

function genToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Staff: kick off the post-return runner inspection. Generates a token,
 *  saves a pending_inspections row, and SMSes the runner the public link. */
export const startReturnInspection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: {
    vehicleId: string;
    rentalId: string;
    runnerPhone: string;
    origin: string;
    vehicleLabel?: string;
  }) => {
    if (!input.vehicleId) throw new Error("vehicleId required");
    if (!input.rentalId) throw new Error("rentalId required");
    if (!input.runnerPhone || input.runnerPhone.length < 7) throw new Error("runnerPhone required");
    if (!input.origin || !/^https?:\/\//.test(input.origin)) throw new Error("origin required");
    return input;
  })
  .handler(async ({ data }) => {
    const token = genToken();
    const { error } = await supabaseAdmin
      .from("pending_inspections")
      .upsert({
        vehicle_id: data.vehicleId,
        rental_id: data.rentalId,
        token,
        runner_phone: data.runnerPhone,
      }, { onConflict: "vehicle_id" });
    if (error) throw new Error(error.message);
    const url = `${data.origin.replace(/\/$/, "")}/inspect/${encodeURIComponent(data.vehicleId)}/${token}`;
    const label = data.vehicleLabel || data.vehicleId;
    const msg = `Camauto Rentals: Inspection needed for ${label}. Open on phone: ${url}`;
    await sendSms(data.runnerPhone, msg, "Runner Inspection");
    return { ok: true, token, url };
  });

/** Public: load a pending inspection by vehicle id + token. No auth. */
export const getPendingInspectionPublic = createServerFn({ method: "POST" })
  .inputValidator((input: { vehicleId: string; token: string }) => {
    if (!input.vehicleId) throw new Error("vehicleId required");
    if (!input.token || input.token.length < 16) throw new Error("invalid token");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: row, error } = await supabaseAdmin
      .from("pending_inspections")
      .select("vehicle_id, rental_id, token, created_at")
      .eq("vehicle_id", data.vehicleId)
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This inspection link is invalid or already used");
    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("id, year, make, model, plate, mileage")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (!v) throw new Error("Vehicle not found");
    return {
      vehicleId: v.id as string,
      rentalId: row.rental_id as string,
      vehicle: {
        year: v.year as number,
        make: v.make as string,
        model: v.model as string,
        plate: v.plate as string,
        mileage: v.mileage as number,
      },
    };
  });

/** Public: runner submits the post-return inspection. Creates inspection row,
 *  flips vehicle to "available", clears pending row, sends SMS summary. */
export const submitPendingInspectionPublic = createServerFn({ method: "POST" })
  .inputValidator((input: {
    vehicleId: string;
    token: string;
    mileage: number;
    fuelLevel: number;
    damageNoted: boolean;
    completedBy: string;
    notes?: string;
    checklist: Record<string, boolean>;
    inspectorName?: string;
    items?: {
      tires?: { status: "pass" | "fail"; notes?: string };
      fluids?: { status: "pass" | "fail"; notes?: string };
      brakes?: { status: "pass" | "fail"; notes?: string };
      lights?: { status: "pass" | "fail"; notes?: string };
      body?: { status: "pass" | "fail"; notes?: string };
      interior?: { status: "pass" | "fail"; notes?: string };
    };
  }) => {
    if (!input.vehicleId) throw new Error("vehicleId required");
    if (!input.token || input.token.length < 16) throw new Error("invalid token");
    if (typeof input.mileage !== "number" || input.mileage < 0) throw new Error("mileage required");
    if (typeof input.fuelLevel !== "number" || input.fuelLevel < 0 || input.fuelLevel > 100) throw new Error("fuelLevel 0-100");
    if (!input.completedBy || input.completedBy.length > 120) throw new Error("Your name is required");
    if (input.notes && input.notes.length > 2000) throw new Error("notes too long");
    if (!input.checklist || typeof input.checklist !== "object") throw new Error("checklist required");
    return input;
  })
  .handler(async ({ data }) => {
    const { data: row, error: rErr } = await supabaseAdmin
      .from("pending_inspections")
      .select("vehicle_id, rental_id, token")
      .eq("vehicle_id", data.vehicleId)
      .eq("token", data.token)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!row) throw new Error("This inspection link is invalid or already used");

    const { data: v } = await supabaseAdmin
      .from("vehicles")
      .select("id, year, make, model, plate, mileage")
      .eq("id", data.vehicleId)
      .maybeSingle();
    if (!v) throw new Error("Vehicle not found");

    // Insert inspection record
    const inspectionId = `IN-${Date.now().toString(36).toUpperCase()}`;
    const it = data.items || {};
    const { error: insErr } = await supabaseAdmin.from("inspections").insert({
      id: inspectionId,
      vehicle_id: data.vehicleId,
      rental_id: row.rental_id,
      type: "check-in",
      date: new Date().toISOString().slice(0, 10),
      mileage: data.mileage,
      fuel_level: data.fuelLevel == null ? "full" : String(data.fuelLevel),
      damage_noted: data.damageNoted,
      completed_by: data.completedBy.trim(),
      inspector_name: (data.inspectorName || data.completedBy).trim(),
    });
    if (insErr) throw new Error(insErr.message);

    // Flip vehicle to available. Increase-only on mileage: the inspection keeps
    // the reading as a historical snapshot, but a lower number never rolls the
    // vehicle's current mileage backward.
    const currentMileage = (v.mileage as number) ?? 0;
    const mileageApplied = data.mileage > currentMileage;
    const vehiclePatch: { status: string; mileage?: number } = { status: "available" };
    if (mileageApplied) vehiclePatch.mileage = data.mileage;
    await supabaseAdmin
      .from("vehicles")
      .update(vehiclePatch)
      .eq("id", data.vehicleId);
    if (data.mileage !== currentMileage) {
      await supabaseAdmin.from("vehicle_mileage_log").insert({
        vehicle_id: data.vehicleId,
        old_mileage: currentMileage,
        new_mileage: data.mileage,
        applied: mileageApplied,
        source: "Check-in inspection",
        actor: data.completedBy.trim(),
      });
    }
    try {
      const { syncVehicleAvailabilityToGhl } = await import("@/lib/ghl-vehicle-sync.server");
      await syncVehicleAvailabilityToGhl(data.vehicleId);
    } catch (e) { console.error("[inspection] ghl sync failed", e); }

    // Clear pending
    await supabaseAdmin
      .from("pending_inspections")
      .delete()
      .eq("vehicle_id", data.vehicleId);

    const failedItems = Object.entries(it)
      .filter(([, v]) => v?.status === "fail")
      .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));
    return {
      ok: true,
      damageNoted: data.damageNoted,
      failedItems,
      maintenanceCreated: failedItems.length > 0 || data.damageNoted,
      mileageApplied,
      mileageWarning: mileageApplied
        ? null
        : `This is lower than the last recorded mileage (${currentMileage.toLocaleString()}). Vehicle mileage was not changed. Double-check the number.`,
    };
  });