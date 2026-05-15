## What you're seeing

On the Fleet page, each vehicle card has: photo upload, **Profile**, share, and **Reserve** — but no way to edit the vehicle's details (make, model, plate, VIN, mileage, daily/weekly rates, risk tier, status). The vehicle Profile page also has no Edit button. So if you mistype a plate or need to change a rate, you're stuck.

## Plan

Add an **Edit vehicle** flow in two places (both opening the same dialog):

1. **Fleet card** — add a small "Edit" button next to Profile/Share/Reserve.
2. **Vehicle Profile page** — add an "Edit vehicle" button in the header.

**The Edit dialog** is essentially the existing AddVehicleDialog repurposed. Editable fields:
- Make, Model, Year, Plate, VIN
- Mileage
- Daily rate, Weekly rate
- Risk tier (A/B/C)
- Status (available / rented / maintenance / impound)
- Next service due (date)
- Notes
- Profile photo (replace, same as today)

**Save** writes to the `vehicles` table via a new `updateVehicle(id, fields)` helper in `src/lib/mock/store.ts` (mirrors the existing `addVehicle` / `updateVehicleImage` pattern — local store update + Supabase upsert). Toast on success/failure.

**Delete** — I'll also add a "Delete vehicle" button inside the Edit dialog (with a confirm prompt), since you'll likely want it. Blocked if the vehicle has an active rental.

## Files touched

- `src/lib/mock/store.ts` — add `updateVehicle()` and `deleteVehicle()` helpers
- `src/components/app/EditVehicleDialog.tsx` — new dialog (extracted/cloned from the AddVehicleDialog already in `fleet.tsx`)
- `src/routes/fleet.tsx` — add Edit button on each card, wire the dialog
- `src/routes/fleet.$vehicleId.tsx` — add Edit button in the profile header

Frontend + one tiny store helper. No migrations needed (the `vehicles` table already has every column and the RLS allows authenticated writes).

## Out of scope (ask if you want)

- Bulk edit / multi-select
- Audit log of who edited what
- Editing the vehicle `id` (keeping it stable)

Want me to build this exactly as described, or change anything (e.g. skip Delete, skip the status field)?
