## Expense Tracking System (Admin)

The app already has an `expenses` table, an `expense_categories` table, a basic `/expenses` page, an `addExpense/updateExpense/deleteExpense` data layer, receipt upload, P&L expense rollups, and a vehicle maintenance history tab. This build extends all of that into the full system you described, reusing the existing mock-store/Supabase mirror pattern.

### 1. Database (migration)
Add columns to `expenses` (all nullable so existing rows are safe):
`maintenance_id`, `payment_method`, `reference_number`, `payroll_employee`, `payroll_period_start`, `payroll_period_end`, `payroll_hours` (numeric), `payroll_rate` (numeric). `vendor`, `vehicle_id`, `receipt_url`, `created_by` already exist.
Add to `expense_categories`: `is_default` (boolean default false). Seed the default set (Payroll, Parts, Labour, Food/Meals, Fuel, Insurance, Registration, Office Supplies, Marketing, Tolls, Cleaning Supplies, Vehicle Purchase) as `is_default = true`, and mark existing matching rows.
Add an `expense_audit_log` table (expense_id, action, changed_by, diff jsonb, created_at) with GRANTs + admin-only RLS for the edit/delete audit trail.

### 2. Data layer (`src/lib/mock/data.ts`, `src/lib/mock/store.ts`)
- Extend the `Expense` interface with the new fields (maintenanceId, paymentMethod, referenceNumber, payroll* fields).
- Update `fromExpense` / `toExpense` mappers and `addExpense` / `updateExpense` to persist them.
- On create/update/delete, write an audit-log row.

### 3. Expenses page — `/admin/expenses` (new route, admin only)
- Add "Expenses" to the sidebar Settings/Operations group (admin role).
- Header "Expense Tracker", `[+ Add Expense]` and `[Generate Report]` buttons.
- Quick stats: This Month total, Top Category, Vehicle-Tied vs General split.
- Filter tabs: All / This Month / This Year / Custom Range; category dropdown; search box (vendor/description).
- Sortable table: Date | Category | Amount | Vehicle | Vendor | Description | View/Edit.

### 4. Add / Edit Expense dialog (shared component)
All fields from the spec: date, amount, category (dropdown + custom typing, saved to `expense_categories`), vehicle toggle → vehicle select → optional maintenance ticket select, conditional Payroll fields, payment method, reference #, vendor, receipt upload, notes. Save via `addExpense`/`updateExpense`; Delete with confirm. Reuses existing `uploadExpenseReceipt`.

### 5. Vehicle maintenance/expense history tab (`fleet.$vehicleId.tsx`)
Add a combined expenses view for the vehicle: running total "Total spent on this vehicle", per-category breakdown, and a table (Date | Category | Amount | Description | Vendor) pulling every expense with that `vehicleId`.

### 6. P&L updates (`pnl.tsx`)
Break the expenses section down by category (dynamic, includes custom categories) within the existing date-range filters, in addition to the current totals.

### 7. Per-vehicle profitability
On the vehicle page, add a profitability card: revenue (sum of paid payments for that vehicle's rentals) and # rentals, expenses by category for that vehicle, net profit and ROI.

### 8. Category management — `/admin/expense-categories` (new route)
List default + custom categories; add new; rename; delete custom only when no expense references it; defaults locked.

### 9. Reports (`[Generate Report]`)
Dialog: date range, category filter, vehicle filter, group-by (category / vehicle / month); export CSV (reusing `downloadCSV`) and a print/PDF view.

### 10. Maintenance ticket integration
When a maintenance/repair ticket completes, the store already posts a P&L expense. Extend that completion path to tag the expense with `maintenance_id`, `vehicle_id`, vendor = mechanic, and split Parts vs Labour categories where the amounts are available, so completed repairs flow into the expense system automatically.

### Technical notes
- New routes use `createFileRoute` with admin gating via `useAuth()` (matching existing admin pages).
- Keep the existing `/expenses` route working; the new `/admin/expenses` is the richer page (I can redirect the old one or leave it — I'll redirect `/expenses` to `/admin/expenses` to avoid duplication unless you prefer keeping both).
- All persistence goes through the existing optimistic mock-store + Supabase mirror; no business logic moves to the client beyond what already exists.

I'll implement in this order: migration → data layer → dialog → list page → category page → vehicle tab/profitability → P&L → reports → maintenance integration.