# Dashboard accuracy: past-due first, figures match real payments

## Goal
The Admin Dashboard "Payments due this week" and "Overdue" cards must:
1. List genuinely **past-due** rentals first (most overdue at top).
2. Show dollar figures that **coincide with true payments** — every figure = elapsed-time charge + prior balance − payments actually recorded (the rows that mirror real Stripe charges / cash).

No new "upcoming" section. Layout stays the same; only ordering + accuracy.

## What's already correct (verified against live data, today = 2026-06-22)
The dashboard already reads the canonical engine (`rentalCanonicalOwed` = time charge + prior balance − payments received), so it nets out recorded payments. Current true numbers:

```text
R-517 Kassan Crutchfield  weekly $450  start 5/30  4 wks posted=1800  paid 1350 -> OWED $450 (2 days past due)
R-533 Janai Allen         weekly $425  start 6/6   3 wks posted=1275  paid 850  -> OWED $425 (2 days past due)
R-527 Luther Bunting      weekly $450  start 5/31  4 wks posted=1800  paid 1350 -> OWED $450 (1 day past due)
R-576 Patricia McIntyre   weekly $400  start 6/11  2 wks posted=800 +200 prior  paid 1000 -> OWED $0 (not shown)
R-571 Chase Francois      now RETURNED -> excluded from active dashboard lists
```
So the screenshot ($1,275 / Chase 11-days-overdue) is stale; the engine now reports a different, current set. Overdue card should read **$1,325 across 3** (Kassan + Janai + Luther) unless other active rentals are also past due.

## Changes

### 1. Order past-due first (`src/routes/index.tsx`)
The `dueThisWeek` list currently sorts by `earliestDue` ascending, which already floats overdue items up, but it mixes "due today / due soon" in the same flat list with no clear priority. Make the ordering explicit and unambiguous:

- Sort key: rentals with `rentalPastDueDays(r) > 0` first, ordered by **days past due descending** (most overdue on top); then **due today**; then **upcoming within 7 days** by soonest due date.
- Keep the existing week-window filter (overdue items have past due-dates and always pass it), but confirm no past-due active rental is ever dropped.

### 2. Confirm figures equal recorded-payment math (no engine change expected)
The engine already subtracts only `status = 'paid'` rows that are not `credit`/`violation` — i.e. real money. As part of this task I will re-run a read-only check of each active, past-due rental: `time charge + prior balance − Σ(paid rent rows)` and confirm it matches what the card renders. If any rental's figure does **not** match its real Stripe/cash payments, that means a payment row is missing or mis-recorded (a data issue, fixed via an audited payment correction), not an engine bug — I'll flag those rather than silently change them.

### 3. Verify the Overdue card total + count
`overdueAmount` / `overdue.length` already derive from `rentalPastDueDays > 0` and `rentalCanonicalOwed`. Confirm they recompute to the live numbers above after the ordering change.

## Out of scope
- No "upcoming / not-yet-due" section.
- No changes to the billing engine, extensions, violations, prior-balance, or Return flow.
- No bulk rewrite of payment history; any genuine missing-Stripe-payment rows would be handled separately as audited corrections.

## Verification
- Load `/` and confirm the "Payments due this week" list shows overdue rentals first (Kassan/Janai/Luther order by days overdue), each with the figures above.
- Confirm the Overdue card total and "late or missed" count match the recomputed live numbers.
- Confirm returned rentals (Chase R-571) and net-zero rentals (Patricia R-576) do not appear.
