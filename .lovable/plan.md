# Fix Lateness Calculations

## The problem

Luther Bunting (R-527) shows as ~2 weeks late even though he is fully paid up.

His numbers:
- Rental: May 31 → today, weekly rate $450. Time on rent = 3 weeks = **$1,350 owed**.
- Payments received (cash + Stripe): 450 + 400 + 50 + 350 + 100 = **$1,350**.
- Canonical balance = 1,350 − 1,350 = **$0**. He owes nothing.

But there is a stale, orphaned scheduled installment row (`PM-R-527-20260607`, due **Jun 7**, $450, status `late`) that was never reconciled when his actual payments came in as separate rows. The lateness indicators read that orphaned row and compute "Jun 7 → today ≈ 2 weeks late."

## Root cause

The app has two parallel accounting systems that disagree:

1. **Canonical engine** (`rentalCanonicalOwed` = time charge − all payments received). This is the single source of truth and correctly says $0. Used by the Rentals card *Balance* line.
2. **Legacy scheduled-payment rows** (`payments` with `status !== "paid"`). When a payment is recorded via cash/Stripe it creates a *new* payment row but does not mark the matching scheduled installment paid, so those installments linger as `late`/unpaid forever.

The lateness/overdue UI still reads system #2:

```text
src/routes/index.tsx
  - dueThisWeek: sums payments where status !== "paid", earliest unpaid dueDate
  - overdue: payments where status === "missed" || "late"
  - DueRow "X days overdue" badge driven by that earliest unpaid dueDate
src/routes/drivers.tsx
  - lateCount = payments where driverId matches AND status !== "paid"  → "late" badge
src/routes/rentals.tsx
  - "Next payment" Overdue label uses next = first unpaid scheduled row
    (already partly guarded by bal <= 0, but the underlying row is still stale)
```

## The fix

Make every lateness/overdue display derive from the canonical balance engine, not from orphaned schedule rows. A renter is only late when `rentalCanonicalOwed(r) > 0` AND the current billing period's due date has passed.

### Changes

1. **`src/routes/index.tsx` — Payments due / overdue**
   - Replace the per-rental `unpaid` schedule sum with `rentalCanonicalOwed(r)` for `totalOwed`.
   - Only include a rental in "due this week / overdue" when canonical owed > 0.
   - Compute `earliestDue` / days-overdue from the rental's current billing period (`currentPeriodEnd` / `calcCurrentPeriodEnd`) instead of the earliest orphaned schedule row, so the day/week count reflects the actual unpaid period.
   - Recompute the headline "overdue" total from canonical balances of active rentals rather than `payments` rows flagged `late`/`missed`.

2. **`src/routes/drivers.tsx` — late badge**
   - Replace `lateCount` (count of unpaid payment rows) with a check that the driver has at least one active rental whose canonical balance is past due (owed > 0 and current period end < today). Show the `late` badge only then.

3. **`src/routes/rentals.tsx` — "Next payment" Overdue label**
   - Drive the Overdue / Due today / Scheduled label off the canonical balance and current period due date rather than `next = first unpaid schedule row`, so the label can never disagree with the Balance line shown right below it.

### Optional cleanup (recommended, ask before doing)
Add a one-time reconciliation that marks orphaned scheduled installments `paid` (or removes them) once the canonical balance for their rental is covered, so the legacy rows stop accumulating. This is a data change to the `payments` table and is separable from the display fix above.

## Outcome
Luther and any other paid-up renter will show **$0 balance, not late**. Renters who genuinely owe past their current period still show the correct days/weeks overdue, computed from one consistent source.

## Note
No schema changes required for the display fix (items 1–3). Only the optional cleanup touches stored data.
