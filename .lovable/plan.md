# Fix: Stripe payments not showing on reservation cards (false "late" status)

## Problem
Renters pay through Stripe checkout/payment links, but most of those succeeded charges are never written back into the app's `payments` table. The balance engine (`rentalCanonicalOwed`) only subtracts recorded payments, so it undercounts what was paid and falsely flags renters as late with a balance due.

Confirmed with Tory Sanders (D-1014): Stripe has **34 succeeded charges** under his email across 34 auto-created customer records, but the app recorded only a few. His active rental R-583 has 6 succeeded Stripe charges ($390) — exactly what's owed — yet the app shows only $195 and marks him late.

## Goal
Make every succeeded Stripe charge appear as a payment on the correct reservation, so balances and late status reflect reality. Never double-count.

## Approach

### 1. Reconciliation server function (server-only, admin-gated)
Add a `createServerFn` (e.g. in `src/lib/payment-reconciliation.functions.ts`, which already exists) that:
- Requires an authenticated admin (`requireSupabaseAuth` + `has_role` check).
- Takes a `driver_id` (and optionally a date range / "all drivers" flag).
- Resolves the driver's Stripe customer ids by listing customers via the gateway by the driver's email (handle the many-customers-per-email case), plus any `stripe_customer_id` already on their rentals.
- Lists all succeeded charges for those customers through the connector gateway (`createStripeClient`, with `Stripe-Version` recent enough; search API is unavailable on the default version, so list per customer).
- For each succeeded charge, matches it to a rental by charge date falling within the rental's `[start_date, returned_at|today]` window for that driver.
- Inserts a `payments` row only when no existing row has that `stripe_charge_id` (dedupe key), so re-running is idempotent. Records: amount, `kind='charge'`, `status='paid'`, `method='Stripe'`, `paid_date`, `stripe_charge_id`, `stripe_payment_intent_id`, `rental_id`, `driver_id`.
- Returns a summary: charges found, already-recorded, newly inserted, and any charges that couldn't be matched to a rental (for manual review).

### 2. Handle the "cash" duplicates
Some missing charges were manually logged as `method='cash'` to compensate. Before inserting, detect a likely duplicate (same rental, same amount, same/adjacent date, no `stripe_charge_id`) and either skip or flag it in the summary rather than blindly adding a second payment. Surface these in the result so staff can confirm.

### 3. Admin UI to run it
On the existing `src/routes/admin.payment-reconciliation.tsx` page, add a "Reconcile Stripe charges" action:
- Run for a single renter (default) or all renters.
- Show the dry-run summary (what would be added / skipped / unmatched) before committing, then a confirm step that performs the inserts.

### 4. Run it for Tory and verify
- Reconcile D-1014. Expect R-583 balance to drop to $0 and the late flag to clear; R-531 to be corrected too.
- Verify on the reservation card and via the balance engine.

### 5. Prevent recurrence (follow-up)
The webhook at `src/routes/api/public/payments/webhook.ts` currently handles subscription events only. Extend it to also record one-time `charge.succeeded` / `checkout.session.completed` events into `payments` (deduped by `stripe_charge_id`), so future Stripe payments sync automatically and this gap doesn't reopen.

## Out of scope / notes
- No change to the balance math itself — it's correct; it was simply missing payment rows.
- Inserts go through a migration-safe, admin-authorized path; no service-role key is exposed to the client.

## Technical details
- Stripe access must use `createStripeClient` from `@/lib/stripe.server` (gateway proxy); the live env key works. The account's default API version rejects the Search API, so enumerate charges with `GET /v1/charges?customer=...&limit=100` per customer and a recent `Stripe-Version` header.
- Dedupe strictly on `payments.stripe_charge_id`; it's the only reliable idempotency key.
- Rental matching: a charge belongs to the rental whose `[start_date, COALESCE(returned_at, now())]` window contains the charge's `created` date for that driver; report ambiguous/unmatched charges instead of guessing.
