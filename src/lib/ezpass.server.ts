import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface ExtractedToll {
  violation_date: string | null; // YYYY-MM-DD
  violation_time: string | null;
  plate: string | null;
  location: string | null;
  amount: number;
  reference_number: string | null; // EZPass Toll Bill / Notice / Reference #
  /** Authority text detected on the page header/letterhead (e.g. "Delaware
   *  River Port Authority"). Used at ingest time to lock the authority key
   *  BEFORE falling back to plaza/plate heuristics. */
  authority_text: string | null;
  authority_key: AuthorityKey;
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
  | "drpa"
  | "sjta"
  | null;

export interface RefAndAuthorityResult {
  reference_number: string | null;
  authority_key: AuthorityKey;
  raw_authority_text: string | null;
  confidence: number; // 0-100
}

/** Extra fields captured when re-OCRing a stored notice document. */
export interface RefCandidate {
  label: string; // The label text next to the number (e.g. "Bill No", "Notice #"), or "unlabeled".
  number: string; // The digit/alphanumeric string as printed.
}

export interface RefExtractExtras {
  notice_type: "original" | "second" | "final" | "past_due" | "prior" | null;
  secondary_number: string | null; // A second identifying number printed on the notice (e.g. prior bill # on a second notice).
  candidates: RefCandidate[]; // All plausible identifiers the OCR could see on the page.
}

export type RefAndAuthorityFullResult = RefAndAuthorityResult & RefExtractExtras;

// Plate normalization now lives in the shared client-safe module so both the
// server and browser (Manual Match dialog, etc.) use identical rules.
// See src/lib/plate.ts for the canonical implementation and rationale.
export { normalizePlate } from "@/lib/plate";
import { normalizePlate } from "@/lib/plate";

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
  if (/drpa|delaware\s*river\s*port|ben\s*franklin|walt\s*whitman|commodore\s*barry|betsy\s*ross/.test(t))
    return "drpa";
  if (/sjta|south\s*jersey\s*transportation|atlantic\s*city\s*expressway/.test(t)) return "sjta";
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

/**
 * Map a toll plaza / location string (and the plate) to an issuing authority.
 * Used at ingest time so every violation gets an authority auto-populated —
 * admins never have to enter it manually. Defaults to nj_ezpass for NJ plates
 * (every vehicle in this fleet has NJ plates), so we always return a usable
 * authority key rather than null.
 */
export function detectAuthorityFromLocation(
  location: string | null | undefined,
  plate: string | null | undefined,
): AuthorityKey {
  const loc = (location ?? "").toUpperCase();
  if (loc) {
    // DRPA bridges: Ben Franklin (BFB), Walt Whitman (WWB), Commodore Barry (CBB), Betsy Ross (BRB)
    if (/\b(BFB|WWB|CBB|BRB)\b|BEN\s*FRANKLIN|WALT\s*WHITMAN|COMMODORE\s*BARRY|BETSY\s*ROSS|DRPA/.test(loc)) {
      return "drpa";
    }
    // SJTA — Atlantic City Expressway
    if (/\bACE\b|ATLANTIC\s*CITY|SJTA|EXPRESSWAY/.test(loc)) return "sjta";
    // NJ Turnpike interchange codes (e.g. 40E / 40W / 06E) + Garden State Parkway (41E/41W) — both run by NJTA
    if (/NJ\s*TURNPIKE|NJTP\b|TURNPIKE|GARDEN\s*STATE|GSP\b|NJTA|\b\d{2}[EW]\b/.test(loc)) {
      return "nj_turnpike";
    }
    // PA Turnpike
    if (/PA\s*TURNPIKE|PENNSYLVANIA\s*TURNPIKE/.test(loc)) return "pa_turnpike";
    // Philadelphia Parking Authority
    if (/PPA|PHILADELPHIA\s*PARKING/.test(loc)) return "ppa";
  }
  // Plate-state fallback: every fleet vehicle has NJ plates → default NJ E-ZPass.
  const p = (plate ?? "").toUpperCase();
  if (/^\(?NY\)?[\s/.\-]/.test(p)) return "ny_ezpass";
  if (/^\(?PA\)?[\s/.\-]/.test(p)) return "pa_turnpike";
  return "nj_ezpass";
}

/** Re-OCR a stored document to recover the reference number AND detect the
 *  issuing authority. Uses a broader label set than the original extractor. */
export async function extractRefAndAuthorityFromUrl(
  url: string,
): Promise<RefAndAuthorityFullResult> {
  const empty: RefAndAuthorityFullResult = {
    reference_number: null,
    authority_key: null,
    raw_authority_text: null,
    confidence: 0,
    notice_type: null,
    secondary_number: null,
    candidates: [],
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
              'You read toll authority / parking / traffic violation notices (originals AND second/final/past-due notices). Scan the ENTIRE page — header, body, footer, remit stub, boxed regions — not just the top. Return ONLY JSON with this exact shape: {"reference_number":string,"authority_text":string,"confidence":number,"notice_type":"original"|"second"|"final"|"past_due"|"prior"|"","secondary_number":string,"candidates":[{"label":string,"number":string}]}. reference_number = THE primary identifier printed on this notice. Recognize ANY of these labels (in priority order): "Toll Bill No", "Bill No", "Violation No", "Violation #", "Notice No", "Notice #", "Statement No", "Statement #", "Invoice No", "Invoice #", "Reference No", "Reference #", "Account No", "Account #", "Transaction No", "Transaction #", "Citation No", "Citation #", "Case No", "Docket No", "PLEASE REFERENCE". Also accept any prominent standalone long digit/alphanumeric string (9+ characters) shown in a header or boxed region even if unlabeled — pick the most prominent one as reference_number in that case. Copy it EXACTLY as printed, including any letter prefix; empty string only if truly unreadable. If the document is a Second Notice / Final Notice / Past Due / Prior Notice (look for those exact words), set notice_type accordingly and, if the notice references an EARLIER bill/notice number in addition to its own current identifier, put the earlier one in secondary_number. Otherwise notice_type is "original" (or "" if unclear) and secondary_number is "". authority_text = the issuing organization exactly as printed (e.g. "New Jersey E-ZPass", "PA Turnpike", "Philadelphia Parking Authority", "NJ MVC"). candidates = a de-duplicated list of EVERY plausible identifier you can see anywhere on the page — for each, put the label text you saw next to it (or "unlabeled" if none) and the number/string exactly as printed. Include the primary reference_number in candidates too. Order candidates by prominence (most prominent first). Cap at 10. confidence = 0-100 integer for how sure you are about reference_number. No prose, no code fences.',
          },
          {
            role: "user",
            content: [
              { type: "text", text: "Read the reference number, issuing authority, notice type, and every candidate identifier from this notice. Search the whole page." },
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
    const normRef = (s: string) =>
      s.replace(/[^A-Za-z0-9-]/g, "").toUpperCase().slice(0, 40);
    const ref = normRef(cleanStr(parsed.reference_number)) || null;
    const secondary = normRef(cleanStr(parsed.secondary_number)) || null;
    const authText = cleanStr(parsed.authority_text) || null;
    const conf = Number(parsed.confidence);
    const nt = cleanStr(parsed.notice_type).toLowerCase();
    const notice_type = (["original", "second", "final", "past_due", "prior"] as const).includes(
      nt as never,
    )
      ? (nt as RefExtractExtras["notice_type"])
      : null;
    const rawCandidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
    const seen = new Set<string>();
    const candidates: RefCandidate[] = [];
    for (const c of rawCandidates) {
      const o = (c ?? {}) as Record<string, unknown>;
      const label = cleanStr(o.label).slice(0, 40) || "unlabeled";
      const number = normRef(cleanStr(o.number));
      if (!number || number.length < 5) continue;
      if (seen.has(number)) continue;
      seen.add(number);
      candidates.push({ label, number });
      if (candidates.length >= 10) break;
    }
    return {
      reference_number: ref,
      authority_key: detectAuthorityFromText(authText),
      raw_authority_text: authText,
      confidence: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 0,
      notice_type,
      secondary_number: secondary && secondary !== ref ? secondary : null,
      candidates,
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

/** Validate an extracted violation date. Must be a real date, in the past
 *  (allow a small clock-skew tolerance), and within the last 5 years.
 *  Returns null if invalid so callers can flag for manual entry. */
function validateViolationDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  // Allow up to 2 days in the future for timezone/clock skew.
  const maxFuture = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
  if (d.getTime() > maxFuture.getTime()) return null;
  const fiveYearsAgo = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
  if (d.getTime() < fiveYearsAgo.getTime()) return null;
  return iso;
}

/** Validate extracted amount. Positive, under $10k sanity cap. */
function validateAmount(n: number): number {
  if (!Number.isFinite(n) || n <= 0 || n >= 10000) return 0;
  return n;
}

/** Validate normalized plate: 4-8 alphanumeric chars. */
function validatePlate(p: string | null): string | null {
  if (!p) return null;
  if (!/^[A-Z0-9]{4,8}$/.test(p)) return null;
  return p;
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
                'You read toll authority statements (EZPass, DRPA, SJTA, NJTA, PA Turnpike). Extract ONLY from specific labeled fields. NEVER guess. If a field is not clearly present under an allowed label, return an empty string / 0 — a blank field is ALWAYS better than a wrong one.\n\nReturn ONLY compact JSON with this exact shape: {"authority_text":string,"violations":[{"date":string,"time":string,"plate_number":string,"toll_location":string,"amount":number,"reference_number":string}]}. No prose, no code fences.\n\nSTEP 1 — AUTHORITY (letterhead/header/return address only):\n"Delaware River Port Authority" → "Delaware River Port Authority"\n"NJ E-ZPass" / "E-ZPass New Jersey" → "NJ E-ZPass"\n"SJTA" / "South Jersey Transportation Authority" / "Atlantic City Expressway" → "SJTA"\n"NJ Turnpike Authority" / "Garden State Parkway" → "NJ Turnpike Authority"\n"PA Turnpike" → "PA Turnpike"\n"NY E-ZPass" / "MTA" / "Port Authority NY/NJ" → "NY E-ZPass"\nDefault when only a bare E-ZPass logo is visible: "NJ E-ZPass".\n\nSTEP 2 — VIOLATION ROWS. For DRPA notices the source is the "RECORDED VIOLATION TRANSACTIONS" table with columns: Violation Number | License Plate | Toll Plaza | Lane | Date | Time | Toll Due | Admin Fee. For NJ E-ZPass toll bills the source is the transaction table with columns like Transaction Date / Trip Date / Date | Plaza | Lane | Amount. Emit one violation object per row in that table.\n\nFIELD RULES (strict):\n\n• date — ONLY from the transaction-table "Date" / "Transaction Date" / "Trip Date" column, or an explicit "Bill Date" on E-ZPass. NEVER use "Notice Date", "Statement Date", "Print Date", "Due Date", "Payment Due", "Pay By", "Response Due", "Mail Date", or any deadline. Format MM/DD/YYYY. Convert MM/DD/YY by assuming 20YY. If uncertain, return "".\n\n• time — as shown in the same table row. Empty string if absent.\n\n• plate_number — from the "License Plate" column of the transaction table, or an explicit "License Plate:" field. Copy the plate exactly. Do NOT include state prefixes/suffixes like "(NJ)" or trailing " NJ". Empty string if absent.\n\n• toll_location — the "Toll Plaza" / "Plaza" / "Lane" / bridge or exit for that row (e.g. "BFB", "WWB", "40W", "Atlantic City Expressway"). Empty string if absent.\n\n• amount — positive USD decimal from the SAME row. If the row has "Toll Due" AND "Admin Fee" columns, RETURN THEIR SUM (e.g. Toll Due 6.00 + Admin Fee 25.00 = 31.00). NEVER use "Total Amount Due" / "Balance Due" / "Total Due" from a payment/remit summary — that can aggregate multiple violations plus penalties. 0 if unreadable.\n\n• reference_number — the official identifier for THIS violation row. Allowed labels ONLY: "Toll Bill No", "Bill No", "Violation#", "Violation No", "Violation Number", "Violation #", "Notice No", "Notice #", "Citation No", "Reference #" (when printed next to the row), or a prominent boxed identifier starting with "B0", "T0", or "T1" (e.g. "T072675709202", "B062675392939"). NEVER use "Account No" / "Account #" — that is the recipient\'s EZPass account, not the violation. If a single bill/notice number applies to every row on the page, repeat it on each row. Copy exactly as printed, including any letter prefix. Empty string only if truly not found.\n\nIf no violation transaction table is visible, return {"authority_text":"","violations":[]}.\n',
            },
            {
              role: "user",
              content: [
                { type: "text", text: "Extract every row from the violation/transaction table using the strict rules. Blank is better than wrong." },
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
      const pageAuthorityText =
        typeof (parsed as { authority_text?: unknown }).authority_text === "string"
          ? ((parsed as { authority_text: string }).authority_text).trim()
          : "";
      const pageAuthorityKey = detectAuthorityFromText(pageAuthorityText) || null;
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
        const rawDate = normDate(cleanStr(o.date));
        const validDate = validateViolationDate(rawDate);
        if (rawDate && !validDate) {
          console.warn(`[ezpass] discarded out-of-range date ${rawDate}`);
        }
        const rawPlate = normalizePlate(cleanStr(o.plate_number)) || null;
        const validPlate = validatePlate(rawPlate);
        const amount = validateAmount(cleanNum(o.amount));
        const rawRef = cleanStr(o.reference_number);
        // Reject obvious account-number contamination (some notices print
        // "Account No" near the header even when we forbid it).
        const ref = rawRef && !/^ACCT|^ACCOUNT/i.test(rawRef) ? rawRef : "";
        all.push({
          violation_date: validDate,
          violation_time: cleanStr(o.time) || null,
          plate: validPlate,
          location: cleanStr(o.toll_location) || null,
          amount,
          reference_number: ref || null,
          authority_text: pageAuthorityText || null,
          authority_key: pageAuthorityKey,
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
