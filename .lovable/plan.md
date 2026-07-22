## Current state

The fix you're describing is already in place in `src/routes/fleet.$vehicleId.tsx`:

- CSV export (line ~650): `const rows = fin.expenseLineItems.map(...)`
- PDF export (line ~680): `const rows: RepairHistoryRow[] = fin.expenseLineItems.map(...)`
- Totals passed to `renderRepairHistoryPdf` are `{ repairs: fin.repairs, expenses: fin.expenses, grand: fin.grand }`

`completedRepairs` and `otherExpenses` still exist but only feed the on-screen "Repair history" and "Expenses" sections (lines 729 / 785) — not the CSV or PDF builders.

So the row-vs-total drift the task describes should already be closed. What's outstanding is proof.

## Plan

1. Run the live verification for V-113 (XPRX21) and Ford NEW2026:
   - Open the vehicle page, click **Download PDF** and **Download CSV**.
   - For each: list every row + amount, sum them, compare to the printed grand total.
   - Expected: V-113 rows sum to $337; NEW2026 rows sum to $808; CSV matches PDF row-for-row.
2. Confirm zero writes: no `supabase.*.insert/update/delete` runs in the export handlers (they're pure client-side generators today; re-confirm).
3. If any total drifts, then — and only then — patch the offending mapper. Otherwise report the four verification outputs and stop.

## Technical notes

- On-screen "Repair history" / "Expenses" sections still read `completedRepairs` / `otherExpenses`. Task explicitly scopes to CSV + PDF, so those visual sections are left alone.
- Parts/Labor split in the PDF/CSV already comes from `expenseLineItems` (the engine emits `::parts` / `::labor` child rows), not from re-reading `parts_cost` / `labor_cost` on the maintenance row.
