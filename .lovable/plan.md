# Booking override for vehicles in the shop

Let an admin book or swap onto a vehicle that has open repairs, when the vehicle is still rentable in practice. On-rent conflicts, impound, and archived vehicles stay hard-blocked.

## What changes

**1. New Reservation dialog (`src/components/app/NewReservationDialog.tsx`)**
- When the picked vehicle is blocked only by repair (open maintenance issue or "maintenance" status), the existing "Vehicle unavailable" warning gains an **"Rent anyway (override)"** button alongside "Cancel rental".
- Choosing it sets an admin-only `repairOverride` flag: the repair block is bypassed, a warning chip shows on the vehicle card and review step ("Repair override active"), and an override note is appended to the rental record so there's an audit trail.
- On-rent date conflicts, impound, and archived vehicles still block — the override only covers repair/shop status.

**2. Bookable check (`src/lib/mock/store.ts` → `isVehicleBookable`)**
- Add a `repairOverride` parameter that skips only the `hasOpenIssues` and `status === "maintenance"` checks. Everything else (archived, impound, rented, overlapping rentals) still applies.

**3. Swap vehicle dialog (`src/routes/rentals.tsx` → `SwapVehicleDialog`)**
- The replacement-vehicle dropdown also lists in-repair vehicles, badged "In repair", sorted after available ones.
- Picking one requires the existing reason field (already mandatory) and shows a confirmation line that the swap overrides the repair block.

**4. Calendar/step gating**
- The date-step overlap warning for repair blocks becomes a warning (not a hard stop) when the override is active; on-rent overlaps remain blocking.

## Technical notes
- No database schema changes; the override is a booking-time decision recorded in the rental/swap notes.
- `VehicleAvailabilityCalendar` stays as-is (informational); only the gating logic changes.
- Non-admin users never see the override option.

## Verification
- Typecheck + build OK.
- Browser check: create a reservation on a vehicle with an open repair using the override; confirm a normal on-rent conflict still blocks; confirm swap onto an in-repair vehicle works and the renter SMS still sends.
