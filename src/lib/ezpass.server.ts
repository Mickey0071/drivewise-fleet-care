import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ExtractedToll {
  violation_date: string | null; // YYYY-MM-DD
  violation_time: string | null;
  plate: string | null;
  location: string | null;
  amount: number;
  reference_number: string | null; // EZPass Toll Bill / Notice / Reference #
}

/**
 * Normalize a license plate for matching. Order matters:
 * 1. Uppercase + trim leading/trailing whitespace and newlines.
 * 2. Strip a leading state prefix (optional parens, 2 letters, optional
 *    close paren) followed by one or more separators (space, slash, dash,
 *    dot) — done BEFORE stripping punctuation so the delimiter anchors it.
 *    e.g. "NJ/XPSD76" -> "XPSD76", "(NJ) S80WST" -> "S80WST", but
 *    "N90VCG" and "AB1234" are left intact.
 * 3. Remove all remaining spaces, dashes, dots, and slashes.
 */
export function normalizePlate(p: string | null | undefined): string {
  let s = (p ?? "").toUpperCase().trim();
  s = s.replace(/^\(?[A-Z]{2}\)?[\s/.\-]+/, "");
  s = s.replace(/[\s/.\-]/g, "");
  return s;
}

function normDate(v: string): string | null {
  const s = (v || "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/.exec(s);
  if (m) {
    let [, mo, d, y] = m;
    if (y.length === 2) y = (Number(y) > 50 ? "19" : "20") + y;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return null;
}

/** Run Gemini vision over a set of image data URLs and return all toll rows found. */
export async function extractTollsFromImages(dataUrls: string[]): Promise<ExtractedToll[]> {
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[ezpass] LOVABLE_API_KEY missing");
    return [];
  }
  const all: ExtractedToll[] = [];
  for (const url of dataUrls) {
    if (!url.startsWith("data:image/")) continue;
    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            {
              role: "system",
              content:
                'You read EZPass / toll authority statements. Extract EVERY toll/violation line item. Return ONLY a compact JSON object: {"violations":[{"date":string,"time":string,"plate_number":string,"toll_location":string,"amount":number,"reference_number":string}]}. date format MM/DD/YYYY. time as shown (24h or 12h, empty string if absent). plate_number exactly as printed (empty string if absent). toll_location is the plaza/exit/road. amount is a positive USD decimal number. reference_number is the official EZPass identifier for this violation/toll, found under labels like "Toll Bill No", "Bill No", "Reference #", "Notice #", "Violation #", or "Invoice #" (e.g. "B062675392939"); copy it exactly as printed, empty string if absent. If a single bill/notice number applies to all line items on the page, repeat it on each. If no violations are visible return {"violations":[]}. No prose, no code fences.',
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract all toll violations from this statement page." },
                { type: "image_url", image_url: { url } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        console.error(`[ezpass] gateway ${res.status}: ${t.slice(0, 300)}`);
        continue;
      }
      const json = (await res.json().catch(() => null)) as
        | { choices?: Array<{ message?: { content?: string } }> }
        | null;
      let raw = json?.choices?.[0]?.message?.content;
      if (typeof raw !== "string") continue;
      raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
      let parsed: { violations?: unknown } = {};
      try {
        parsed = JSON.parse(raw);
      } catch {
        console.error("[ezpass] parse failed:", raw.slice(0, 200));
        continue;
      }
      const rows = Array.isArray(parsed.violations) ? parsed.violations : [];
      for (const r of rows) {
        const o = (r ?? {}) as Record<string, unknown>;
        const cleanStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
        const cleanNum = (v: unknown) => {
          const n =
            typeof v === "number"
              ? v
              : typeof v === "string"
                ? parseFloat(v.replace(/[^0-9.\-]/g, ""))
                : NaN;
          return Number.isFinite(n) ? Math.abs(n) : 0;
        };
        all.push({
          violation_date: normDate(cleanStr(o.date)),
          violation_time: cleanStr(o.time) || null,
          plate: cleanStr(o.plate_number).toUpperCase() || null,
          location: cleanStr(o.toll_location) || null,
          amount: cleanNum(o.amount),
          reference_number: cleanStr(o.reference_number) || null,
        });
      }
    } catch (e) {
      console.error("[ezpass] extraction error:", e);
    }
  }
  return all;
}

export interface MatchCandidate {
  rental_id: string;
  driver_id: string | null;
  driver_name: string | null;
  vehicle_id: string | null;
  start_date: string;
  end_date: string | null;
}

export interface MatchResult {
  match_status: "matched" | "unmatched" | "multiple";
  rental_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  driver_name: string | null;
  candidates: MatchCandidate[] | null;
}

/** Auto-match an extracted toll to a rental by plate + datetime. */
export async function autoMatchToll(toll: ExtractedToll): Promise<MatchResult> {
  const empty: MatchResult = {
    match_status: "unmatched",
    rental_id: null,
    driver_id: null,
    vehicle_id: null,
    driver_name: null,
    candidates: null,
  };
  if (!toll.plate || !toll.violation_date) return empty;

  const date = toll.violation_date;
  const candidates: MatchCandidate[] = [];

  const target = normalizePlate(toll.plate);

  // 1) Live rentals — match by vehicle plate + rental window.
  // Normalize on BOTH sides: fetch vehicles and compare normalized plates.
  const { data: vehicles } = await supabaseAdmin.from("vehicles").select("id, plate");
  const vehicleIds = (vehicles ?? [])
    .filter((v) => target && normalizePlate(v.plate) === target)
    .map((v) => v.id);
  if (vehicleIds.length > 0) {
    const { data: rentals } = await supabaseAdmin
      .from("rentals")
      .select("id, driver_id, vehicle_id, start_date, end_date")
      .in("vehicle_id", vehicleIds)
      .lte("start_date", date)
      .order("start_date", { ascending: false })
      .limit(50);
    const active = (rentals ?? []).filter((r) => !r.end_date || r.end_date >= date);
    const driverIds = Array.from(
      new Set(active.map((r) => r.driver_id).filter(Boolean)),
    ) as string[];
    const { data: drivers } = driverIds.length
      ? await supabaseAdmin.from("drivers").select("id, full_name").in("id", driverIds)
      : { data: [] as { id: string; full_name: string }[] };
    const dMap = new Map((drivers ?? []).map((d) => [d.id, d.full_name]));
    for (const r of active) {
      candidates.push({
        rental_id: r.id,
        driver_id: r.driver_id ?? null,
        driver_name: r.driver_id ? dMap.get(r.driver_id) ?? null : null,
        vehicle_id: r.vehicle_id ?? null,
        start_date: r.start_date,
        end_date: r.end_date ?? null,
      });
    }
  }

  // 2) Migrated / legacy reservations — match by plate + rental window
  if (target) {
    const { data: legacy } = await supabaseAdmin
      .from("legacy_rentals")
      .select(
        "id, plate, renter_name, start_datetime, end_datetime, promoted_rental_id, promoted_driver_id",
      )
      .limit(5000);
    for (const lr of legacy ?? []) {
      if (normalizePlate(lr.plate) !== target) continue;
      const start = lr.start_datetime ? lr.start_datetime.slice(0, 10) : null;
      const end = lr.end_datetime ? lr.end_datetime.slice(0, 10) : null;
      if (start && start > date) continue;
      if (end && end < date) continue;
      const rentalId = lr.promoted_rental_id || lr.id;
      if (candidates.some((c) => c.rental_id === rentalId)) continue;
      candidates.push({
        rental_id: rentalId,
        driver_id: lr.promoted_driver_id ?? null,
        driver_name: lr.renter_name ?? null,
        vehicle_id: null,
        start_date: start ?? date,
        end_date: end,
      });
    }
  }

  if (candidates.length === 0) return empty;

  if (candidates.length === 1) {
    const c = candidates[0];
    return {
      match_status: "matched",
      rental_id: c.rental_id,
      driver_id: c.driver_id,
      vehicle_id: c.vehicle_id,
      driver_name: c.driver_name,
      candidates: null,
    };
  }
  return { ...empty, match_status: "multiple", candidates };
}
