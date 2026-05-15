
# Plan: P&L / Financial Reporting Module

Replace the analytics gap from Fleet Fitness by building a financial reporting module that pulls revenue from existing rental/payment data and lets you log expenses against vehicles. Multi-tenancy and the other modules (payroll, expenses-deep, onboarding wizard) come in later phases.

## Phase 1 — P&L Foundation (this build)

### What you'll get
- A new **Financials** tab in the admin nav with three views:
  1. **Overview** — current month, YTD, last 12 months: total revenue, total expenses, net profit, profit margin
  2. **Per-Vehicle P&L** — every vehicle as a row: revenue, expenses, net, ROI %, utilization %
  3. **Expenses** — log and categorize expenses (fuel, repairs, insurance, registration, payments to lien holder, other)
- **Revenue auto-pulled** from `payments` table (status = paid) + extension `additional_amount` — no double entry.
- **Date range filter** (this month / last month / YTD / last 12 mo / custom).
- **Export to CSV** for any view (so you can hand to an accountant).
- **Charts**: monthly revenue vs expense line chart, expense breakdown by category (donut).

### Database additions
- `expenses` table — id, vehicle_id (nullable for overhead), category, amount, date, vendor, notes, receipt_url, created_by
- `expense_categories` enum: fuel, repair, maintenance, insurance, registration, lien_payment, cleaning, towing, other
- Storage bucket `expense-receipts` for receipt photos/PDFs
- RLS: admin-only read/write

### UI
- New route `src/routes/financials.tsx` with tabbed sub-views (Overview / Per-Vehicle / Expenses)
- Reuse existing `Card` / `Table` patterns from rentals & fleet
- Charts via `recharts` (already common in shadcn stacks — install if missing)

### Server functions
- `getFinancialSummary(dateRange)` — aggregates payments + extensions + expenses
- `getVehiclePnL(dateRange)` — per-vehicle rollup
- `createExpense / updateExpense / deleteExpense`
- `exportFinancialsCsv(view, dateRange)`

## Phase 2+ (future requests, not built now)
- Payroll module (staff, hours, commissions)
- Onboarding wizard (step-by-step setup for new fleet owner)
- Multi-tenant / white-label (when you're ready to sell to other fleet owners)
- Advanced analytics (vehicle LTV, churn, optimal rate suggestions)

## Out of scope for this build
- Accounting integrations (QuickBooks/Xero) — can add later
- Tax calculations
- Bank feed sync
- Driver-facing financial views (admin only)

Approve and I'll build Phase 1.
