## Goal

Make returned vehicles **unbookable** until a runner submits a post-return inspection where `ready_to_rent = true` and no failed checklist items / damage. Brand-new vehicles (never rented) are unaffected. Admins can force-book past the block with a confirmation.

## Behavior

```text
Vehicle lifecycle
─────────────────
new            → bookable
on rent        → not bookable (existing logic)
returned       → status = "inspection"  → NOT bookable
   ├─ passing inspection submitted     → status = "available", bookable
   └─ failed inspection submitted      → stays "inspection" + has_open_issues
                                          → admin override only
```

A vehicle is "awaiting inspection" if its most recent rental has `reservation_status in ('returned','completed')` AND there is no inspection for that rental with `type = 'return'` (or post-return) and `ready_to_rent = true` submitted *after* the rental's return.

## Changes

### 1. `src/lib/mock/store.ts`
- Add `awaitingPostReturnInspection(vehicleId)` helper: looks at the latest returned rental for the vehicle and checks whether a passing return inspection exists after it.
- Update `isVehicleBookable(vehicleId, { allowOverride? })`:
  - Existing checks unchanged.
  - If `awaitingPostReturnInspection(vehicleId)` is true → return `false` unless `allowOverride` is set.
- Remove the auto-flip from `"inspection"` → `"available"` in `reconcileVehicleAvailability` so the inspection gate sticks until a passing inspection comes in.
- In `addInspection`, when a return-type inspection is saved with `ready_to_rent = true` and no failed checklist items / damage AND there's no open maintenance ticket for the vehicle, flip vehicle status back to `"available"`. (Failed case is already handled by the existing `inspections_auto_maintenance` trigger setting `has_open_issues`.)

### 2. `src/components/app/NewReservationDialog.tsx`
- When the chosen vehicle is awaiting a post-return inspection, show a clear red blocker (not the soft amber warning) with two paths:
  - Default: disable the **Confirm** button and tell the user the vehicle needs a runner inspection first, with a deep link to `/checklist?vehicleId=…`.
  - Admin only: a checkbox **"Override — book without inspection (admin)"** that re-enables Confirm. Override is gated on `role === "admin"` from `useAuth()`.
- The existing `hasOpenIssues` acknowledgement path stays for vehicles that already passed inspection but have an open maintenance item.

### 3. `src/routes/fleet.tsx` (and any "Available vehicles" lists)
- Show a small "Needs inspection" badge for vehicles where `awaitingPostReturnInspection(v.id)` is true, so it's visible at a glance.
- Filter the default "Available" view to exclude awaiting-inspection vehicles (still visible under an "Inspection pending" group).

### 4. Booking conflict check
- `hasConflict` is unchanged. The new gate is layered on top in `isVehicleBookable`, so date-overlap checks and the inspection gate are independent.

## What does NOT change

- Brand-new vehicles (no prior rental) are bookable immediately — matches your "after a rental return" answer.
- Drivers' self-serve rent flow (`/rent/$token`) already calls `isVehicleBookable`, so it inherits the block automatically.
- No DB schema changes — uses the existing `inspections`, `rentals`, and `vehicles` tables and statuses.

## Verification

- Create a rental, mark it returned → vehicle shows "Needs inspection" and is blocked in `NewReservationDialog` for non-admins.
- Submit a passing return inspection → vehicle flips to Available and is bookable.
- Submit a failing return inspection → vehicle stays blocked, has_open_issues set, admin override available.
- Add a brand-new vehicle → bookable immediately, no inspection required.
