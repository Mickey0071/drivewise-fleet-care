## Goal

In **Violations → Matched tab**, add a **"🖨️ Print All Agreements"** action that:
1. Gathers every signed rental agreement for matched violations into one merged PDF
2. Opens the browser's print dialog
3. On successful print/save, moves those violations to the **Disputed** tab

## Behavior

- **Scope**: uses `selectedRows` if any rows are checked, otherwise every row currently visible on the Matched tab. Deduplicates by `rental_id` when merging PDFs so a rental with multiple tolls prints once.
- **What gets merged**: only rentals with a stored `agreement_pdf_url`. Rentals missing an agreement are skipped and reported.
- **Output**: opens the merged PDF in a new tab and auto-fires `window.print()`.
- **Cover page per agreement**: slim header page showing renter name, plate, violation ref #, date, and amount for easy sorting after printing.
- **Auto-move to Disputed**: after the print dialog is dismissed, every violation whose rental made it into the merged PDF (the non-skipped set) is moved to `workflow_stage = "disputed"`. Skipped rows stay in Matched. Toast summarizes: `X moved to Disputed · Y skipped (no agreement on file)`.

## Implementation

### 1. New server fn `getMatchedAgreementsForPrint` in `src/lib/violation-packet.functions.ts`
- Auth-only. Input: `{ violationIds: string[] }` (cap 200).
- For each violation with `rental_id`, fetch `agreement_pdf_url`, driver name, plate, and violation summary.
- Deduplicates by `rental_id` (keeps the first violation id per rental for the cover page; also returns the full list of violation ids per rental so the client can stage-move all of them).
- Returns `{ items: Array<{ rentalId, violationIds: string[], agreementUrl, header: { name, plate, dateIssued, refNum, amount } }>, skipped: Array<{ violationId, reason }> }`.

### 2. New server fn `bulkSetViolationStage` in `src/lib/violations-workflow.functions.ts`
- Auth-only. Input: `{ violationIds: string[], stage: "disputed" }` (accept the full `Stage` enum but this UI only passes `"disputed"`).
- Batch-updates `violations.workflow_stage` and writes one `violation_status_history` audit row per id (mirroring the existing single-item `setViolationStage`). Returns `{ updated: number }`.

### 3. Client helper `buildMergedAgreementsPdf` (inline in `src/routes/violations.tsx`)
- Uses `pdf-lib` (already installed) to:
  - Draw a 1-page cover sheet per rental (renter name, plate, ref #, date, amount) using Helvetica in the same green/text-color palette as the existing cover sheet.
  - Fetch each `agreementUrl`, `PDFDocument.load`, `copyPages` into the merged doc.
- Returns a `Blob`.

### 4. UI in `src/routes/violations.tsx` Matched-tab toolbar
- Add **"🖨️ Print All Agreements"** as a third button next to "Bulk Download Packets" / "Bulk Online Prep".
- Handler flow:
  1. Target IDs = `selectedRows.length > 0 ? selectedRows : filtered`.
  2. Call `getMatchedAgreementsForPrint({ violationIds })`.
  3. If nothing merged, toast an error and stop.
  4. Client-side merge → open blob URL in new tab → `printWindow.onload = () => printWindow.print()`.
  5. After the print window's `afterprint` fires (or immediately after `print()` returns as a fallback), call `bulkSetViolationStage({ violationIds: <flattened ids from non-skipped items>, stage: "disputed" })`.
  6. Invalidate the `["violations"]` query, clear selection, toast summary.
- Button shows "Building…" while working; disabled during the run.

## Non-goals
- No changes to `downloadViolationPacket`, the manual-match flow, or other tabs.
- Does not re-generate agreements — only prints what's stored on `rentals.agreement_pdf_url`.
- Skipped rentals (no agreement on file) are NOT auto-moved to Disputed; only agreements that actually printed advance.

## Verification
- Open Matched tab with a mix of rentals (some with agreements, some without). Click **Print All Agreements** with nothing selected → new tab opens with merged PDF, print dialog appears. After closing print, matched rows for printed rentals disappear from Matched and appear in Disputed; rentals without agreements stay in Matched. Toast reports both counts.
- Select 2 rows sharing one rental + 1 row on a different rental → merged PDF contains exactly 2 agreements; all 3 violation rows move to Disputed together.
