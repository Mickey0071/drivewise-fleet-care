/**
 * Enhanced violation document parser.
 *
 * Pure, client-safe logic that classifies an uploaded violation notice from its
 * OCR text and extracts the *incident* date (when the violation happened) as
 * distinct from the *notice* date (when the document was printed/mailed).
 *
 * incident_date is what we use for renter attribution, statute-of-limitations
 * math on dispute packets, and analytics grouping. notice_date is audit only.
 */

export type ViolationDocumentType = "EZPASS" | "PPA" | "OTHER";

export interface ExtractionDetails {
  matched_pattern: string | null;
  source_text: string | null;
  page_found: number | null;
}

export interface ParsedViolationDocument {
  incident_date: string | null; // YYYY-MM-DD
  notice_date: string | null; // YYYY-MM-DD
  document_type: ViolationDocumentType;
  ocr_confidence: number; // 0-1
  requires_manual_review: boolean;
  extraction_details: ExtractionDetails;
}

export interface OcrPage {
  page: number; // 1-based
  text: string;
}

export const MANUAL_REVIEW_THRESHOLD = 0.75;

/* ------------------------------------------------------------------ */
/* Date helpers                                                        */
/* ------------------------------------------------------------------ */

const DATE_RE =
  /(\d{4}-\d{2}-\d{2})|(\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4})/;
const DATE_RE_G = new RegExp(DATE_RE.source, "g");

/** Normalize MM/DD/YYYY, M-D-YY, or YYYY-MM-DD to YYYY-MM-DD. Null if invalid. */
export function toIsoDate(raw: string | null | undefined): string | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const us = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s);
    if (!us) return null;
    mo = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
    if (us[3].length === 2) y = (y > 50 ? 1900 : 2000) + y;
  }
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  if (y < 1990 || y > 2100) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Plausible violation date: real date, not far in the future, within 6 years. */
export function isPlausibleIncidentDate(iso: string | null): boolean {
  if (!iso) return false;
  const t = new Date(iso + "T00:00:00Z").getTime();
  if (Number.isNaN(t)) return false;
  const now = Date.now();
  if (t > now + 2 * 864e5) return false;
  if (t < now - 6 * 365 * 864e5) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* 1. Document type detection                                          */
/* ------------------------------------------------------------------ */

const EZPASS_SIGNALS = [
  /e-?z\s*pass/i,
  /toll\s*transaction/i,
  /toll\s*bill/i,
  /delinquent\s*toll/i,
];
const PPA_SIGNALS = [
  /\bppa\b/i,
  /parking\s*violation/i,
  /traffic\s*violation/i,
  /\bcitation\b/i,
  /philadelphia/i,
];

export function detectDocumentType(text: string): {
  type: ViolationDocumentType;
  hits: number;
} {
  const t = text ?? "";
  const ez = EZPASS_SIGNALS.filter((r) => r.test(t)).length;
  const ppa = PPA_SIGNALS.filter((r) => r.test(t)).length;
  if (ez > 0 && ez >= ppa) return { type: "EZPASS", hits: ez };
  if (ppa > 0) return { type: "PPA", hits: ppa };
  return { type: "OTHER", hits: 0 };
}

/* ------------------------------------------------------------------ */
/* 2. Labelled date extraction                                         */
/* ------------------------------------------------------------------ */

interface LabelPattern {
  label: string;
  re: RegExp;
}

const EZPASS_INCIDENT_LABELS: LabelPattern[] = [
  { label: "Date of incident", re: /date\s*of\s*incident/i },
  { label: "Incident date", re: /incident\s*date/i },
  { label: "Transaction date", re: /transaction\s*date/i },
  { label: "Date of toll", re: /date\s*of\s*toll/i },
  { label: "Toll date", re: /toll\s*date/i },
  { label: "Trip date", re: /trip\s*date/i },
  { label: "Violation date", re: /violation\s*date|date\s*of\s*violation/i },
];

const PPA_INCIDENT_LABELS: LabelPattern[] = [
  { label: "Violation date", re: /violation\s*date/i },
  { label: "Date of violation", re: /date\s*of\s*violation/i },
  { label: "Incident date", re: /incident\s*date/i },
  { label: "Issue date", re: /date\s*issued|issue\s*date/i },
];

const OTHER_INCIDENT_LABELS: LabelPattern[] = [
  ...PPA_INCIDENT_LABELS,
  ...EZPASS_INCIDENT_LABELS,
  { label: "Date", re: /\bdate\b/i },
];

const NOTICE_LABELS: LabelPattern[] = [
  { label: "Notice date", re: /notice\s*date/i },
  { label: "Statement date", re: /statement\s*date/i },
  { label: "Bill date", re: /bill\s*date/i },
  { label: "Invoice date", re: /invoice\s*date/i },
  { label: "Mail date", re: /mail(?:ed|ing)?\s*date/i },
  { label: "Print date", re: /print(?:ed)?\s*date/i },
  { label: "Date issued", re: /date\s*issued/i },
];

/** Deadline-style labels whose dates must never be treated as an incident. */
const DEADLINE_RE =
  /due\s*date|payment\s*due|pay\s*by|response\s*due|respond\s*by|hearing\s*date|expiration/i;

interface LineHit {
  label: string;
  line: string;
  iso: string;
  page: number;
}

function splitLines(text: string): string[] {
  return (text ?? "")
    .split(/\r?\n|(?:\s{3,})/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** Find the first date on a line that carries one of the given labels. */
function findLabelledDate(
  pages: OcrPage[],
  labels: LabelPattern[],
  opts: { skipDeadlines?: boolean; requirePlausible?: boolean } = {},
): LineHit | null {
  const { skipDeadlines = true, requirePlausible = true } = opts;
  for (const p of pages) {
    const lines = splitLines(p.text);
    for (const pat of labels) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!pat.re.test(line)) continue;
        if (skipDeadlines && DEADLINE_RE.test(line)) continue;
        // Date may sit on the same line, or on the next line (table layouts).
        const scan = [line, lines[i + 1] ?? ""];
        for (const s of scan) {
          const m = DATE_RE_G.exec(s);
          DATE_RE_G.lastIndex = 0;
          if (!m) continue;
          const iso = toIsoDate(m[0]);
          if (!iso) continue;
          if (requirePlausible && !isPlausibleIncidentDate(iso)) continue;
          return { label: pat.label, line: line.slice(0, 200), iso, page: p.page };
        }
      }
    }
  }
  return null;
}

