import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

// ---------- helpers ----------
function normPlate(s: string | null | undefined): string {
  return (s ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
}
function normName(s: string | null | undefined): string {
  return (s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
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
function toInt(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseInt(String(s).replace(/[^0-9-]/g, ""), 10);
  return Number.isNaN(n) ? null : n;
}
function toNum(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = parseFloat(String(s).replace(/[^0-9.-]/g, ""));
  return Number.isNaN(n) ? null : n;
}

async function maxNumericId(table: "vehicles" | "rentals" | "drivers"): Promise<number> {
  const { data } = await supabaseAdmin.from(table).select("id");
  return (data ?? []).reduce((m: number, r: { id: string }) => {
    const k = parseInt(String(r.id).replace(/\D/g, ""), 10) || 0;
    return Math.max(m, k);
  }, 0);
}

// ---------- vehicle import ----------
const vehicleRow = z.object({
  make: z.string().trim().max(60).optional().nullable(),
  model: z.string().trim().max(80).optional().nullable(),
  year: z.string().trim().max(10).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
  license_plate: z.string().trim().max(20).optional().nullable(),
  vin: z.string().trim().max(40).optional().nullable(),
  current_mileage: z.string().trim().max(20).optional().nullable(),
  daily_allowed: z.string().trim().max(20).optional().nullable(),
  daily_rate: z.string().trim().max(20).optional().nullable(),
  weekly_rate: z.string().trim().max(20).optional().nullable(),
  status: z.string().trim().max(40).optional().nullable(),
});
export type VehicleImportRow = z.infer<typeof vehicleRow>;

export interface VehiclePlan {
  row: number;
  action: "create" | "update" | "skip";
  plate: string;
  id?: string;
  label: string;
  changes: { field: string; before: string; after: string }[];
  note?: string;
}
export interface VehicleImportResult {
  plans: VehiclePlan[];
  created: number;
  updated: number;
  skipped: number;
  committed: boolean;
}

export const importVehicles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(vehicleRow).min(1).max(2000), commit: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data }): Promise<VehicleImportResult> => {
    const { data: existing } = await supabaseAdmin
      .from("vehicles")
      .select("id, make, model, year, vin, plate, color, mileage, daily_rate, weekly_rate, status");
    const byPlate = new Map<string, NonNullable<typeof existing>[number]>();
    for (const v of existing ?? []) if (v.plate) byPlate.set(normPlate(v.plate), v);

    let nextId = await maxNumericId("vehicles");
    const plans: VehiclePlan[] = [];
    let created = 0, updated = 0, skipped = 0;

    for (let i = 0; i < data.rows.length; i++) {
      const r = data.rows[i];
      const plateKey = normPlate(r.license_plate);
      const label = [r.year, r.make, r.model].filter(Boolean).join(" ").trim() || "(unnamed)";
      if (!plateKey) {
        plans.push({ row: i + 1, action: "skip", plate: "", label, changes: [], note: "No license plate" });
        skipped++;
        continue;
      }
      const found = byPlate.get(plateKey);
      if (found) {
        // update only missing fields
        const changes: { field: string; before: string; after: string }[] = [];
        const patch: Record<string, unknown> = {};
        const setIfEmpty = (field: string, cur: unknown, next: unknown) => {
          const curEmpty = cur === null || cur === undefined || String(cur).trim() === "" || (typeof cur === "number" && cur === 0);
          if (next != null && String(next).trim() !== "" && curEmpty) {
            patch[field] = next;
            changes.push({ field, before: String(cur ?? ""), after: String(next) });
          }
        };
        setIfEmpty("vin", found.vin, r.vin?.trim());
        setIfEmpty("color", found.color, r.color?.trim());
        setIfEmpty("mileage", found.mileage, toInt(r.current_mileage));
        setIfEmpty("daily_rate", found.daily_rate, toNum(r.daily_rate));
        setIfEmpty("weekly_rate", found.weekly_rate, toNum(r.weekly_rate));
        if (changes.length === 0) {
          plans.push({ row: i + 1, action: "skip", plate: r.license_plate!.trim(), id: found.id, label, changes: [], note: "Already complete" });
          skipped++;
          continue;
        }
        plans.push({ row: i + 1, action: "update", plate: r.license_plate!.trim(), id: found.id, label, changes });
        updated++;
        if (data.commit) {
          await supabaseAdmin.from("vehicles").update(patch as never).eq("id", found.id);
        }
      } else {
        nextId++;
        const id = `V-${nextId}`;
        const changes = [
          { field: "make", before: "", after: r.make?.trim() ?? "" },
          { field: "model", before: "", after: r.model?.trim() ?? "" },
          { field: "year", before: "", after: String(toInt(r.year) ?? "") },
          { field: "vin", before: "", after: r.vin?.trim() ?? "" },
          { field: "plate", before: "", after: r.license_plate!.trim() },
        ];
        plans.push({ row: i + 1, action: "create", plate: r.license_plate!.trim(), id, label, changes });
        created++;
        if (data.commit) {
          await supabaseAdmin.from("vehicles").insert({
            id,
            make: r.make?.trim() || "Unknown",
            model: r.model?.trim() || "Unknown",
            year: toInt(r.year) || 2000,
            vin: r.vin?.trim() || "",
            plate: r.license_plate!.trim(),
            color: r.color?.trim() || null,
            mileage: toInt(r.current_mileage) || 0,
            daily_rate: toNum(r.daily_rate) || 0,
            weekly_rate: toNum(r.weekly_rate) || 0,
            status: r.status?.trim() || "available",
          } as never);
          byPlate.set(plateKey, { id, plate: r.license_plate!.trim() } as never);
        }
      }
    }

    return { plans, created, updated, skipped, committed: !!data.commit };
  });

