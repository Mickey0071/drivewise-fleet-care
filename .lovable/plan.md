## Goal
Stop counting paid violations toward a reservation's "Amount paid so far" total — on every reservation.

## Where it happens
In `src/routes/rentals.tsx`, `renderCard`:
- Line 389: `const totalPaid = baseRental + extensionsReceived + violationsPaid;`
- The "Amount paid so far" panel (lines 425–450) shows three sub-boxes: Base rental, Extensions, and **Violations**, and `totalPaid` is the bold headline figure.

Violations are not part of the canonical balance engine (`rentalCanonicalOwed` / `rentalPaymentsReceived` never include them), so this is purely a display total — the balance/amount-owed is unaffected.

## Change
1. Remove `violationsPaid` from the total:
   `const totalPaid = baseRental + extensionsReceived;`
2. Remove the **Violations** sub-box from the "Amount paid so far" panel so the breakdown still reconciles with the headline (Base rental + Extensions = total), and switch the grid from 3 columns to 2.
3. Leave the violation charge/collection workflow itself untouched (the Violations dialog, violation records, and any unpaid-violation balance behavior stay exactly as they are). This change only affects the "Amount paid so far" display.

## Scope
- Frontend/presentation only, one file (`src/routes/rentals.tsx`).
- Applies to all reservation cards and the detail dialog (both use `renderCard`).
- No database, balance-engine, or business-logic changes.
