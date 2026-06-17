# Custom payments with a positive credit balance

## Goal
Let a reservation accept a custom payment larger than what's owed. The payment first clears the outstanding balance, and any extra becomes a **credit on file** that shows as a positive balance with "nothing due". Example: renter owes $100, pays $200 → $0 due + $100 credit. Credit is **display-only** (staff decide when to use it; it is not auto-applied to future charges) and is **surfaced everywhere relevant**: the reservations balance column, the reservation detail, and the payment/cash dialogs.

## How it works today
- `recordManualPayment` (cash/manual) already applies money to the oldest unpaid charges first, then records any leftover as a standalone paid receipt — but that leftover is invisible because `rentalBalance` never goes below $0.
- The Send Payment Link dialog already supports a custom amount and "let renter choose the amount", so admins can already *send* an arbitrary amount. The missing piece is representing the resulting overpayment as a credit.

## Plan

### 1. Tag overpayment receipts (database)
Add a `kind` column to the `payments` table (`text not null default 'charge'`, allowed values `charge` | `credit`). This lets us distinguish pure overpayment money from charge-satisfying payments without guessing. Existing rows default to `charge`.

### 2. Store layer (`src/lib/mock/store.ts` + `src/lib/mock/data.ts`)
- Add `kind?: "charge" | "credit"` to the `Payment` type and include it in the `fromPayment` / `toPayment` mappers.
- In `recordManualPayment`, tag the leftover overpayment "extra" receipt with `kind: "credit"` (the branch that already runs when `remaining > 0` after clearing all unpaid charges).
- Add a helper `rentalCredit(rentalId): number` that sums paid receipts where `kind === "credit"`.

### 3. Balance display (`src/routes/rentals.tsx`)
- Update `rentalBalance` to return a **net** value: `owedAmount - rentalCredit(r)`. This can now be negative (a credit).
- Where the balance is rendered (row + detail), when the value is negative show it in green as `Credit $100.00 · nothing due`; when zero/positive keep current behavior.
- `rentalStatus`: a reservation with a credit (net ≤ 0) is never `past_due`.
- Anywhere a dialog's `defaultAmount` uses `rentalBalance(...)`, clamp with `Math.max(0, ...)` so we never pre-fill a negative amount.
- Sorting by balance keeps working (smaller/negative = credit sorts as fully paid).

### 4. Payment dialogs (surface credit "everywhere relevant")
- `SendPaymentLinkDialog.tsx` and `RecordCashDialog.tsx`: accept an optional `creditOnFile` number prop and, when > 0, render a small note (e.g. `💳 Credit on file: $100.00`) so staff don't accidentally re-charge. Pass `rentalCredit(r)` from `rentals.tsx`.
- Custom/over amounts are already allowed in these dialogs; no change to their input validation.

### 5. Stripe link / custom payments (`src/routes/api/public/payments/webhook.ts`)
- When recording a paid receipt for a payment-link / `custom_renter_payment` whose amount exceeds the remaining unpaid charges, apply it to the oldest unpaid charges first and tag the leftover row `kind: "credit"`, mirroring `recordManualPayment`. This makes credit appear consistently whether paid by cash or by Stripe link.

## Technical notes
- Migration is additive (new nullable-with-default column); no backfill needed. `payment_audit_log` trigger continues to capture changes unchanged.
- `kind` is the single source of truth for credit, so the UI math stays simple and the existing nuanced owed-amount logic (extensions, returned cutoffs, phantom-balance protection) is untouched — we only subtract a separately-tracked credit total.
- No auto-apply: credit never reduces a future charge automatically; it only changes what's displayed.

## Out of scope
- Auto-applying credit to future extensions/renewals.
- Refunding credit back to a card.
