import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

const rowSchema = z.object({
  fullName: z.string().trim().max(200).optional().nullable(),
  firstName: z.string().trim().max(100).optional().nullable(),
  lastName: z.string().trim().max(100).optional().nullable(),
  email: z.string().trim().max(255).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  licenseNumber: z.string().trim().max(60).optional().nullable(),
  dlState: z.string().trim().max(20).optional().nullable(),
  licenseExpiry: z.string().trim().max(40).optional().nullable(),
  dateOfBirth: z.string().trim().max(40).optional().nullable(),
  plate: z.string().trim().max(20).optional().nullable(),
  startDate: z.string().trim().max(40).optional().nullable(),
  endDate: z.string().trim().max(40).optional().nullable(),
  tags: z.string().trim().max(500).optional().nullable(),
});

export type FleetImportRow = z.infer<typeof rowSchema>;

/** Parse a loose date string (MM/DD/YYYY, YYYY-MM-DD, etc.) to YYYY-MM-DD or null. */
function toISODate(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(t);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const dt = new Date(t);
  if (!Number.isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

function normPlate(s: string | null | undefined): string {
  return (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}

async function nextId(table: "rentals" | "drivers", prefix: "R" | "D", floor: number) {
  const { data } = await supabaseAdmin.from(table).select("id");
  const n = (data ?? []).reduce((m: number, row: { id: string }) => {
    const k = parseInt(String(row.id).replace(/\D/g, "")) || 0;
    return Math.max(m, k);
  }, floor);
  return `${prefix}-${n + 1}`;
}

export interface FleetImportResult {
  driversCreated: number;
  driversMatched: number;
  rentalsCreated: number;
  rentalsSkipped: number;
  unmatchedVehicles: string[];
  errors: string[];
}

/** Import Fleet Finesse rows: upsert drivers, match vehicles by plate, create rentals. */
export const importFleetFinesse = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(rowSchema).min(1).max(5000) }).parse(input),
  )
  .handler(async ({ data }): Promise<FleetImportResult> => {
    const result: FleetImportResult = {
      driversCreated: 0,
      driversMatched: 0,
      rentalsCreated: 0,
      rentalsSkipped: 0,
      unmatchedVehicles: [],
      errors: [],
    };

    // Preload existing drivers + vehicles for matching.
    const [{ data: drivers }, { data: vehicles }, { data: rentals }] = await Promise.all([
      supabaseAdmin.from("drivers").select("id, full_name, phone, license_number"),
      supabaseAdmin.from("vehicles").select("id, plate"),
      supabaseAdmin.from("rentals").select("id, driver_id, vehicle_id, start_date"),
    ]);

    const byLicense = new Map<string, string>();
    const byNamePhone = new Map<string, string>();
    for (const d of drivers ?? []) {
      if (d.license_number) byLicense.set(d.license_number.trim().toUpperCase(), d.id);
      const key = `${(d.full_name ?? "").trim().toLowerCase()}|${(d.phone ?? "").replace(/\D/g, "")}`;
      if (key !== "|") byNamePhone.set(key, d.id);
    }
    const vehicleByPlate = new Map<string, string>();
    for (const v of vehicles ?? []) {
      if (v.plate) vehicleByPlate.set(normPlate(v.plate), v.id);
    }
    const existingRentalKeys = new Set(
      (rentals ?? []).map((r) => `${r.driver_id}|${r.vehicle_id}|${r.start_date}`),
    );

    // Track IDs we create within this run.
    let driverSeq: string | null = null;
    let rentalSeq: string | null = null;
    const bump = (id: string | null, prefix: "R" | "D", floor: number) => {
      if (!id) return null;
      const n = parseInt(id.replace(/\D/g, "")) || floor;
      return `${prefix}-${n + 1}`;
    };

    for (let i = 0; i < data.rows.length; i++) {
      const raw = data.rows[i];
      try {
        const fullName =
          raw.fullName?.trim() ||
          [raw.firstName, raw.lastName].filter(Boolean).join(" ").trim() ||
          "";
        const license = (raw.licenseNumber ?? "").trim().toUpperCase();
        const phoneDigits = (raw.phone ?? "").replace(/\D/g, "");

        // Resolve / create driver
        let driverId: string | null = null;
        if (license && byLicense.has(license)) {
          driverId = byLicense.get(license)!;
        } else {
          const key = `${fullName.toLowerCase()}|${phoneDigits}`;
          if (fullName && byNamePhone.has(key)) driverId = byNamePhone.get(key)!;
        }

        if (driverId) {
          result.driversMatched++;
          // Best-effort enrich tags
          if (raw.tags) {
            await supabaseAdmin
              .from("drivers")
              .update({ tags: raw.tags.trim() } as never)
              .eq("id", driverId);
          }
        } else {
          if (!fullName) {
            result.errors.push(`Row ${i + 1}: skipped — no name`);
            continue;
          }
          driverId = driverSeq
            ? bump(driverSeq, "D", 100)!
            : await nextId("drivers", "D", 100);
          driverSeq = driverId;
          const { error: dErr } = await supabaseAdmin.from("drivers").insert({
            id: driverId,
            full_name: fullName,
            first_name: raw.firstName?.trim() || null,
            last_name: raw.lastName?.trim() || null,
            phone: raw.phone?.trim() || "",
            email: raw.email?.trim() || "",
            license_number: raw.licenseNumber?.trim() || "",
            license_expiry: toISODate(raw.licenseExpiry) || "2099-12-31",
            dl_state: raw.dlState?.trim() || null,
            date_of_birth: toISODate(raw.dateOfBirth),
            insurance_on_file: false,
            rideshare: "Uber",
            status: "active",
            date_added: new Date().toISOString().slice(0, 10),
            tags: raw.tags?.trim() || null,
            import_source: "fleet_finesse",
          } as never);
          if (dErr) {
            result.errors.push(`Row ${i + 1}: driver insert failed — ${dErr.message}`);
            continue;
          }
          result.driversCreated++;
          if (license) byLicense.set(license, driverId);
          byNamePhone.set(`${fullName.toLowerCase()}|${phoneDigits}`, driverId);
        }

        // Resolve vehicle by plate (required for a rental)
        const plateKey = normPlate(raw.plate);
        const vehicleId = plateKey ? vehicleByPlate.get(plateKey) : undefined;
        const startISO = toISODate(raw.startDate);

        if (!vehicleId) {
          if (raw.plate) result.unmatchedVehicles.push(raw.plate.trim());
          result.rentalsSkipped++;
          continue;
        }
        if (!startISO) {
          result.rentalsSkipped++;
          continue;
        }

        const rentalKey = `${driverId}|${vehicleId}|${startISO}`;
        if (existingRentalKeys.has(rentalKey)) {
          result.rentalsSkipped++;
          continue;
        }

        const rentalId: string = rentalSeq
          ? bump(rentalSeq, "R", 500)!
          : await nextId("rentals", "R", 500);
        rentalSeq = rentalId;
        const { error: rErr } = await supabaseAdmin.from("rentals").insert({
          id: rentalId,
          vehicle_id: vehicleId,
          driver_id: driverId,
          start_date: startISO,
          end_date: toISODate(raw.endDate),
          weekly_rate: 0,
          deposit_paid: 0,
          payment_status: "current",
          payment_received: false,
          reservation_status: "active",
          tags: raw.tags?.trim() || null,
          import_source: "fleet_finesse",
        } as never);
        if (rErr) {
          result.errors.push(`Row ${i + 1}: rental insert failed — ${rErr.message}`);
          continue;
        }
        existingRentalKeys.add(rentalKey);
        result.rentalsCreated++;
      } catch (e) {
        result.errors.push(`Row ${i + 1}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    result.unmatchedVehicles = Array.from(new Set(result.unmatchedVehicles)).slice(0, 50);
    return result;
  });
