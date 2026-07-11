## Goal

Let you **archive a sold vehicle** so it moves out of the active fleet into a "Sold / Archived" area. Its historical money and history stay counted in **overall** figures (total income, total expenses, its past drivers/rentals), but it is **excluded from fleet analytics** that measure the *active* fleet — days rented, average income per vehicle, utilization, idle count, active-vehicle counts. Archived vehicles remain fully viewable.

## What you'll see

```text
Fleet page
 ├─ [ All ] [ Sold / Archived ]           ← new toggle
 ├─ active vehicles only (archived hidden by default)
 └─ each card ⋯ menu → "Mark as sold / archive"
        → dialog: Sale date, Sale price (optional), Reason/notes

Sold / Archived view
 └─ archived vehicle cards, each showing preserved lifetime stats
    (total income, total expenses, net, # rentals, past drivers)
    with "Restore to fleet" action. Detail page still opens normally.
```

## Behavior

- **Archiving:** a car marked sold gets `archived = true` plus optional sale date/price/notes. It disappears from the active Fleet list, the booking/availability pickers, and active-fleet analytics — but nothing is deleted.
- **Still counted (overall/lifetime):** total income and total expenses on the P&L keep including archived vehicles' payments, repairs, and expenses, because those roll up from the rentals/payments/expenses tables regardless of vehicle status. Its past drivers and rental history stay intact and accessible.
- **Excluded (active-fleet analytics):** any metric that describes the *current* fleet uses active vehicles only — days rented, average income/net per vehicle, fleet utilization %, active vs total counts, idle vehicles, per-vehicle rate averages. Archived cars are "docile" to these.
- **Restore:** un-archiving returns the car to the active fleet and all active-fleet metrics.
- Booking/availability and "add rental" vehicle pickers won't offer archived cars.

## Technical details

### Data model
- **Migration:** add to `public.vehicles`: `archived boolean not null default false`, `sold_date date`, `sale_price numeric`, `archive_notes text`. (No new table needed — reuses existing GRANTs/RLS.)
- **`src/lib/mock/data.ts`:** add `archived?: boolean; soldDate?: string; salePrice?: number; archiveNotes?: string` to the `Vehicle` interface.
- **`src/lib/mock/store.ts`:** extend `fromVehicle`/`toVehicle` with the new columns; add `archiveVehicle(id, { soldDate?, salePrice?, notes? })` and `unarchiveVehicle(id)` (set fields, `cloudWrite` update, `emit()`); add a shared selector `activeVehicles()` returning `vehicles.filter(v => !v.archived)` and `archivedVehicles()`.

### Analytics — swap `vehicles` → active set where it measures the active fleet
- **`src/routes/analytics.tsx`** — counts/rate scans use active vehicles.
- **`src/routes/analytics_.utilization.tsx`** — `totalFleet`, per-vehicle rows, idle/active lists use active vehicles.
- **`src/routes/analytics_.pnl-dashboard.tsx`** — `perVehicle` map, `fleetUtilization`, `avgDaysRented`, `avgNetPerVehicle`, active-vehicle KPI denominators use active vehicles. **Overall** income/expense/net totals stay unchanged (they already sum payments/expenses/maintenance, not the vehicle list), so archived history remains in the top-line numbers.
- **`src/routes/pnl.tsx`** — the per-vehicle breakdown tables can show an "include archived" toggle (default: active only), while global income/expense totals stay all-inclusive.

### Fleet UI
- **`src/routes/fleet.tsx`:** default list = `activeVehicles()`; add an "All / Sold · Archived" toggle (or extend the existing `status` search param with an `archived` filter). Add a per-card action "Mark as sold / archive" opening a small dialog (sale date, optional sale price, notes) that calls `archiveVehicle`. In the archived view, show each car's preserved lifetime income/expenses/net + rental count + past drivers, with a "Restore to fleet" button.
- **Availability/pickers:** ensure `isVehicleBookable` / add-rental vehicle lists exclude archived cars.

### Out of scope
- No change to how individual payments/expenses/rentals are stored — archiving only relabels the vehicle and filters active-fleet views/metrics.
- Sale price is recorded for reference; it is not added into P&L income unless you later ask for that.
