import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ExtractedToll {
  violation_date: string | null; // YYYY-MM-DD
  violation_time: string | null;
  plate: string | null;
  location: string | null;
  amount: number;
  reference_number: string | null; // EZPass Toll Bill / Notice / Reference #
}

/** Known authority keys we can map to a statute in liability-transfer.server.ts.
 *  Anything else is left null and flagged for review. */
export type AuthorityKey =
  | "nj_ezpass"
  | "ny_ezpass"
  | "nj_turnpike"
  | "pa_turnpike"
  | "ppa"
  | "nj_mvc"
  | null;

export interface RefAndAuthorityResult {
  reference_number: string | null;
  authority_key: AuthorityKey;
  raw_authority_text: string | null;
  confidence: number; // 0-100
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

/** Fetch a remote image URL (signed Supabase URL, etc.) and inline it as a
 *  data URL so the AI Gateway can accept it. Returns null on failure. */
async function urlToDataUrl(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`[ezpass] fetch ${res.status} for ${url.slice(0, 120)}`);
      return null;
    }
    const ct = res.headers.get("content-type") || "image/jpeg";
    // PDFs are not accepted as image_url; skip.
    if (!ct.startsWith("image/")) {
      console.error(`[ezpass] unsupported content-type ${ct}`);
      return null;
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(buf).toString("base64");
    return `data:${ct};base64,${b64}`;
  } catch (e) {
    console.error(`[ezpass] urlToDataUrl error`, e);
    return null;
  }
}

function detectAuthorityFromText(text: string | null | undefined): AuthorityKey {
  const t = (text ?? "").toLowerCase();
  if (!t) return null;
  if (/philadelphia|ppa|phila\.?\s*parking/.test(t)) return "ppa";
  if (/pa\s*turnpike|pennsylvania\s*turnpike/.test(t)) return "pa_turnpike";
  if (/nj\s*turnpike|new\s*jersey\s*turnpike|garden\s*state\s*parkway|njta/.test(t))
    return "nj_turnpike";
  if (/(mta|tbta|port\s*authority|thruway|ny\s*e-?z\s*pass|new\s*york\s*e-?z\s*pass)/.test(t))
    return "ny_ezpass";
  if (/(nj\s*mvc|motor\s*vehicle\s*commission)/.test(t)) return "nj_mvc";
  if (/(nj\s*e-?z\s*pass|new\s*jersey\s*e-?z\s*pass|e-?zpass\s*(nj|new\s*jersey))/.test(t))
    return "nj_ezpass";
  if (/e-?z\s*pass|ezpass/.test(t)) return "nj_ezpass"; // best-guess default for bare EZPass
  return null;
}

/** Re-OCR a stored document to recover the reference number AND detect the
 *  issuing authority. Uses a broader label set than the original extractor. */
export async function extractRefAndAuthorityFromUrl(
  url: string,
): Promise<RefAndAuthorityResult> {
  const empty: RefAndAuthorityResult = {
    reference_number: null,
    authority_key: null,
    raw_authority_text: null,
    confidence: 0,
  };
  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) {
    console.error("[ezpass] LOVABLE_API_KEY missing");
    return empty;
  }
  const dataUrl = await urlToDataUrl(url);
  if (!dataUrl) return empty;

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
              'You read toll authority / parking / traffic violation notices. Return ONLY JSON: {"reference_number":string,"authority_text":string,"confidence":number}. reference_number is THE single official identifier for this notice (Toll Bill No, Bill No, Reference #, Notice #, Violation #, Invoice #, Statement #, Account #, Transaction #, Docket #, Case #, or any prominent long-digit/alphanumeric string in a header, boxed region, or under a "PLEASE REFERENCE" instruction). Copy it EXACTLY as printed with any letter prefix; empty string if truly unreadable. authority_text is the name of the issuing organization printed on the notice (e.g. "New Jersey E-ZPass", "PA Turnpike", "Philadelphia Parking Authority", "NJ MVC"). confidence 0-100 integer. No prose, no code fences.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Read the reference number and issuing authority from this notice." },
              { type: "image_url", image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      console.error(`[ezpass] re-extract gateway ${res.status}: ${t.slice(0, 300)}`);
      return empty;
    }
    const json = (await res.json().catch(() => null)) as
      | { choices?: Array<{ message?: { content?: string } }> }
      | null;
    let raw = json?.choices?.[0]?.message?.content;
    if (typeof raw !== "string") return empty;
    raw = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error("[ezpass] re-extract parse failed:", raw.slice(0, 200));
      return empty;
    }
    const cleanStr = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const ref = cleanStr(parsed.reference_number)
      .replace(/[^A-Za-z0-9-]/g, "")
      .toUpperCase()
      .slice(0, 40) || null;
    const authText = cleanStr(parsed.authority_text) || null;
    const conf = Number(parsed.confidence);
    return {
      reference_number: ref,
      authority_key: detectAuthorityFromText(authText),
      raw_authority_text: authText,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 0,
    };
  } catch (e) {
    console.error("[ezpass] re-extract error", e);
    return empty;
  }
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
