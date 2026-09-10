# Adjusted utilization (only count days a vehicle could earn)

Today the Utilization page divides days on rent by every calendar day in the period. A car sitting in the shop counts against it, so a perfect month plus a half-repair month reads as ~75% instead of reflecting real earning ability.

## What changes

Add a second measure alongside the current one:

- **Available days** = days in the period minus days the vehicle was out of service (open or completed repair covering that day, or the vehicle marked as in maintenance/impound/inspection).
- **Adjusted utilization** = days on rent / available days.
- A day both on rent and under repair still counts as on rent (rented wins), so the number never exceeds 100%.
- If a vehicle was down every day of the period, show "—" instead of dividing by zero.

## Where it shows up

1. Top of the page: a new tile "Adjusted utilization" next to the current live percentage.
2. Per-vehicle table: new columns **Days down** and **Adjusted %**, with the existing raw utilization kept for comparison.
3. Daily chart: keep the existing bars, and only count vehicles that were operable that day in the denominator so the daily line matches the new definition. The tooltip names both the rented count and the operable fleet size for that day.
4. Short explainer line under the table describing how adjusted utilization is calculated.

## Technical notes

- New helper in `src/lib/vehicle-blocks.ts` (or a small local helper in the utilization route) that returns downtime windows per vehicle from `maintenance` rows: window start = `createdAt` (fallback `nextServiceDue`), end = `dateCompleted` if set, otherwise today (still open). Vehicles with status `maintenance` / `impound` / `inspection` are treated as down from today onward.
- `src/routes/analytics_.utilization.tsx`: add `isDownOnDay(vehicleId, day)` and use it in the per-vehicle loop, the daily chart loop, and the new fleet tile. Existing `coversDay` rental logic is unchanged.
- Pure presentation/derivation work; no schema or write-path changes.
