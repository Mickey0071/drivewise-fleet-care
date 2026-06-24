## What the balance is actually based on (plain English)

There is **one** formula behind every "owed" number on every screen:

```text
Balance owed  =  (time the car has been out  ×  the rate)
              −  every real payment received
```

- **Time charge** grows on its own as the days/weeks pass — it does **not**
  depend on extensions being signed, links being sent, or anything else.
  For a daily rental it's $65 for each day the car is out (after the 2 deposit
  days); for a weekly rental it's one week's rate per week out.
- **Payments received** = only rows in the payments list that are marked
  **paid** (cash you recorded, or a Stripe charge that actually went through).
- Extensions, signed agreements, and payment links are **paperwork** — they
  add **$0** by themselves. So your rule ("only count it when Stripe actually
  pays") is already how the engine is designed.

So if a number is wrong, it's almost never the formula — it's that the
**payments list has a wrong/duplicate row** feeding into it.

## Why Tory's credit is wrong

Tory pays **$65/day through Stripe**. During the earlier reconciliation we
followed a "keep both, flag for review" rule, which left **duplicate rows**:
on **6/17 and 6/21** he has *both* a manual **cash $65** row *and* the real
**Stripe $65** charge for the same day. That double-counts $130.

- Today (6/24) his car has been out 6 chargeable days = **$390** owed.
- Real Stripe payments = 6 × $65 = **$390**.
- With the 2 phantom cash rows, the system thinks he paid **$520** → shows a
  fake **$130 credit**.
- Remove the 2 duplicates and he reads **$0 owed, paid through today, next
  payment due tomorrow (6/25)** — exactly what you said.

The same pattern left stray duplicates on his returned rental R-531.

## The fix

**1. Clean up the bad rows now (data fix)**
- Delete the two duplicate **cash** rows on R-583: `P-58220260619` (6/17) and
  `PM-R-583-20260619` (6/21). Keep the real Stripe charges.
- Resolve the flagged duplicates on R-531 (returned): drop the non-Stripe
  placeholder where a real Stripe charge exists for the same day/amount.
- Re-scan all rentals for the same "cash + Stripe, same day, same amount"
  pattern and list any others before deleting, so nothing legitimate is lost.

**2. Stop duplicates from coming back (the trust fix)**
- Today the auto-dedupe only removes *unpaid* placeholder rows. It ignores a
  manual **paid cash** row, so when the real Stripe charge lands, both survive.
- Change the rule: when a Stripe charge arrives that matches a same-day
  manual cash entry on the same rental for the same amount, treat the Stripe
  charge as the source of truth and **supersede the manual cash row** instead
  of keeping both. The Stripe charge id stays the unique key.

**3. Lock in the extension-link behavior you described**
- Sending a link (signed or not) creates a charge line that shows as **due**
  and does **not** count as money. It flips to **paid automatically** only
  when the Stripe webhook confirms payment (or you explicitly record it paid).
  This is already the design; it will be verified end-to-end so a sent/signed
  link can never reduce a balance on its own.

**4. Make it auditable**
- Add a small "balance breakdown" on the rental so you can see the math in one
  place: days out × rate, minus each payment listed — so any wrong number
  points straight to the offending row.

### One decision for you
You previously chose "keep both, flag for review" for same-day cash + Stripe.
This plan reverses that to **"Stripe wins, drop the duplicate cash row"**,
because that's what's producing the false credits. If instead you want the
cash row kept in some cases, tell me and I'll make it a review step rather
than an automatic merge.

## Technical notes
- Formula lives in `src/lib/mock/store.ts` (`rentalCanonicalOwed`,
  `rentalTimeCharge`, `rentalPaymentsReceived`, `rentalNextDueDate`) — no
  change needed; it's correct.
- Dedupe change in `reconcileScheduledDuplicate` / `upsertStripePaymentRow`
  in `src/routes/api/public/payments/webhook.ts` to also supersede *paid*
  manual cash rows that match an incoming Stripe charge.
- Data cleanup via SQL after confirming the full duplicate list.
- Breakdown UI in `src/routes/rentals.tsx` (and the rental detail view).