// ---------- rental import ----------
const rentalRow = z.object({
  order_number: z.string().trim().max(80).optional().nullable(),
  customer_name: z.string().trim().max(200).optional().nullable(),
  vehicle_year: z.string().trim().max(10).optional().nullable(),
  vehicle_make: z.string().trim().max(60).optional().nullable(),
  vehicle_model: z.string().trim().max(80).optional().nullable(),
  mileage: z.string().trim().max(20).optional().nullable(),
  pickup_location: z.string().trim().max(200).optional().nullable(),
  dropoff_location: z.string().trim().max(200).optional().nullable(),
  pickup_date: z.string().trim().max(40).optional().nullable(),
  return_date: z.string().trim().max(40).optional().nullable(),
  status: z.string().trim().max(40).optional().nullable(),
});
export type RentalImportRow = z.infer<typeof rentalRow>;

export interface RentalPlan {
  row: number;
  action: "create" | "skip";
  order: string;
  customer: string;
  vehicle: string;
  driverAction: "match" | "create" | "";
  note?: string;
}
export interface RentalImportResult {
  plans: RentalPlan[];
  rentalsCreated: number;
  driversCreated: number;
  driversMatched: number;
  skipped: number;
  unmatchedVehicles: string[];
  committed: boolean;
}

export const importRentals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(rentalRow).min(1).max(5000), commit: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data }): Promise<RentalImportResult> => {
    const [{ data: vehicles }, { data: drivers }, { data: rentals }] = await Promise.all([
      supabaseAdmin.from("vehicles").select("id, make, model, year"),
      supabaseAdmin.from("drivers").select("id, full_name"),
      supabaseAdmin.from("rentals").select("id, notes"),
    ]);

    const vehicleByYMM = new Map<string, string>();
    for (const v of vehicles ?? []) {
      const key = `${v.year}|${normName(v.make)}|${normName(v.model)}`;
      if (!vehicleByYMM.has(key)) vehicleByYMM.set(key, v.id);
    }
    const driverByName = new Map<string, string>();
    for (const d of drivers ?? []) {
      if (d.full_name) driverByName.set(normName(d.full_name), d.id);
    }
    // existing order numbers tracked via notes tag "order:<num>"
    const existingOrders = new Set<string>();
    for (const rn of rentals ?? []) {
      const m = /order:([^\s|]+)/i.exec(rn.notes ?? "");
      if (m) existingOrders.add(m[1].toLowerCase());
    }

    let nextDriver = await maxNumericId("drivers");
    let nextRental = await maxNumericId("rentals");

    const plans: RentalPlan[] = [];
    let rentalsCreated = 0, driversCreated = 0, driversMatched = 0, skipped = 0;
    const unmatched = new Set<string>();
    const seenOrders = new Set<string>();

    for (let i = 0; i < data.rows.length; i++) {
      const r = data.rows[i];
      const order = (r.order_number ?? "").trim();
      const customer = (r.customer_name ?? "").trim();
      const vehLabel = [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(" ").trim();
      const orderKey = order.toLowerCase();

      if (order && (existingOrders.has(orderKey) || seenOrders.has(orderKey))) {
        plans.push({ row: i + 1, action: "skip", order, customer, vehicle: vehLabel, driverAction: "", note: "Duplicate order_number" });
        skipped++;
        continue;
      }

      const vehKey = `${toInt(r.vehicle_year)}|${normName(r.vehicle_make)}|${normName(r.vehicle_model)}`;
      const vehicleId = vehicleByYMM.get(vehKey);
      if (!vehicleId) {
        if (vehLabel) unmatched.add(vehLabel);
        plans.push({ row: i + 1, action: "skip", order, customer, vehicle: vehLabel, driverAction: "", note: "No vehicle match" });
        skipped++;
        continue;
      }
      if (!customer) {
        plans.push({ row: i + 1, action: "skip", order, customer, vehicle: vehLabel, driverAction: "", note: "No customer name" });
        skipped++;
        continue;
      }

      const nameKey = normName(customer);
      let driverId = driverByName.get(nameKey);
      let driverAction: "match" | "create";
      if (driverId) {
        driverAction = "match";
        driversMatched++;
      } else {
        driverAction = "create";
        driversCreated++;
        nextDriver++;
        driverId = `D-${nextDriver}`;
        if (data.commit) {
          await supabaseAdmin.from("drivers").insert({
            id: driverId,
            full_name: customer,
            phone: "",
            email: "",
            license_number: "",
            license_expiry: "2099-12-31",
            status: "active",
            tags: "Fleet Finesse Migration",
            import_source: "fleet_finesse",
          } as never);
        }
        driverByName.set(nameKey, driverId);
      }

      nextRental++;
      const rentalId = `R-${nextRental}`;
      const startISO = toISODate(r.pickup_date);
      plans.push({ row: i + 1, action: "create", order, customer, vehicle: vehLabel, driverAction });
      rentalsCreated++;
      if (order) seenOrders.add(orderKey);
      if (data.commit) {
        await supabaseAdmin.from("rentals").insert({
          id: rentalId,
          vehicle_id: vehicleId,
          driver_id: driverId,
          start_date: startISO || new Date().toISOString().slice(0, 10),
          end_date: toISODate(r.return_date),
          weekly_rate: 0,
          deposit_paid: 0,
          payment_status: "current",
          reservation_status: "returned",
          notes: `Fleet Finesse Migration${order ? ` | order:${order}` : ""}${r.pickup_location ? ` | pickup:${r.pickup_location.trim()}` : ""}${r.dropoff_location ? ` | dropoff:${r.dropoff_location.trim()}` : ""}`,
          tags: "Fleet Finesse Migration",
          import_source: "fleet_finesse",
        } as never);
      }
    }

    return {
      plans,
      rentalsCreated,
      driversCreated,
      driversMatched,
      skipped,
      unmatchedVehicles: Array.from(unmatched).slice(0, 50),
      committed: !!data.commit,
    };
  });
