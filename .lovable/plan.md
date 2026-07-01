## Problem

The Expense Tracker (`/admin/expenses`) only reads the `expenses` table. Completed repairs and maintenance logged in the maintenance module don't show up (or show inconsistently), so the totals don't match what the vehicle detail page and P&L dashboard already show. You want one accurate list of everything spent, with repairs and maintenance split into their own buckets alongside the categories you create.

## What I'll change

Only the Expense Tracker page (`src/routes/admin.expenses.tsx`) — presentation only. No changes to the balance formula, maintenance module, or how repairs are stored.

### 1. Merge maintenance/repairs into the expense list

Build a single combined list from two sources, reusing the shared helpers already used by the P&L dashboard and vehicle detail page so numbers agree everywhere:

- **Operational expenses** — all rows from the `expenses` table, EXCEPT auto-posted repair rows (`isAutoPostedRepairRow`) so a completed repair is never counted twice.
- **Completed repairs & maintenance** — every completed maintenance row (`isCompletedRepair`), valued with `effectiveRepairCost` (uses `cost`, or falls back to `parts_cost + labor_cost`).

Each maintenance-sourced line is auto-labeled:
- **Repair** when it's a repair ticket (`isIssueRecord`)
- **Maintenance** when it's a routine service-log row (`isServiceLogRecord`)

Operational rows keep their existing user-assigned category (Parts, Fuel, Tolls, and any custom category you create — that flow is unchanged).

### 2. Category filtering & summary

- The category dropdown gains **Repair** and **Maintenance** as their own buckets alongside your custom categories, so you can filter to exactly one.
- The three summary cards (This Month, Top Category, Vehicle-Tied / General) recalculate off the combined list, so "This Month Expenses" finally includes repairs + maintenance.
- Search, date range (All / Month / Year / Custom), and sort (date / amount / category) all operate on the combined list.

### 3. Row behavior

- Repair/Maintenance lines link to the vehicle and show the issue/service description, vendor, and completed date — but their Edit/Delete buttons are hidden, since they're owned by the maintenance module (editing happens there). Operational expense rows keep full Add / Edit / Delete.
- A small source tag ("Repair", "Maintenance", or the expense category) makes each row's origin obvious.

### 4. CSV / report export

The existing report/CSV path exports the combined list so a downloaded report matches the on-screen totals.

## Result

The Expense Tracker becomes the single accurate view of all money out — operational expenses + repairs + maintenance — split into Repair and Maintenance buckets plus your custom categories, with no double-counting, matching the vehicle detail page and P&L dashboard.

## Technical notes

- Reuses `effectiveRepairCost`, `isCompletedRepair`, `isIssueRecord`, `isServiceLogRecord`, `isAutoPostedRepairRow` from `src/lib/maintenance-utils.ts`.
- Combined rows built in a `useMemo` normalizing both sources into one `{ id, category, amount, date, vehicleId, vendor, notes, source }` shape.
- No schema or store logic changes; read/presentation change confined to `admin.expenses.tsx`.
