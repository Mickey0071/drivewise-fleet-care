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
 * Normalise a vehicle identity into the GHL custom-value key.
 * Returns null when the vehicle is not in the approved 13-vehicle list.
 */
export function vehicleToCustomValueKey(v: VehicleKey): string | null {
  const make = v.make.toLowerCase();
  const model = v.model.toLowerCase();
  const color = (v.color ?? "").toLowerCase().trim();
  const year = v.year;
  const id = `${make}_${model}_${year}_${color}`;

  const map: Record<string, string> = {
    "nissan_altima_2014_dark grey": "nissan_altima_2014_dark_grey",
    "chevrolet_malibu_2015_red": "chevrolet_malibu_2015_red",
    "chevrolet_malibu_2015_grey": "chevrolet_malibu_2015_grey",
    "gmc_terrain_2012_black": "gmc_terrain_2012_black",
    "subaru_forester_2015_blue": "subaru_forester_2015_blue",
    "hyundai_elantra_2013_white": "hyundai_elantra_2013_white",
    "chevrolet_impala_2007_grey": "chevrolet_impala_2007_grey",
    "chrysler_200_2015_silver": "chrysler_200_2015_silver",
    "kia_optima_2015_black": "kia_optima_2015_black",
    "ford_fusion_2014_red": "ford_fusion_2014_red",
    "ford_fusion_2016_red": "ford_fusion_2016_red",
    "hyundai_sonata_2014_black": "hyundai_sonata_2014_black",
    "ford_edge_2011_white": "ford_edge_2011_white",
  };

  return map[id] ?? null;
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
  customValueKey: string,
  value: string,
): Promise<boolean> {
  const token = process.env.ghlPitToken;
  const locationId = process.env.ghlLocationId;
  if (!token || !locationId) {
    console.warn(
      `[ghl-vehicle-sync] skipped — ghlPitToken / ghlLocationId not configured`,
    );
    return false;
  }

  try {
    const res = await fetchWithTimeout(
      `${GHL_BASE}/locations/${encodeURIComponent(locationId)}/customValues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          locationId,
          customFieldId: customValueKey,
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
      `[ghl-vehicle-sync] update failed key=${customValueKey} value=${value}: ${e instanceof Error ? e.message : String(e)}`,
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
