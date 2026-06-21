# Separate violation payments from rent due

## Problem
Janai Allen (R-533) paid $525 on 6/16, but that was **$425 rent + $100 toward violations**. Today the full $525 counts as rent received, so the app shows her further "paid ahead" on rent than she really is. Violation money should never reduce rent due.

Confirmed in the data: her payments are $425 (6/8), $525 (6/16), and an unpaid $425 extension. Rate is $425/week.

## What I'll build

### 1. New permanent payment category: `violation`
A payment row tagged `kind = "violation"` is money the renter paid against tickets/tolls/violations. It is tracked on the account but **excluded from rent payments-received**, so it can never make rent owed go down or push a renter "ahead."

- `src/lib/mock/data.ts` — extend the `Payment.kind` union from `"charge" | "credit"` to `"charge" | "credit" | "violation"`.
- `src/lib/mock/store.ts`:
  - `rentalPaymentsReceived` (line ~395): exclude `kind === "violation"` (currently only excludes `"credit"`), so violation money never offsets rent.
  - Add a small helper `rentalViolationPaymentsReceived(rentalId)` that sums paid `violation` rows, for display.
- The `payments.kind` column is free text (no check constraint), so no schema migration is needed — `"violation"` stores fine.

### 2. Show it as its own line (a different column, not rent)
- `src/components/app/ReservationPaymentHistory.tsx` — render `violation` rows with their own label/icon (e.g. "Violation payment") so they read clearly as not-rent.
- `src/routes/rentals.tsx` — surface violation payments received as a separate figure on the card, kept apart from the rent "Due now / balance" math.

### 3. Correct Janai's record (data fix, no money moved)
- Change existing row `PM-5K5JvqKsxP` from `525` → `425` (rent).
- Insert a new paid row: `$100`, `kind = "violation"`, dated 6/16, method Stripe, note "Violation payment (separated from rent)".

This leaves total cash received identical ($950) but only $850 counts as rent.

## Resulting numbers for Janai (R-533), today 6/21
- Possession: 15 days out → 3 weeks posted × $425 = **$1,275 rent charged**
- Rent received: $425 + $425 = **$850** (the $100 no longer counts)
- **Rent due now: $425** — she is **not** ahead
- Violation payments received: **$100**, shown separately
- Unpaid $425 extension still ignored by the balance (possession-based engine, unchanged)

## Out of scope (unchanged)
- Possession/time-charge engine, extensions logic, credit handling, the Return flow.
- No violation record is created; the $6 EZPass on file is untouched. The $100 is recorded purely as a violation-category payment, per your choice.