/** Any date anywhere, preferring lines that mention date/incident context. */
function findLooseDate(pages: OcrPage[]): LineHit | null {
  let fallback: LineHit | null = null;
  for (const p of pages) {
    for (const line of splitLines(p.text)) {
      if (DEADLINE_RE.test(line)) continue;
      const m = DATE_RE_G.exec(line);
      DATE_RE_G.lastIndex = 0;
      if (!m) continue;
      const iso = toIsoDate(m[0]);
      if (!iso || !isPlausibleIncidentDate(iso)) continue;
      const hit: LineHit = { label: "unlabeled date", line: line.slice(0, 200), iso, page: p.page };
      if (/date|incident|violation|toll|transaction/i.test(line)) return hit;
      if (!fallback) fallback = hit;
    }
  }
  return fallback;
}

/* ------------------------------------------------------------------ */
/* 3. Main entry point                                                 */
/* ------------------------------------------------------------------ */

export function parseViolationDocument(pages: OcrPage[]): ParsedViolationDocument {
  const clean = (pages ?? [])
    .filter((p) => typeof p?.text === "string" && p.text.trim())
    .map((p) => ({ page: Number(p.page) || 1, text: p.text }))
    .sort((a, b) => a.page - b.page);

  const allText = clean.map((p) => p.text).join("\n");
  const { type, hits } = detectDocumentType(allText);

  const page1 = clean.filter((p) => p.page <= 1);
  const laterPages = clean.filter((p) => p.page >= 2);

  let hit: LineHit | null = null;
  if (type === "EZPASS") {
    // Page 2+ first — EZPass puts the transaction table on later pages.
    hit =
      findLabelledDate(laterPages, EZPASS_INCIDENT_LABELS) ??
      findLabelledDate(page1, EZPASS_INCIDENT_LABELS);
  } else if (type === "PPA") {
    hit =
      findLabelledDate(page1, PPA_INCIDENT_LABELS) ??
      findLabelledDate(laterPages, PPA_INCIDENT_LABELS);
  } else {
    hit = findLabelledDate(clean, OTHER_INCIDENT_LABELS) ?? findLooseDate(clean);
  }

  const noticeHit = findLabelledDate(clean, NOTICE_LABELS, {
    skipDeadlines: true,
    requirePlausible: false,
  });

  // Confidence: document-type clarity + labelled-match clarity + date validity.
  let confidence = 0;
  if (type !== "OTHER") confidence += hits >= 2 ? 0.35 : 0.25;
  else confidence += 0.05;
  if (hit) {
    confidence += hit.label === "unlabeled date" ? 0.15 : 0.45;
    if (hit.label === "Date") confidence -= 0.15;
    if (isPlausibleIncidentDate(hit.iso)) confidence += 0.15;
  }
  if (noticeHit) confidence += 0.05;
  confidence = Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
  if (!hit) confidence = Math.min(confidence, 0.3);

  return {
    incident_date: hit?.iso ?? null,
    notice_date: noticeHit?.iso ?? null,
    document_type: type,
    ocr_confidence: confidence,
    requires_manual_review: !hit || confidence < MANUAL_REVIEW_THRESHOLD,
    extraction_details: {
      matched_pattern: hit?.label ?? null,
      source_text: hit?.line ?? null,
      page_found: hit?.page ?? null,
    },
  };
}
