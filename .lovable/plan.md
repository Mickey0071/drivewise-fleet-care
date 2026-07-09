# Unified Mileage → Vehicle → Routine Maintenance

## Goal
Whenever mileage is entered anywhere in the app, it updates the vehicle's single "current mileage" value (only if higher), so it shows consistently on fleet cards, in maintenance routines, and automatically drives routine-maintenance alerts (oil change miles-remaining, etc.).

## Current state
- The vehicle's `mileage` is the single source of truth. Routine-maintenance alerts (`computeVehicleAlerts` in `src/lib/maintenance-utils.ts`) already read `v.mileage`, so keeping that value fresh is what "accounts it toward routine maintenance."
- A helper `applyOdometerReading(vehicleId, mileage)` in `src/lib/mock/store.ts` already propagates readings from inspections and service/maintenance logs.
- Gaps: (1) it uses "latest value wins" instead of increase-only; (2) rental returns, RM cards, and runner RM tasks capture mileage but never push it to the vehicle.

## Changes

### 1. Increase-only rule
Update `applyOdometerReading` so a new reading only overwrites `vehicle.mileage` when it is strictly greater than the current value (still ignores null/0/negatives). This protects the routine-maintenance math from typos and stale readings. All existing callers (inspections, service logs, maintenance edits) inherit this automatically.

### 2. Wire the missing entry points to the vehicle
These are server functions that write directly to the database, so each needs an increase-only update to `vehicles.mileage` in the same handler (read current mileage, write back only if the new value is higher):
- **Rental returns** — `src/lib/return.functions.ts`: after saving `mileage_in`, bump `vehicles.mileage`.
- **RM cards** — `src/lib/rm-cards.functions.ts`: when `mileage_at_inspection` is recorded, bump `vehicles.mileage`.
- **Runner RM tasks** — `src/lib/runner-tasks-admin.functions.ts`: when an RM task's mileage is submitted/approved, bump `vehicles.mileage`.
- **Fleet card manual edit** — confirm `updateVehicle` mileage edits also route through the increase-only rule (currently a direct set); align it so manual edits follow the same guard, while still allowing an explicit correction path.
- **Inspections & service logs** — already covered; no change beyond inheriting the increase-only rule.

### 3. Keep routine maintenance in sync
No new alert logic needed — once `vehicle.mileage` is current, `computeVehicleAlerts` recomputes oil-change and mileage-based alerts on the fleet card and maintenance views automatically. Oil-change baselines (`lastMileage`) continue to reset only when an oil-change service is logged (existing behavior at store lines ~1864/2444).

## Out of scope
- No schema/migration changes (all fields already exist).
- No change to how rentals store `mileage_out`/`mileage_in` for billing; we only additionally propagate to the vehicle.

## Technical notes
- Increase-only guard lives in one place for the local store (`applyOdometerReading`) and is mirrored inline in each server function that writes to the DB directly.
- Server-function updates use the existing `supabaseAdmin`/authenticated client already in those files; each does a read-then-conditional-update on `vehicles.mileage`.
