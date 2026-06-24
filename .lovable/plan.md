## Goal

Tory Sanders is falsely flagged "late." Stripe shows **34 succeeded $65/day charges totaling $2,275** (daily, 5/11 → 6/23), but the app's `payments` table only recorded a handful and links just 6 by Stripe charge ID. The fix: reconcile every real Stripe charge into the app, and prevent the gap from reopening.

## What's actually in Stripe vs the app

- 34 succeeded charges across 34 auto-created Stripe customers (Stripe makes a new customer per payment-link charge), all under `SANDERSTORY2008@GMAIL.COM`.
- App `payments` for driver D-1014: 11 rows, only 6 carry a `stripe_charge_id`.
- Two app rows logged as **cash** (6/17, 6/21) coincide with real Stripe charges — likely mislabeled.

## Plan

### 1. Reconcile Tory's full history (one-time, admin-only)
A `createServerFn` in `src/lib/payment-reconciliation.functions.ts` (guarded by `requireSupabaseAuth` + `has_role('admin')`):

1. Resolve the driver's Stripe customer IDs: list customers by email (handling the many-customers-per-email case), plus any `stripe_customer_id` on the driver's rentals.
2. Enumerate all succeeded, non-refunded charges for those customers via `createStripeClient` (gateway), paginating.
3. For each charge, find the rental whose `[start_date, COALESCE(returned_at, now())]` window contains the charge date for that driver.
4. **Dry-run first**: return a summary — charges to add, already-recorded (deduped on `stripe_charge_id`), cash-day conflicts, and unmatched charges (no rental window — e.g. the May charges that predate R-520). Nothing is written until confirmed.
5. **On confirm**, insert one `payments` row per missing charge: `amount`, `kind='charge'`, `status='paid'`, `method='Stripe'`, `paid_date`, `stripe_charge_id`, `stripe_payment_intent_id`, `rental_id`, `driver_id`.

### 2. Cash-duplicate handling (per your choice: keep both, flag)
For days that have both a manual cash row and a real Stripe charge (6/17, 6/21): insert the Stripe charge as a normal row, but mark it for review (e.g. a `needs_review` note/flag) and surface it in the dry-run conflict list so you can decide which to keep. Nothing is auto-deleted.

### 3. Unmatched May charges
~21 charges from 5/11–5/31 fall before any rental currently in the system (earliest is R-520 on 6/1). These will be reported as "unmatched — no rental window" rather than force-inserted. You decide whether an earlier rental existed; I can widen a rental's start window or create a historical rental record if you confirm.

### 4. Prevent recurrence (webhook)
Extend `src/routes/api/public/payments/webhook.ts` to also record one-time `charge.succeeded` / `checkout.session.completed` events into `payments` (deduped by `stripe_charge_id`), matching to the open rental by customer/date. This stops future daily Stripe charges from going unrecorded.

## Outcome

After running reconciliation on Tory, his recorded paid total matches Stripe, his balance reflects true payments, and the "late" flag clears. The same tool can be run for other renters with the same phantom-balance issue.

## Technical notes

- Gateway-only Stripe access via `createStripeClient` from `@/lib/stripe.server` (live env); enumerate charges per customer (Search API needs charge-level queries that aren't reliable on the pinned version).
- `attachSupabaseAuth` is already required globally for `requireSupabaseAuth` — verify it's in `src/start.ts`, add if missing.
- Inserts via service-role client loaded inside the handler after the admin check.
- No schema change unless we add a `needs_review` flag column for cash conflicts (small migration); otherwise encoded in the row's `notes`.
