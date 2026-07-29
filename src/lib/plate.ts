// Shared, client-safe plate normalization. Import from anywhere (client or
// server). Keep this file dependency-free so it can be bundled into browser
// code without pulling in server-only modules.

/**
 * Normalize a license plate string for equality comparison across the app.
 *
 * Handles the many shapes plates arrive in from OCR, EZPass statements,
 * manual entry, and legacy imports:
 *   "(NJ) N90VCG"   -> "N90VCG"
 *   "NJ / XPSD76"   -> "XPSD76"
 *   "N90VCG NJ"     -> "N90VCG"
 *   "N90VCG (NJ)"   -> "N90VCG"
 *   " n90-vcg "     -> "N90VCG"
 *   "AB1234"        -> "AB1234"  (short plates preserved)
 *
 * Order:
 * 1. Uppercase + trim.
 * 2. Strip a LEADING state code (2 letters, optional parens) that is
 *    followed by a separator — anchors the delimiter so we don't eat the
 *    first two letters of an unprefixed plate.
 * 3. Strip a TRAILING state code preceded by a separator, same reasoning.
 * 4. Remove all remaining spaces, dashes, dots, slashes, and stray parens.
 */
export function normalizePlate(p: string | null | undefined): string {
  let s = (p ?? "").toUpperCase().trim();
  s = s.replace(/^\(?[A-Z]{2}\)?[\s/.\-]+/, "");
  s = s.replace(/[\s/.\-]+\(?[A-Z]{2}\)?$/, "");
  s = s.replace(/[\s/.\-()]/g, "");
  return s;
}