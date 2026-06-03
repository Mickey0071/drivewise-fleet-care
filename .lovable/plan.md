## Goal

Turn the Maintenance page into a true dashboard: a collapsible config section, three summary cards (Scheduled Repairs due soon, Open Repairs, Completed recent), and three tabs (Scheduled Maintenance, Repairs kanban, Completed log). The Scheduled section is wired to the Alert Settings already configured per vehicle in Fleet.

## Key architecture decision

The app already has a complete "scheduled maintenance" engine: every vehicle stores `maintenanceSettings` (oil interval, battery, alternator, inspection, custom alerts) set via the Fleet detail's **Alert Settings** dialog, and `computeVehicleAlerts()` derives what's due from current mileage + dates.

I will **drive the Scheduled cards/tab from this existing engine** instead of creating a separate `scheduled_maintenance` table. A second table would duplicate the source of truth and require constant syncing on every mileage change, fleet edit, and inspection — a maintenance burden with no functional gain. The computed approach already satisfies every Part-9 success criterion (auto-calculated due dates, 7-day / 100-mile alerting, pass/fail clearing).

## What changes

### 1. Scheduling helpers (`src/lib/maintenance-utils.ts`)
- Add `computeScheduledItems(vehicle, now)` returning structured rows: `{ vehicleId, type ('oil'|'battery'|'alternator'|'inspection'|custom), label, dueDate?, dueMileage?, milesRemaining?, daysRemaining?, status ('overdue'|'due_soon'|'upcoming') }`. Reuses the same interval math already in `computeVehicleAlerts`.
- "Due soon" threshold for the dashboard = within **7 days OR 100 miles** (overdue always included). Existing red-alert thresholds (500 mi / 15 days) stay as-is for the Fleet badges so I don't change unrelated screens.
- `markScheduledComplete(vehicleId, type)` helper that updates the vehicle's `maintenanceSettings` (sets `lastDone`/`lastMileage`/`lastDate` to today/current mileage), which automatically clears the alert.

### 2. Maintenance dashboard (`src/routes/maintenance.tsx`)
- **Collapsible config section** (top): "⚙️ Configure Scheduled Repairs Alerts" — summarizes how many vehicles have alerts configured and an **Edit Alert Settings** action that routes to Fleet.
- **Three summary cards**:
  - *Scheduled Repairs (due soon)* — count + top 3 most urgent (vehicle, type, miles/days remaining, due date) + buttons to Scheduled tab / Fleet.
  - *Open Repairs* — count + top 2 recent + total pending cost + button to Repairs tab.
  - *Completed (recent)* — total count + 3 most recent by completion date + button to Completed tab.
- **Three tabs**:
  - *Scheduled Maintenance* — left: Due soon list with **Mark Complete** per row; right: recently completed scheduled services (from the service-log maintenance records).
  - *Repairs* — existing `RepairsBoard` kanban (unchanged).
  - *Completed* — existing sortable completed-repairs log table.

### 3. Runner inspection pass/fail (Part 7)
- The inspection→maintenance flow already exists: a failed inspection auto-creates a repair ticket (DB trigger `inspections_auto_maintenance`) and a passed inspection updates the vehicle. I will add, on inspection **approval**, clearing of the matching scheduled alerts (oil/battery/alternator/inspection) for that vehicle via `markScheduledComplete`, and confirm a failed check keeps the alert red (ticket already created). This is a small addition to the existing approval path, not a new system.

## Out of scope / not building
- No new `scheduled_maintenance` DB table (computed from existing per-vehicle settings instead — see decision above).
- No changes to the Fleet Alert Settings dialog UI; it already captures all required intervals. The "Fleet add auto-populates Alert Settings" step is the admin opening that dialog after adding a vehicle (existing flow).

## Technical notes
- All scheduled data is derived client-side from `vehicles[].maintenanceSettings`; no schema migration required.
- "Mark Complete" mutates the vehicle via the existing `updateVehicle` store action, so Fleet badges and the dashboard stay in sync automatically through `useStoreVersion`.
- P&L on repair completion is already wired through `recordRepairPayment` / `completeRepair`; unchanged.
