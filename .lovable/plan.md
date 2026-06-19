## What you're seeing

On Luther Bunting's reservation (R-527): the car was **Returned Jun 21, 2026**, the **Balance is $0**, yet the **NEXT PAYMENT** box shows **"$450 due Jun 7, 2026 — Overdue"**. That is contradictory and confusing.

## Why it happens

The card has two independent calculations that disagree:

- **Balance** uses the new canonical engine (time actually used × rate − all payments). For Luther it nets to **$0** — he's fully paid up.
- **Next payment** does NOT use that engine. It just grabs the first row in the old fixed payment schedule that isn't marked "paid":

```text
next = sched.find(p => p.status !== "paid")
```

When a weekly rental was set up, the system pre-created a row for every week (Jun 7, Jun 14, …). Those scheduled rows were never flipped to "paid" even though the money came in as actual payments (e.g. the $1,350 already received). So a stale, leftover schedule row (Jun 7) surfaces as the "next payment," and because today is past Jun 7 it gets stamped **Overdue** — even though nothing is actually owed and the car is already back.

So the "overdue next payment" is a **phantom from the legacy schedule**, not a real debt. The $0 balance is the correct number.

## The fix

Make the "Next payment" box agree with the canonical balance and the rental's real state, instead of trusting stale schedule rows.

1. **Returned/completed rentals show no "next payment."** If `reservationStatus` is `returned` or `completed`, replace the Next payment line with "Rental returned — nothing scheduled" (and just show the Balance). A car that's back has no future installment.

2. **Suppress the box when the balance is $0 or a credit.** Even for active rentals, if the canonical balance is ≤ $0, don't show an "Overdue" installment — show "All paid" / the credit. An overdue label should only appear when the canonical engine actually says money is owed.

3. **Drive the amount/label from the balance, not the stale row.** When something IS owed on an active rental, show the real outstanding amount and the next genuine due date, rather than a pre-seeded schedule row that was never reconciled.

This is a **display-logic change only** in `src/routes/rentals.tsx` (the `renderCard` "Next payment" block). No balances, payments, or records are modified — it just stops the card from contradicting itself.

## Result

- Luther (R-527, returned, $0): Next-payment "Overdue" disappears; card shows Returned + Balance $0.
- Active renters who genuinely owe money still show the correct amount and an Overdue flag when truly past due.

## Technical detail

In `renderCard`, gate the Next-payment render on `r.reservationStatus` and on `rentalBalance(r)` rather than on `sched.find(p => p.status !== "paid")`. Keep the existing Balance/credit block as the single source of truth.
</content>
<summary>The "Next payment / Overdue" line reads stale legacy schedule rows instead of the canonical balance, so a returned, fully-paid rental falsely shows an overdue installment. Fix is display-only in rentals.tsx: hide next-payment for returned rentals and when balance ≤ $0, and drive it from the canonical balance.</summary>
</invoke>
