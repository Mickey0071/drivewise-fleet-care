/**
 * GoHighLevel Vehicle Availability Sync
 *
 * Synchronises vehicle availability status with GoHighLevel Custom Values.
 * Called from every server-side function that changes a vehicle's status.
 *
 * Rules:
 * - Vehicle becomes unavailable (rented / maintenance / inspection / impound)
 *   → custom value = "unavailable"
 * - Vehicle becomes available again
 *   → custom value = "available"
 *
 * Mapping is based on (year, make, model, color) from the vehicles table.
 * Only the 13 pre-approved custom values are ever written.
 *
 * Environment variables:
 *   ghlPitToken      – GoHighLevel Private Integration Token
 *   ghlLocationId    – GoHighLevel Location ID
 *
 * Failure-safe: if the GHL request fails the caller's normal workflow is
 * never interrupted (logged to console.error).
 */

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";
const GHL_TIMEOUT_MS = 12000;

/* ------------------------------------------------------------------ */
/*  Vehicle → Custom-Value mapping                                    */
/* ------------------------------------------------------------------ */

interface VehicleKey {
  year: number;
  make: string;
  model: string;
  color: string | null;
}

/**
 * Normalise free-text fields (case, whitespace, common punctuation).
 */
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Make aliases — DB rows use both "CHEVY" and "Chevrolet", etc. */
const MAKE_ALIASES: Record<string, string> = {
  chevy: "chevrolet",
  chev: "chevrolet",
};
function canonMake(make: string): string {
  const m = norm(make);
  return MAKE_ALIASES[m] ?? m;
}

