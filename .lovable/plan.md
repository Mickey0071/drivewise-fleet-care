## Goal

Get the dashboard and reservation cards to display the corrected, fixed balance/lateness numbers (Luther → $0/not late, Sarah → credit, etc.) instead of the stale pre-fix values, and lock in the extension billing behavior you approved.

## What's happening now

The balance/lateness logic in `src/lib/mock/store.ts` is already correct (`rentalCanonicalOwed` / `rentalPastDueDays`). The live preview is showing old numbers only because the browser is serving a stale JS chunk ("Failed to fetch dynamically imported module"). A clean rebuild forces fresh chunks so the screen re-renders with the right values.

## Plan

1. **Restart the dev server / force a clean rebuild** so the preview drops the stale chunk and loads the corrected balance engine. Then confirm on the dashboard:
   - Luther R-527 → $0, not late (drops off the late list)
   - Sarah R-585 → credit ($-140), not late
   - Ellazena / Tory / Janai / Kassan → small past-due amounts as computed by the fixed engine

2. **Finalize the approved extension billing changes** (from the earlier approved direction — "owe it immediately on extend, subtract as they pay"):
   - `rentalTimeCharge` in `src/lib/mock/store.ts`: bill base periods + full extension amount immediately, removing any overlap already counted, so extending bumps the balance up right away.
   - Stop writing phantom unpaid `status:"late"` charge rows in `extendRental` / `createExtensionLink`; only write the `rental_extensions` log row, and write a **paid** payment row tagged as an extension payment when paid.
   - `src/routes/rentals.tsx`: fix the "Amount paid so far" panel so the Extensions column reflects actually-received extension payments (keeping the label), and remove the broken credit subtraction.

3. **Verify** with a quick check against the data that the displayed numbers match the engine, and that extending a rental now raises the balance immediately and paying it brings it back down.

## Technical notes

- No schema changes. All changes are in `src/lib/mock/store.ts` and `src/routes/rentals.tsx`.
- The stale-chunk error is a build/cache artifact, not a logic bug — the rebuild resolves it.
