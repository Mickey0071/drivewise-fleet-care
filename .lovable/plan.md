## Where we are

Tier 1 is done. `src/lib/money-rules.ts` is the single source of truth (`repairCost`, `isRepairCost`, `isAutoPostedExpense`, `countableExpenses`) with the "counted exactly once — never zero times" invariant. `getVehicleFinancials`, `combined-expenses.ts`, `pnl.tsx`, and `repair-history-pdf.ts` all read through it. The disappearing-money leak (Ford NEW2026 M-3357914, $68) is closed.

## Still doing their own money math (tier 2 targets)

Grepped for `effectiveRepairCost`, `isAutoPostedRepairRow`, and independent `.reduce` sums over repairs/expenses. Live callers:

1. `src/lib/maintenance-utils.ts` — still exports `effectiveRepairCost` and `isAutoPostedRepairRow` (legacy regex).
2. `src/routes/repairs.tsx` — 5 call sites use `effectiveRepairCost`; monthly total is a raw `.reduce`.
3. `src/routes/fleet.$vehicleId.tsx` — 4 call sites still use `effectiveRepairCost` for display rows and CSV export.
4. `src/routes/analytics_.pnl-dashboard.tsx` — local `maintCost(m)` helper + independent `.reduce` for operational expenses (no dedupe against maintenance).
5. `src/lib/backups.server.ts` — `monthMaint.reduce(...)` sums maintenance cost with its own rule.
6. `src/components/app/CompletedRepairDetailDialog.tsx`, `VehicleRepairPanelDialog.tsx` — display `effectiveRepairCost(m)`.
7. `src/components/app/ServiceHistoryReportDialog.tsx` — `.reduce((s,m)=>s+m.cost,0)` twice, bypassing precedence.
8. `src/components/app/MechanicJobHistory.tsx` — sums `parts_list` + `labour_cost` from mechanic jobs (different table — leave; not repair/expense math).
9. `src/components/app/RepairBreakdown.tsx`, `CreateRepairDialog.tsx` — sum draft form rows before save (input widgets, not reporting; leave).

## Plan

**Step 1 — Deprecate and forward legacy helpers in `maintenance-utils.ts`**
- Replace the body of `effectiveRepairCost(m)` with `return repairCost(m)` (import from `money-rules`). Keep the export so callers don't break in one sweep.
- Delete `isAutoPostedRepairRow` entirely. It's the buggy regex (`/completed/i`) that started this whole thread; nothing should be allowed to call it. Any remaining importer becomes a build error — good, we want to see them.

**Step 2 — Rewire tier 2 reporting sites to money-rules**
- `src/routes/repairs.tsx`: swap 5 `effectiveRepairCost` calls → `repairCost`; change `completedThisMonthTotal` to sum via `repairCost` and filter with `isRepairCost` so scheduled reminders don't inflate it.
- `src/routes/fleet.$vehicleId.tsx`: swap 4 `effectiveRepairCost` display/CSV sites → `repairCost`. Grand totals in this file already come from `getVehicleFinancials(v.id)` — leave those alone.
- `src/routes/analytics_.pnl-dashboard.tsx`: replace local `maintCost` with `repairCost`; wrap operational-expense `.reduce` in `countableExpenses(periodExpenses, maintenance)` so an auto-posted repair expense doesn't get counted alongside the maintenance row. Do the same for the per-vehicle P&L slice.
- `src/lib/backups.server.ts`: replace `monthMaint.reduce(...)` with a sum built from `isRepairCost` + `repairCost`; wrap the paid-expense sum through `countableExpenses`.
- `src/components/app/ServiceHistoryReportDialog.tsx`, `VehicleRepairPanelDialog.tsx`, `CompletedRepairDetailDialog.tsx`: swap `m.cost` / `effectiveRepairCost(m)` → `repairCost(m)`.

**Step 3 — Verify, zero writes**
- Live browser check via headless Chromium (same pattern as last turn):
  - V-113 grand still 337 (must not move).
  - Ford NEW2026 grand still shows the $68 on the expense side.
  - `/analytics/pnl-dashboard` maintenance figure for the current period reconciles to the sum of `repairCost` over `isRepairCost` rows in that window.
  - `/repairs` "completed this month" figure equals `getVehicleFinancials` roll-up across affected vehicles.
- Paste actual numbers back. Confirm zero rows written.

**Out of scope this turn**
- Draft form widgets (`RepairBreakdown`, `CreateRepairDialog`) — they compute pre-save totals from user input, not reporting.
- `MechanicJobHistory` — sums a different table (`mechanic_jobs`), not repair/expense ledger.
- The `.reduce` calls in `src/lib/mock/store.ts` — those are id/sort helpers, not money math.

After this, tier 3 (write-side dedupe in `repair-actions.functions.ts` and completion paths) is the remaining chunk — but that one does touch data, so it deserves its own plan.
