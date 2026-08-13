# Clear "pending extension" once the renter pays

## What changes
On a reservation card, an extension currently keeps showing as pending even after the renter has paid for it. Two places need to respect payment:

1. The amber badge next to "Extend / Send for signature" — today it reads "Sent — awaiting signature" whenever an extension request exists that isn't cancelled or expired, even if its status is already `paid`.
2. The "Extensions on file" list — each row shows "Pending (unsigned)" with a red Delete button when there is no signature, regardless of payment.

After the change:
- A paid extension no longer shows any pending badge. If nothing else is outstanding, the badge disappears entirely; if it was also signed it still shows "Signed".
- In the "Extensions on file" list, a paid extension shows a green "Paid" state and loses the Delete button (paid money shouldn't be deletable from the card).
- Unpaid, unsigned extensions behave exactly as they do today.

## Technical notes
- `extensionSignatureStatus` in `src/lib/mock/store.ts`: filter out rows whose status is `paid` (alongside the existing cancelled/expired filter) before deciding `sent`, and treat a paid row as resolved so `state` returns `none`/`signed` rather than `sent`.
- `src/routes/rentals.tsx` (Extensions on file block, ~line 1008): compute a `paid` flag per extension by matching the rental's paid payment rows to the extension (`paymentId`, falling back to the matching pending-extension record with status `paid` for the same `newEndDate`). Render "Paid" in emerald and suppress the Delete action when paid; keep the current amber "Pending (unsigned)" path otherwise.
- Display-only change: no balance math, no payment logic, no schema changes.
