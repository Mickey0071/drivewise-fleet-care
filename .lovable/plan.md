## Goal

Make every reservation's balance come from **one live calculation** based on the rule you just described, and stop relying on any old stored balance numbers. Then re-evaluate extensions so balances update correctly going forward.

## The single balance rule (plain English)

For every reservation, balance is computed live as:

```text
Balance due =  base rental owed for days actually used
            +  all extensions sent out (added to amount due)
            −  every payment received (base + extension + any other)
```

Details of each piece:

1. **Base rental owed (time actually used)**
   - Daily rentals: number of days the car has been out × daily rate.
   - Weekly rentals: number of weeks out × weekly rate.
   - Counts from the start date up to **today** while the car is still out, and up to the **return date** once returned. It keeps adding every day/week until the vehicle is returned.

2. **Extensions**
   - When an extension is **sent out**, its amount is **added** to the balance due.
   - When that extension is **paid**, the payment is **subtracted** (handled by the payments line below), so a paid extension nets to zero.
   - Duplicate links for the same period are collapsed to a single charge so re-sent links never stack.

3. **Payments received**
   - Subtract **every** payment recorded against the reservation — base rental, extension, or anything else.

4. **Violations** stay on their **own separate line** and are never mixed into the rental balance.

So: a fully paid-up renter shows **$0**; a car still out keeps accruing day-by-day (or week-by-week) until returned; sent-but-unpaid extensions show as owed; paid extensions disappear from the balance.

## What changes in the app

1. **One calculation engine.** Update `rentalOwed()` in `src/routes/rentals.tsx` and the helpers in `src/lib/mock/store.ts` so the balance is always derived live from the rule above — never read from a stored `balance` field. The same engine already exists in `src/lib/balance-audit.functions.ts`; align all three to identical math (base = time-used × rate, extensions sent = added, all payments = subtracted, accrue until return).

2. **Time-based accrual.** Add the day/week accrual so a car still out keeps increasing the balance up to today, and a returned car stops at the return date.

3. **Re-evaluate extensions.** Make "extension sent" add to the balance and "extension paid" subtract via the payment, with same-period dedupe — so stale/duplicate extension rows stop inflating balances.

4. **Audit / report first.** The `/admin/payment-reconciliation` Balance Audit tab will show, for every reservation, the old (stored/legacy) number vs the new live number, the full breakdown (days used × rate, extensions sent, payments, accrual), and the difference — so you can see exactly who changes and why before anything is touched.

## Rollout / safety

- No stored balance is silently overwritten. The live calculation drives what's displayed; any actual record corrections (e.g. fixing a bloated charge row or a bad extension) are applied **one-by-one** from the Balance Audit screen and logged to `payment_audit_log` with a reason, using the existing audited admin functions.
- Deliverable order: (1) wire the single engine, (2) show the before/after report across all reservations, (3) you approve corrections individually.

## Technical notes

- Engine inputs per reservation: `start_date`, `end_date`/`returned_at`, `billing_period`, `rate`/`weekly_rate`, payments (all kinds), extension requests (sent/paid), violations (separate).
- Accrual: `periods(coveredStart → today-or-returnDate) × periodRate`, weekly = `ceil(days/7)`, daily = days.
- Files: `src/routes/rentals.tsx` (`rentalOwed`/`rentalBalance`), `src/lib/mock/store.ts` (`unpaidExtensionTotal` and a new base-accrual helper), `src/lib/balance-audit.functions.ts` (align report math), `src/routes/admin.payment-reconciliation.tsx` (before/after columns).
</content>
<summary>One live balance engine: base = days/weeks actually used × rate, plus extensions sent, minus all payments, accruing until the car returns; violations separate. Report old vs new for every reservation before any record change.</summary>
</invoke>
