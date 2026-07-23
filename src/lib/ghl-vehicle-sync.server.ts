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

  // Map vehicle identity → GHL Custom Value ID (from GHL dashboard).
  // The PUT /customValues/{id} endpoint takes the ID, not the name.
  const map: Record<string, string> = {
    "nissan_altima_2014_dark grey": "KlCQkhhXFkIIRpWrqwjz",
    "chevrolet_malibu_2015_red":    "JO3SasqrsaX3ot2mzeE8",
    "chevrolet_malibu_2015_grey":   "bIHURGn9XHjsHuHrJepP",
    "gmc_terrain_2012_black":       "pnicSg0l6DQG7jRyeIY2",
    "subaru_forester_2015_blue":    "Ssp6FNAHY3G4DEnZ7COB",
    "hyundai_elantra_2013_white":   "GTfW1Z6czXQ9lpeQaOgS",
    "chevrolet_impala_2007_grey":   "SpiUveTXUh4hrw1S1nOy",
    "chrysler_200_2015_silver":     "YaZtJxDfpPKy9DZXDB4X",
    "kia_optima_2015_black":        "4NFQDK3SrxiHj6kYPCxM",
    "ford_fusion_2014_red":         "jmdaiPRmS7wwWEaNUU8e",
    "ford_fusion_2016_red":         "Cg2g7S2hexGl2ICPOl2Z",
    "hyundai_sonata_2014_black":    "PEGxXhCCsrVGksGcDMm1",
    "ford_edge_2011_white":         "1kBGgYCT9fmYLRpBIu6J",
  };

  return map[id] ?? null;
}

/** Human-readable name written alongside the value on PUT. */
function customValueNameForId(id: string): string {
  const names: Record<string, string> = {
    KlCQkhhXFkIIRpWrqwjz: "Nissan Altima 2014 Dark Grey",
    JO3SasqrsaX3ot2mzeE8: "Chevrolet Malibu 2015 Red",
    bIHURGn9XHjsHuHrJepP: "Chevrolet Malibu 2015 Grey",
    pnicSg0l6DQG7jRyeIY2: "GMC Terrain 2012 Black",
    Ssp6FNAHY3G4DEnZ7COB: "Subaru Forester 2015 Blue",
    GTfW1Z6czXQ9lpeQaOgS: "Hyundai Elantra 2013 White",
    SpiUveTXUh4hrw1S1nOy: "Chevrolet Impala 2007 Grey",
    YaZtJxDfpPKy9DZXDB4X: "Chrysler 200 2015 Silver",
    "4NFQDK3SrxiHj6kYPCxM": "Kia Optima 2015 Black",
    jmdaiPRmS7wwWEaNUU8e: "Ford Fusion 2014 Red",
    Cg2g7S2hexGl2ICPOl2Z: "Ford Fusion 2016 Red",
    PEGxXhCCsrVGksGcDMm1: "Hyundai Sonata 2014 Black",
    "1kBGgYCT9fmYLRpBIu6J": "Ford Edge 2011 White",
  };
  return names[id] ?? id;
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
