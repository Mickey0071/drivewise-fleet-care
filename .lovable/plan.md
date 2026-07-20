## Goal
On a vehicle's **Repair History** tab, show both completed repairs AND all other expenses recorded against that vehicle, grouped into two clearly labeled sections on the same view, with a Download button that exports the combined history.

## Changes

### 1. `src/routes/fleet.$vehicleId.tsx` — Repair History tab
- Keep the existing "Repair history" section (completed repairs from `maintenance`) as-is.
- Add a second section **"Expenses"** below it, listing every vehicle expense that is NOT already counted as a completed repair. Source: `buildCombinedExpenses()` filtered to this vehicle where `source === "operational"` (plus `"maintenance"` routine service, which today is folded into repairs — we'll only include rows not already shown above to avoid double-counting).
  - Each row: date · category · vendor/notes · amount.
- Update the tab header count to show both totals, e.g. `Repair history (5) · Expenses (12)`.
- Add a **Download** button (next to the existing "Copy deep link" button) that exports the combined list as CSV using existing `downloadCSV` from `src/lib/exports.ts`. Columns: Date, Type (Repair / Expense), Category, Vendor/Mechanic, Description, Parts, Labor, Amount. Filename: `repair-history-<plate>-<YYYY-MM-DD>.csv`.
- Optional secondary action: reuse existing `printPage()` for a Print/PDF button (matches pattern in `ReportActions.tsx`).

### 2. No schema, server, or business-logic changes
Purely a presentation change on one tab. `buildCombinedExpenses()` already unifies operational expenses + repairs; we just render both slices in the Repair History tab and add the export.

## Out of scope
- Fleet-wide `/repairs` page (unchanged).
- Expense entry/editing (still lives on the Expenses tab).

Ready to build?