// ---------- customer import ----------
// Accepts arbitrary CSV columns; we auto-detect common field synonyms.
const customerRaw = z.record(z.string(), z.string().nullable());

function pick(row: Record<string, string | null>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

const CUST_FIELDS: { field: string; type: "text" | "date"; syn: string[] }[] = [
  { field: "phone", type: "text", syn: ["phone", "phone_number", "mobile", "cell", "cell_phone", "telephone", "contact_number", "phone_1", "primary_phone"] },
  { field: "email", type: "text", syn: ["email", "email_address", "e_mail", "mail"] },
  { field: "license_number", type: "text", syn: ["license_number", "license", "license_no", "dl_number", "dl", "drivers_license", "drivers_license_number", "dl_no"] },
  { field: "license_expiry", type: "date", syn: ["license_expiry", "license_expiration", "dl_expiry", "dl_expiration", "license_exp", "expiration", "expiry"] },
  { field: "date_of_birth", type: "date", syn: ["date_of_birth", "dob", "birthdate", "birth_date"] },
  { field: "dl_state", type: "text", syn: ["dl_state", "license_state", "state_issued"] },
  { field: "street_address", type: "text", syn: ["street_address", "address", "address_1", "address_line_1", "street", "addr"] },
  { field: "apt_unit", type: "text", syn: ["apt_unit", "apt", "unit", "apartment", "suite", "address_2", "address_line_2"] },
  { field: "city", type: "text", syn: ["city", "town"] },
  { field: "state", type: "text", syn: ["state", "province", "region"] },
  { field: "zip_code", type: "text", syn: ["zip_code", "zip", "postal_code", "postcode", "zipcode"] },
  { field: "alt_contact_name", type: "text", syn: ["alt_contact_name", "emergency_contact", "emergency_contact_name", "alt_contact"] },
  { field: "alt_contact_phone", type: "text", syn: ["alt_contact_phone", "emergency_phone", "emergency_contact_phone", "alt_phone"] },
];

function mapCustomer(row: Record<string, string | null>): { name: string; fields: Record<string, string> } {
  const full = pick(row, ["full_name", "name", "customer_name", "renter_name", "client_name"]);
  const first = pick(row, ["first_name", "firstname", "fname", "given_name"]);
  const last = pick(row, ["last_name", "lastname", "lname", "surname", "family_name"]);
  const name = full || [first, last].filter(Boolean).join(" ").trim();
  const fields: Record<string, string> = {};
  if (first) fields.first_name = first;
  if (last) fields.last_name = last;
  for (const f of CUST_FIELDS) {
    const raw = pick(row, f.syn);
    if (!raw) continue;
    if (f.type === "date") {
      const iso = toISODate(raw);
      if (iso) fields[f.field] = iso;
    } else {
      fields[f.field] = raw;
    }
  }
  return { name, fields };
}

export interface CustomerPlan {
  row: number;
  action: "create" | "enrich" | "skip";
  name: string;
  id?: string;
  // fields that will be filled on existing empty columns
  fills: { field: string; value: string }[];
  // existing non-empty values that DIFFER from the CSV (NOT overwritten — flagged for review)
  conflicts: { field: string; existing: string; csv: string }[];
  note?: string;
}
export interface CustomerImportResult {
  plans: CustomerPlan[];
  created: number;
  enriched: number;
  skipped: number;
  conflicts: number;
  committed: boolean;
}

export const importCustomers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ rows: z.array(customerRaw).min(1).max(5000), commit: z.boolean().default(false) }).parse(input),
  )
  .handler(async ({ data }): Promise<CustomerImportResult> => {
    const { data: drivers } = await supabaseAdmin
      .from("drivers")
      .select(
        "id, full_name, first_name, last_name, phone, email, license_number, license_expiry, date_of_birth, dl_state, street_address, apt_unit, city, state, zip_code, alt_contact_name, alt_contact_phone",
      );
    const byName = new Map<string, NonNullable<typeof drivers>[number]>();
    for (const d of drivers ?? []) if (d.full_name) byName.set(normName(d.full_name), d);

    let nextId = await maxNumericId("drivers");
    const plans: CustomerPlan[] = [];
    let created = 0, enriched = 0, skipped = 0, conflictCount = 0;
    const seen = new Set<string>();

    for (let i = 0; i < data.rows.length; i++) {
      const { name, fields } = mapCustomer(data.rows[i]);
      if (!name) {
        plans.push({ row: i + 1, action: "skip", name: "", fills: [], conflicts: [], note: "No name found" });
        skipped++;
        continue;
      }
      const key = normName(name);
      if (seen.has(key)) {
        plans.push({ row: i + 1, action: "skip", name, fills: [], conflicts: [], note: "Duplicate in file" });
        skipped++;
        continue;
      }
      seen.add(key);

      const found = byName.get(key);
      if (found) {
        const fills: { field: string; value: string }[] = [];
        const conflicts: { field: string; existing: string; csv: string }[] = [];
        const patch: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(fields)) {
          const cur = (found as Record<string, unknown>)[field];
          const curStr = cur == null ? "" : String(cur).trim();
          if (curStr === "") {
            patch[field] = value;
            fills.push({ field, value });
          } else if (curStr.toLowerCase() !== value.toLowerCase()) {
            conflicts.push({ field, existing: curStr, csv: value });
          }
        }
        if (conflicts.length) conflictCount += conflicts.length;
        if (fills.length === 0 && conflicts.length === 0) {
          plans.push({ row: i + 1, action: "skip", name, id: found.id, fills: [], conflicts: [], note: "Already complete" });
          skipped++;
          continue;
        }
        plans.push({ row: i + 1, action: "enrich", name, id: found.id, fills, conflicts });
        enriched++;
        if (data.commit && Object.keys(patch).length) {
          patch.import_source = "fleet_finesse";
          await supabaseAdmin.from("drivers").update(patch as never).eq("id", found.id);
        }
      } else {
        nextId++;
        const id = `D-${nextId}`;
        const fills = Object.entries(fields).map(([field, value]) => ({ field, value }));
        plans.push({ row: i + 1, action: "create", name, id, fills, conflicts: [] });
        created++;
        if (data.commit) {
          await supabaseAdmin.from("drivers").insert({
            id,
            full_name: name,
            phone: fields.phone ?? "",
            email: fields.email ?? "",
            license_number: fields.license_number ?? "",
            license_expiry: fields.license_expiry ?? "2099-12-31",
            first_name: fields.first_name ?? null,
            last_name: fields.last_name ?? null,
            date_of_birth: fields.date_of_birth ?? null,
            dl_state: fields.dl_state ?? null,
            street_address: fields.street_address ?? null,
            apt_unit: fields.apt_unit ?? null,
            city: fields.city ?? null,
            state: fields.state ?? null,
            zip_code: fields.zip_code ?? null,
            alt_contact_name: fields.alt_contact_name ?? null,
            alt_contact_phone: fields.alt_contact_phone ?? null,
            status: "active",
            tags: "Fleet Finesse Migration",
            import_source: "fleet_finesse",
          } as never);
          byName.set(key, { id, full_name: name } as never);
        }
      }
    }

    return { plans, created, enriched, skipped, conflicts: conflictCount, committed: !!data.commit };
  });
