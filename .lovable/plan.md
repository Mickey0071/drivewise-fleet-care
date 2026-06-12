## Goal
Make the "Choose manually" search in the Add Violation dialog reliably match by **plate/tag** and **customer name** (and keep vehicle matching).

## Problem
In `src/routes/violations.tsx` (the manual-override block ~lines 1391-1399), results are filtered with a plain lowercase substring check across `[driver_name, plate, id, vehicle_label]`. Plate search breaks when the typed plate differs from the stored one by spaces, dashes, or a state prefix (e.g. typing `ABC123` won't find `NJ ABC-123`). Customer-name search already works but feels unreliable when mixed with a failing plate term.

## Change (frontend only)
Edit the manual filter logic in `src/routes/violations.tsx`:

1. Add a small `normPlate` helper (strip everything except `A-Z0-9`, uppercase) — mirrors the matcher logic already used in `violations.functions.ts`.
2. When filtering each rental option, match if ANY of these is true:
   - `driver_name` contains the typed text (case-insensitive) — customer name.
   - `vehicle_label` contains the typed text — vehicle make/model/year.
   - `id` contains the typed text.
   - **Normalized plate match**: `normPlate(option.plate)` includes `normPlate(query)`, and also check the plate embedded in `vehicle_label`. This makes `abc123`, `ABC-123`, and `NJ ABC123` all match the same vehicle.
3. Update the input placeholder to `Search by name, plate/tag, or vehicle…` so the supported fields are clear.

No backend, schema, or server-function changes are needed — `listRentalsForViolation` already returns `driver_name`, `plate`, and `vehicle_label` for both live and migrated reservations.

## Technical detail
```text
const norm = (s) => (s || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
const qRaw = manualQuery.trim().toLowerCase();
const qPlate = norm(manualQuery);
filtered = rentalOptions.filter((r) => {
  if (!qRaw) return true;
  const text = [r.driver_name, r.vehicle_label, r.id].filter(Boolean)
    .some((f) => String(f).toLowerCase().includes(qRaw));
  const plate = qPlate && (norm(r.plate).includes(qPlate) || norm(r.vehicle_label).includes(qPlate));
  return text || plate;
});
```
