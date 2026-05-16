## Where we are — and what's left to finish the core flow

Your core path is **Add a vehicle → Reserve it → Renter signs/pays → Rental is active**. Everything else (Insurance, Expenses, Payroll, Inspections, Violations, PnL) is a side feature already built. Here's the honest status of the core, plus what to do next.

### What already works

1. **Add vehicle** (`src/routes/fleet.tsx` → `AddVehicleDialog`)
   - Make/model/year/VIN/plate/mileage/risk tier/daily+weekly rate
   - Profile photo upload (saved to `vehicle-photos` bucket, set as `image_url`)
   - Saves to Supabase `vehicles`, syncs in real time.
2. **Vehicle detail page** (`src/routes/fleet.$vehicleId.tsx`)
   - Photo gallery, edit, log service, start reservation, share rental link.
3. **Edit vehicle** (`EditVehicleDialog`) — full edit + delete + change photo.
4. **Reserve a vehicle** — two paths:
   - **Internal:** `NewReservationDialog` — 4-step wizard (Vehicle → Client → Dates → Review). Conflict checking, swap-existing-rental support, deposit, billing period, auto-text signing link to renter on confirm.
   - **Public share link:** `ShareRentalDialog` builds a `/rent/$token` link, optional SMS to renter's phone. The renter fills out their info, uploads license + selfie, signs — handled by `submitShareApplication` server fn.
5. **Sign + pay flow:** `/sign/$token` route + Stripe checkout already wired; webhook flips rental to active when payment lands.

### What's incomplete or rough on the CORE path

These are the only items I think you should care about until they're done. Side bars stay parked.

A. **"Add vehicle" form is missing fields renters/staff actually need**
   - No color, no transmission, no fuel type, no seats, no registration expiry, no insurance expiry.
   - No "Notes / known issues" field on create (it exists on edit only).
   - No way to upload multiple gallery photos during initial add (you have to add the vehicle, then go to the detail page).

B. **Reservation wizard rough edges**
   - "Client" step has add-driver inline but no license upload there.
   - No price summary at the top of the Review step (total rent for the period, deposit, expected first payment).
   - No way to attach a pre-collected deposit payment record from the dialog.

C. **Public rental link (`/rent/$token`)**
   - Works end-to-end, but renter never sees the agreement terms before signing.
   - No "save & resume" — if the renter closes the tab, they lose progress.

D. **Status visibility**
   - Fleet page shows status badges, but there is no single "Reservation pipeline" view (Pending → Signed → Paid → Active) so you can see where every booking is stuck.

### Recommendation: pick ONE of these to do next

Each is a focused, shippable chunk. We do one, you test it, we move to the next.

1. **Beef up Add Vehicle** (Item A) — biggest visible win, ~1 turn.
2. **Polish Reservation wizard** (Item B) — improves daily ops, ~1 turn.
3. **Reservation pipeline view** (Item D) — a new section on `/rentals` showing every booking by stage with quick actions (resend signing link, mark paid, cancel). ~1 turn.
4. **Renter-facing polish** (Item C) — agreement preview + resume token. ~1–2 turns.

### Side-bar features already shipped (parked, no work needed)
Insurance & accident claims, Expenses, Payroll, PnL, Inspections, Violations, Maintenance, Calendar, Reports/CSV export, Global search, Auth + roles, Payments webhook, Reminders cron, Driver/Staff portals.

---

**Tell me which of 1–4 to do next** (or say "all of them in that order"). I'll execute one at a time and come back for sign-off before moving on, so we actually finish.
