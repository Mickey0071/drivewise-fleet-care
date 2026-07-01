# Master Fix: One Unified Financial Engine

## The problem (confirmed in code)
Each screen computes vehicle money its own way, so numbers disagree:

| Screen | Expenses formula today |
|---|---|
| Fleet card (`fleet.tsx`) | operational `expenses` rows only — no repairs, no violations, and double-counts auto-posted repair rows |
| Vehicle Analytics tab (`fleet.$vehicleId.tsx`) | all `expenses` + violations — but the "Total spent" tile on the *same page* uses ops + completed repairs (no violations) |
| P&L report (`pnl.tsx`) | ops (excl. auto-posted) + completed repairs, no violations, date-filtered |

Income is more consistent (paid payments on the vehicle's rentals) but each screen re-derives it.

## The fix: `getVehicleFinancials(vehicleId)`

New file `src/lib/vehicle-financials.ts` — the single source of truth. One pure function, called by every screen and report. Because it derives everything live from the existing records, it is automatically retroactive (no data migration needed — recalculation happens on every render across all history).

### Data sources (client store, hydrated from the backend)
- **Income** → `payments` table: paid payments (`status === "paid"`) on any rental whose `vehicleId` matches, excluding `kind === "credit"` (money-on-file, not collected revenue). Includes rent + violation payments.
- **Expenses** — combined from all cost tables linked to the vehicle:
  - `expenses` table (manual: tow, fuel, cleaning, parts, labour), **excluding auto-posted repair rows** (`isAutoPostedRepairRow`) to avoid double-counting.
  - `maintenance` table: completed repairs/service, valued with `effectiveRepairCost` (`cost`, falling back to parts+labour).
  - `violations` table: `amount` per row (tickets / PPA / impound).

### Returned shape
```text
{
  vehicleId,
  totalIncome,                 // sum of income line items
  totalExpenses,               // sum of expense line items
  netPnl,                      // totalIncome - totalExpenses
  roi,                         // totalExpenses>0 ? netPnl/totalExpenses*100 : null
  incomeLineItems:  [{ date, renterName, amount, method, rentalId }],
  expenseLineItems: [{ date, category, description, amount, source }],
  // source ∈ "manual" | "repair" | "maintenance" | "violation"
}
```
Guarantee: `sum(expenseLineItems.amount) === totalExpenses` and `sum(incomeLineItems.amount) === totalIncome`, by construction.

An optional `{ from, to }` date filter is supported for the P&L report's date range; when omitted it returns all-time (used by fleet card, vehicle tab, expense tab).

## Screens/reports rewired to call it (no screen keeps its own math)
- **A. Fleet card** (`fleet.tsx`) — Income / Expenses / Net from the engine.
- **B. Vehicle Analytics/P&L tab** (`fleet.$vehicleId.tsx`) — summary cards + itemized income list + flat expense line-item list all from the engine; the "Total spent" tile uses the same `totalExpenses`.
- **C. Vehicle Expenses tab** — total = engine `totalExpenses`; list = engine `expenseLineItems` (manual + repairs + violations), replacing the ops-only list.
- **D. Global P&L report** (`pnl.tsx`) — per-vehicle rows and fleet totals = sum of engine results; category subtotals derived from `expenseLineItems`.
- **E. Printable reports** (`monthly-vehicle-reports.tsx` and vehicle PDF export) — pull the same engine output.

## Explicitly NOT touched
Payment collection, reservation logic, and the balance engine (`rentalCanonicalOwed`, `rentalTimeCharge`, `rentalPaymentsReceived`, etc.) are untouched. This is a reporting/aggregation layer only.

## Step 4 — Validation
After wiring, I'll output a side-by-side for **V-116 (2015 Nissan Altima Bro, B66WUV)** showing Income, Expenses, Net P&L, ROI identical across the fleet card, Analytics tab, Expenses tab total, and the P&L report row.

## One decision to confirm
For **income**, the spec says "all payments collected (status = paid)." I plan to include rent + violation payments and exclude only `credit` (money-on-file). If you'd rather income mean rent-only (exclude violation payments too), tell me and I'll scope it that way. Otherwise I proceed as above.
