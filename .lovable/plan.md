## Fix double-booking bug + add live overlap validation

### Files touched
- `src/lib/mock/store.ts` — rewrite `rentalBlocksVehicle`, `hasConflict`, `isVehicleBookable`; add live DB overlap guard in `addRental`, `swapVehicle`, `extendRental`.
- `src/components/app/NewReservationDialog.tsx` — reorder wizard: dates → vehicle → renter → confirm; re-filter vehicles by date range; clear stale vehicle selection if dates change.

### Logic changes

**`rentalBlocksVehicle(r, ignoreRentalId?, newStart?, newEnd?)`**
- Return `false` if same id, if already returned, or if status ∉ {active, pending}.
- If `newStart` omitted (reconcile / picker before dates) → treat any active+unreturned rental as blocking (preserves current "vehicle marked rented" behavior).
- Otherwise: overlap = `existingStart <= (newEnd ?? +∞)` AND `(existingEnd ?? +∞) >= newStart`. Open-ended on either side = infinity.

**`hasConflict(vehicleId, start, end?, ignoreRentalId?)`**
- Forward dates into `rentalBlocksVehicle`. Remove the duplicated date math — single source of truth.

**`isVehicleBookable(vehicleId, newStart?, newEnd?, allowOverride?, ignoreRentalId?)`**
- Add optional date-range params, forward to `rentalBlocksVehicle`. Existing zero-arg callers (fleet list, dashboard counts, edit dialog, swap picker) keep working with safe "block all active" default.

**`addRental` (+ `swapVehicle`, `extendRental`)**
- Before insert/update, query live: `supabase.from("rentals").select(...).eq("vehicle_id", ...).is("returned_at", null).in("reservation_status", ["active","pending"])`, filter for overlap, throw if any.
- Becomes `async`. Update all callers to `await` and surface errors via toast. Uses the RLS-authenticated client (admin has SELECT on rentals) — not `supabaseAdmin`, which is server-only.

### Dialog reorder (NewReservationDialog)
1. **Dates** — start (required), end (optional / open-ended toggle).
2. **Vehicle** — filtered via `isVehicleBookable(v.id, start, end)`; show "N vehicles available for these dates" badge.
3. **Renter** — pick or create.
4. **Confirm** — server validation in `addRental` is authoritative; keep client `hasConflict` as fast-fail.

If user backs up and changes dates, re-validate the selected vehicle; if no longer bookable, clear selection and show "Your selected vehicle is no longer available for these dates — pick another."

### Test matrix (walked through new logic)
| Existing | New | Expected |
|---|---|---|
| V-101 May 25–Jun 1 | V-101 May 28–Jun 5 | **blocked** |
| V-101 May 25–Jun 1 | V-101 Jun 2–Jun 5 | allowed |
| V-101 open-ended from May 1 | V-101 May 28 | **blocked** |
| V-101 May 25–Jun 1 | V-102 May 28–Jun 5 | allowed |
| Pick vehicle, then change dates into a conflict | — | selection cleared + warning |

### Out of scope
Smart Booking Dashboard / displacement / swap suggestions — separate follow-up prompt.

### One confirm before building
Client-side `supabase` (RLS-authenticated) for the live overlap check is the practical choice. If you want it wrapped in a `createServerFn` with service role for extra hardening, say so and I'll add ~30 lines.