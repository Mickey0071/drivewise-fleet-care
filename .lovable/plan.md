# Plate Backfill — Read-Only Preview

A preview-only screen that shows exactly how the 93 verified plates would pair against `legacy_rentals`. **Nothing is written to the database in this step.** The actual update happens in a separate prompt after you confirm.

## What I verified against the live data
- `legacy_rentals` **already has** a nullable text `plate` column — no schema change needed.
- 352 total rows; **3 already have a plate**, 349 are null.
- The composite match (customer name + pickup date + return date) pairs correctly when comparing names case-insensitively and matching on the calendar date (UTC) of `start_datetime` / `end_datetime`.
- Some mapping lines match **more than one** legacy row (e.g. duplicate "Janai Allen" rows). The preview will surface this so it's visible before any update.

## How matching works
For each of the 93 mapping lines:
- Normalize: `lower(trim(renter_name))` vs `lower(trim(customer))`.
- Dates: `start_datetime::date = pickup` and `end_datetime::date = return`.
- **Never** match on order/reservation number.

Each matched legacy row is classified:
- **WILL UPDATE** — row found, `plate` currently null.
- **ALREADY SET** — row found, `plate` already populated (will be left untouched).
- **NO TABLE ROW FOUND** — mapping line matched zero rows.
- **MULTIPLE MATCHES** (extra status) — mapping line matched more than one row, shown so you can review before updating.

## Screen layout (`/admin/backfill-plates`, read-only)
1. **Summary counts** at top: WILL UPDATE, ALREADY SET, NO TABLE ROW FOUND (plus a MULTIPLE MATCHES count if any).
2. **Preview table** with columns:
   - legacy_rentals row id
   - customer
   - pickup date
   - return date
   - vehicle (as stored)
   - current plate value
   - proposed plate (from mapping)
   - match status (color-coded badge)
3. **Remaining-null section**: a separate table listing every `legacy_rentals` row that will still have a null plate after this backfill (older/retired vehicles with no tag), so you can see exactly what's left unmatched.

## Technical approach
- Add a read-only server function `previewPlateBackfill` (in `src/lib/plate-backfill.functions.ts`) that embeds the 93-line mapping as a SQL `VALUES` list, LEFT JOINs it to `legacy_rentals` on the normalized composite key, and also returns the still-null rows. It only runs `SELECT` — no `UPDATE`/`INSERT`.
- Add route `src/routes/admin.backfill-plates.tsx` rendering the counts, preview table, and remaining-null list using existing `Card`, `Table`, and `Badge` UI components.
- No migration, no data writes. The mapping is stored in code so the follow-up "run the update" prompt can reuse the exact same matching logic.

## Out of scope (next prompt)
- The actual `UPDATE legacy_rentals SET plate = ... WHERE plate IS NULL` will be built and run only after you confirm these pairings.
