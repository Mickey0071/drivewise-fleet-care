## Goal

Add violation-to-rental auto-matching driven by an explicit **vehicle dropdown**, layered on top of the plate-based matching that already works. This is additive only: no changes to the violations tab layout, filters, existing workflows, or the violations schema beyond formalizing one column. Existing violation records keep working unchanged, showing a blank rental section when unlinked.

## What already exists (reused, not rebuilt)

- `violations.rental_id` (nullable) and rentals storing `vehicle_id`, `driver_id`, `start_date`, `end_date`, `agreement_pdf_url` (PDF in the `rental-signing` bucket — kept as-is per your choice).
- `lookupRentalByPlate` — date-range match with the correct open-rental rule (`end_date IS NULL OR end_date >= date`), single-match / multi-match / no-match handling.
- `listRentalsForViolation` — full rental history for manual selection.
- `matchViolationToRental` + `getViolationAgreement` — detail-view linking and agreement PDF resolution.
- The New Violation dialog's picker, single-match auto-select, and manual-selection fallback.

## Changes

### 1. Database — formalize the FK (only schema change)
Add a foreign key on the existing `violations.rental_id` column referencing `rentals(id)` with `ON DELETE SET NULL`. Verified: all 8 currently-linked violations reference live rentals, so the constraint applies cleanly. No column added/removed, no data change, no layout impact.

### 2. New server function — match by vehicle + date
Add `lookupRentalByVehicle` to `src/lib/violations.functions.ts` (mirrors `lookupRentalByPlate` but keyed on `vehicle_id`). Given `{ vehicleId, date }` it:
- Queries rentals for that vehicle covering the date (`start_date <= date AND (end_date IS NULL OR end_date >= date)`).
- Returns `{ vehicle, matches[], found, ambiguous, ... }` with driver name/phone/email joined, matching the shape the dialog already consumes.

### 3. Entry form — add the vehicle dropdown
In `NewViolationDialog` (`src/routes/violations.tsx`), add a **Vehicle** select (fleet list, reusing the vehicles already loaded via `listRentalsForViolation` or a small fleet query) above the existing plate field. On change, and whenever the violation date changes, call `lookupRentalByVehicle`:
- **Exactly one match** → auto-select the rental, auto-fill renter name + contact into the record, and show an inline **View Agreement** button (via `getViolationAgreement`).
- **Multiple matches** → show the existing picker listing each candidate with renter name + rental date range.
- **No match** → show "No active rental found for this vehicle on this date" and reveal the existing manual-selection list scoped to that vehicle's full rental history.

The current plate/OCR auto-match path stays intact and untouched; selecting a vehicle simply drives the same result state. Selecting a vehicle also pre-fills the plate field for consistency.

### 4. Detail view — renter + agreement link
The detail view already returns the linked rental and `agreementUrl`. Confirm/ensure it renders: linked renter name + contact, and a one-click **Rental Agreement PDF** button (for lessor-exemption / liability-transfer packets). Add only if any piece is missing; no restructuring.

### 5. Backfill
Manual linking from the detail page already uses `matchViolationToRental` with the same date logic. Extend the manual-link UI to also offer the new vehicle+date auto-match suggestion, reusing `lookupRentalByVehicle`. Existing manual selection remains available.

## Explicitly NOT changing
- Violations table schema (only the FK constraint is added to the existing column).
- Violations tab layout, filters, tabs, or existing workflows.
- Agreement storage — stays in `rental-signing`.
- The plate/OCR matching flow.

## Technical notes
- `lookupRentalByVehicle` uses `supabaseAdmin` inside the handler with `requireSupabaseAuth`, same pattern as `lookupRentalByPlate`.
- The FK uses `ON DELETE SET NULL` so deleting a rental clears the link rather than blocking the delete.
- No new packages, buckets, or routes.