/** Model aliases — accept common misspellings / abbreviations. */
const MODEL_ALIASES: Record<string, string> = {
  forrester: "forester", // DB has "FORRESTER"
};
function canonModelBase(model: string): string {
  // Take the first token so trailing trim levels ("LTZ", "GLS", "AWD SE",
  // "California 2.4", "EX 2.4", "Bro", "(Blue)", "lt") do not break the match.
  const first = norm(model).split(/[\s(]/)[0] ?? "";
  return MODEL_ALIASES[first] ?? first;
}

/** Color aliases — "dark grey" folds to "grey", "gray" folds to "grey". */
function canonColor(color: string | null): string {
  const c = norm(color).replace(/\bgray\b/g, "grey");
  // Strip qualifiers so "dark grey" / "light blue" still match "grey" / "blue".
  return c.replace(/^(dark|light|bright|deep)\s+/, "");
}

/**
 * Ordered mapping table. First entry that matches (make + model prefix + year
 * + color, with color being flexible for "grey"/"dark grey") wins.
 */
interface MappingEntry {
  make: string;
  model: string;
  year: number;
  color: string;
  id: string;
  name: string;
}
const MAPPING: readonly MappingEntry[] = [
  { make: "nissan",    model: "altima",   year: 2014, color: "grey",   id: "KlCQkhhXFkIIRpWrqwjz", name: "Nissan Altima 2014 Dark Grey" },
  { make: "chevrolet", model: "malibu",   year: 2015, color: "red",    id: "JO3SasqrsaX3ot2mzeE8", name: "Chevrolet Malibu 2015 Red" },
  { make: "chevrolet", model: "malibu",   year: 2015, color: "grey",   id: "bIHURGn9XHjsHuHrJepP", name: "Chevrolet Malibu 2015 Grey" },
  { make: "gmc",       model: "terrain",  year: 2012, color: "black",  id: "pnicSg0l6DQG7jRyeIY2", name: "GMC Terrain 2012 Black" },
  { make: "subaru",    model: "forester", year: 2015, color: "blue",   id: "Ssp6FNAHY3G4DEnZ7COB", name: "Subaru Forester 2015 Blue" },
  { make: "hyundai",   model: "elantra",  year: 2013, color: "white",  id: "GTfW1Z6czXQ9lpeQaOgS", name: "Hyundai Elantra 2013 White" },
  { make: "chevrolet", model: "impala",   year: 2007, color: "grey",   id: "SpiUveTXUh4hrw1S1nOy", name: "Chevrolet Impala 2007 Grey" },
  { make: "chrysler",  model: "200",      year: 2015, color: "silver", id: "YaZtJxDfpPKy9DZXDB4X", name: "Chrysler 200 2015 Silver" },
  { make: "kia",       model: "optima",   year: 2015, color: "black",  id: "4NFQDK3SrxiHj6kYPCxM", name: "Kia Optima 2015 Black" },
  { make: "ford",      model: "fusion",   year: 2014, color: "red",    id: "jmdaiPRmS7wwWEaNUU8e", name: "Ford Fusion 2014 Red" },
  { make: "ford",      model: "fusion",   year: 2016, color: "red",    id: "Cg2g7S2hexGl2ICPOl2Z", name: "Ford Fusion 2016 Red" },
  { make: "hyundai",   model: "sonata",   year: 2014, color: "black",  id: "PEGxXhCCsrVGksGcDMm1", name: "Hyundai Sonata 2014 Black" },
  { make: "ford",      model: "edge",     year: 2011, color: "white",  id: "1kBGgYCT9fmYLRpBIu6J", name: "Ford Edge 2011 White" },
];

/**
 * Normalise a vehicle identity into the GHL Custom Value ID.
 * Returns null when the vehicle is not in the approved 13-vehicle list.
 */
export function vehicleToCustomValueKey(v: VehicleKey): string | null {
  const make = canonMake(v.make);
  const model = canonModelBase(v.model);
  const color = canonColor(v.color);
  const year = v.year;
  const hit = MAPPING.find(
    (m) => m.make === make && m.model === model && m.year === year && m.color === color,
  );
  return hit?.id ?? null;
}

/** Human-readable name written alongside the value on PUT. */
function customValueNameForId(id: string): string {
  return MAPPING.find((m) => m.id === id)?.name ?? id;
}

/**
 * Given a vehicle status string, return the GHL custom-value payload
 * or null when the status is ambiguous (no change).
 */
export function availabilityFromStatus(
  status: string | null | undefined,
): string | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s === "available") return "available";
  // Everything else = unavailable
  if (["rented", "maintenance", "inspection", "impound"].includes(s)) {
    return "unavailable";
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Low-level GHL helpers                                             */
/* ------------------------------------------------------------------ */

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = GHL_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      throw new Error(`GHL request timed out after ${timeoutMs}ms: ${url}`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Update a single custom value on the configured GHL location.
 * Returns true on success, false on any failure (caller logs).
 */
async function updateCustomValue(
  customValueId: string,
  value: string,
): Promise<boolean> {
  // Prefer the dedicated vehicle-sync PIT so we don't risk changing the token
  // used by other GHL flows (contacts, SMS, etc.). Fall back to the shared
  // PIT if the dedicated one hasn't been set.
  const token =
    process.env.GHL_VEHICLE_SYNC_PIT_TOKEN ??
    process.env.ghlPitToken ??
    process.env.GHL_PIT_TOKEN;
  const locationId = process.env.ghlLocationId ?? process.env.GHL_LOCATION_ID;
  if (!token || !locationId) {
    console.warn(
      `[ghl-vehicle-sync] skipped — ghlPitToken / ghlLocationId not configured`,
    );
    return false;
  }

  try {
    const res = await fetchWithTimeout(
      `${GHL_BASE}/locations/${encodeURIComponent(locationId)}/customValues/${encodeURIComponent(customValueId)}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name: customValueNameForId(customValueId),
          value,
        }),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GHL customValue ${res.status}: ${text}`);
    }
    return true;
  } catch (e) {
    console.error(
      `[ghl-vehicle-sync] update failed id=${customValueId} value=${value}: ${e instanceof Error ? e.message : String(e)}`,
    );
    return false;
  }
}

/* ------------------------------------------------------------------ */
/*  Public API                                                        */
/* ------------------------------------------------------------------ */

export interface GhlSyncResult {
  ok: boolean;
  customValueKey: string | null;
  status: string;
  skipped: boolean;
  reason?: string;
}

/**
 * Sync a single vehicle's availability to GoHighLevel.
 *
 * Usage pattern in every server function that updates vehicle status:
 *
 *   // After the DB write succeeds:
 *   await syncVehicleAvailabilityToGhl(vehicleId);
 *
 * This is intentionally best-effort — failures are logged but never throw.
 */
export async function syncVehicleAvailabilityToGhl(
  vehicleId: string,
): Promise<GhlSyncResult> {
  try {
    console.log(`[ghl-vehicle-sync] requested for vehicle=${vehicleId}`);
    // We need a lightweight way to read the vehicle row.  Because this
    // module is imported by server functions that already have supabaseAdmin
    // imported, we accept the vehicle row data passed in to avoid a second
    // DB round-trip.  However, we also expose a version that fetches by id.
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { data, error } = await supabaseAdmin
      .from("vehicles")
      .select("id, year, make, model, color, status")
      .eq("id", vehicleId)
      .maybeSingle();
    if (error || !data) {
      console.warn(`[ghl-vehicle-sync] skipped vehicle=${vehicleId} — vehicle not found`);
      return { ok: false, customValueKey: null, status: "", skipped: true, reason: "vehicle not found" };
    }
    return syncWithVehicleRow(data);
  } catch (e) {
    console.error(
      `[ghl-vehicle-sync] sync for ${vehicleId} threw: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { ok: false, customValueKey: null, status: "", skipped: true };
  }
}

/**
 * Sync availability when the caller already has the vehicle row.
 * Saves one extra DB query.
 */
export function syncWithVehicleRow(
  vehicle: {
    id: string;
    year: number;
    make: string;
    model: string;
    color: string | null;
    status: string;
  },
): Promise<GhlSyncResult> {
  return (async () => {
    const customValueKey = vehicleToCustomValueKey({
      year: vehicle.year,
      make: vehicle.make,
      model: vehicle.model,
      color: vehicle.color,
    });

    if (!customValueKey) {
      console.warn(
        `[ghl-vehicle-sync] skipped vehicle=${vehicle.id} — no mapping for ${vehicle.year} ${vehicle.make} ${vehicle.model} ${vehicle.color ?? ""}`,
      );
      return {
        ok: false,
        customValueKey: null,
        status: vehicle.status,
        skipped: true,
        reason: "vehicle not in approved mapping",
      };
    }

    const value = availabilityFromStatus(vehicle.status);
    if (!value) {
      console.warn(
        `[ghl-vehicle-sync] skipped vehicle=${vehicle.id} customValue=${customValueKey} — unknown status ${vehicle.status}`,
      );
      return {
        ok: false,
        customValueKey,
        status: vehicle.status,
        skipped: true,
        reason: "unknown status",
      };
    }

    const ok = await updateCustomValue(customValueKey, value);
    console.log(
      `[ghl-vehicle-sync] ${vehicle.year} ${vehicle.make} ${vehicle.model} → ${customValueKey} = "${value}" (${ok ? "ok" : "failed"})`,
    );
    return { ok, customValueKey, status: vehicle.status, skipped: false };
  })();
}
