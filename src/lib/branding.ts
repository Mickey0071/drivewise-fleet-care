// Single source of truth for export branding (Excel + PDF).
// The logo is the stored project asset in src/assets/camauto-logo-base64.ts —
// every report (incl. dispute packets) must import it from here or that file.
import { CAMAUTO_LOGO_BASE64 } from "@/assets/camauto-logo-base64";

export const BRAND_LOGO_DATA_URL = CAMAUTO_LOGO_BASE64;

export const BRAND_COLORS = {
  green: "0E9949",
  dark: "2B2B2B",
  red: "C62828",
  band: "F3F6F4",
  white: "FFFFFF",
} as const;

export const BRAND_RGB = {
  green: [14, 153, 73] as [number, number, number],
  dark: [43, 43, 43] as [number, number, number],
  red: [198, 40, 40] as [number, number, number],
  band: [243, 246, 244] as [number, number, number],
  muted: [110, 110, 110] as [number, number, number],
};

export const BRAND_COMPANY = {
  legal: "Rentalprise LLC d/b/a Camauto Rentals",
  address: "416 Sicklerville Rd, Sicklerville NJ 08081",
  contact: "(866) 625-5550 · camautorentals.com",
  footer: "Camauto Rentals — Confidential",
};

export const FMT_CURRENCY = '$#,##0.00;[Red]-$#,##0.00;"-"';
export const FMT_PERCENT = '0.0%;[Red]-0.0%;"-"';

const CURRENCY_RE = /(\$|amount|revenue|total|cost|price|paid|balance|expense|net|profit|income|labor|parts|fee|rate|gross|deposit|payout|spent|owed|due\b)/i;
const PERCENT_RE = /(%|margin|roi|utiliz|pct|percent)/i;

export type ColumnKind = "currency" | "percent" | "number" | "text";

export function inferColumnKind(header: string, sample: unknown): ColumnKind {
  if (typeof sample !== "number") return "text";
  if (PERCENT_RE.test(header)) return "percent";
  if (CURRENCY_RE.test(header)) return "currency";
  return "number";
}

export function logoBytes(): Uint8Array {
  const b64 = BRAND_LOGO_DATA_URL.split(",")[1] ?? "";
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function generatedStamp(d = new Date()): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}
