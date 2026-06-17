# Fix plan: stop phantom / double-counted Stripe payments

## Problem recap
- `payments` rows are keyed only by `PM-<last 10 chars of checkout session id>`. The table has **no** `stripe_payment_intent_id` / `stripe_charge_id` columns, so there is no way to tell whether two rows represent the same real money.
- The amount is taken from the checkout **session**, not the actual Stripe **charge**, so a $200 collection on R-576 was recorded as $400.
- Result: any reservation that generates more than one checkout session (retried link, second link, duplicate `checkout.session.completed`) gets an extra revenue row. This is **systemic** — R-517, R-533, R-576, R-512, R-530, R-582, R-520 all have same-day duplicate paid rows, plus several $1 test duplicates.

## Goal
Make a real Stripe **charge** the unit of truth: exactly one `payments` row per real charge, with the real charge amount, deduped no matter how many sessions/events fire. Then correct the historical data.

---

## Phase 1 — Schema (migration)
Add Stripe identity columns to `public.payments` and a uniqueness guard:
- `stripe_charge_id text`
- `stripe_payment_intent_id text`
- `stripe_checkout_session_id text`
- `stripe_event_id text`
- **Partial unique index** on `stripe_charge_id` where `stripe_charge_id IS NOT NULL` (one row per real charge; this is the actual idempotency guard).

No data changes in this phase. Existing rows keep their `PM-…` ids; the new columns are null until backfilled in Phase 3.

## Phase 2 — Webhook hardening (`src/routes/api/public/payments/webhook.ts`)
Applies to every path in `handleCheckoutCompleted` that writes a `payments` row (first_payment / deposit / payment_link, and custom_renter_payment):
1. After retrieving the PaymentIntent, also capture `latest_charge.id` and the charge's `amount`.
2. Write `stripe_charge_id`, `stripe_payment_intent_id`, `stripe_checkout_session_id`, and the event id onto the payment row.
3. **Record the amount from the real charge** (`charge.amount / 100`), not `session.amount_total`, so a $200 charge can never be stored as $400.
4. **Dedup on charge id**: upsert with `onConflict: stripe_charge_id` (or a pre-insert existence check on `stripe_charge_id`) so the same real charge never creates a second row, regardless of how many sessions or `checkout.session.completed` / `payment_intent.succeeded` events arrive.
5. Keep the `PM-…` id scheme for new rows (backwards compatible), but correctness now comes from the charge-id unique index, not the id slice.

## Phase 3 — Reconcile & correct historical data
Build a **read-first admin reconciliation server function** (auth + admin role check) that, for a given rental (and a fleet-wide batch mode), uses `createStripeClient` to:
- List the real succeeded, non-refunded charges for that reservation (via the saved customer / payment-intent metadata `rental_id`).
- Compare them to the existing `payments` Stripe rows and produce a **diff report**: which rows match a real charge, which have the wrong amount, and which are phantoms with no backing charge.
- Backfill `stripe_charge_id` / `stripe_payment_intent_id` on the rows that do match.

The function first runs in **report-only** mode. After you review the diff, corrections are applied with the data tool (UPDATE/DELETE), not blind deletes:
- Fix wrong amounts to the real charge amount (e.g. R-576's $400→$200 row).
- Delete phantom rows that have no backing Stripe charge.
- Leave legitimate multi-week rows (e.g. R-513's five $55 across different dates) untouched.

Affected reservations to run through reconciliation: R-517, R-533, R-576, R-512, R-530, R-582, R-520 (real-money dups) and R-501, R-506, R-507, R-521, R-526, R-578 ($1–$7 test dups).

## Verification
- After Phase 3, R-576 nets to **$600** ($400 + $200), matching Stripe.
- Re-run the fleet-wide "same-day same-amount Stripe paid rows" query → only legitimate rows remain.
- New rows written by the updated webhook carry a non-null `stripe_charge_id`; replaying the same charge does not create a second row.

## Notes / scope guards
- No changes to refund handling (already idempotent via `refund_recovery.stripe_refund_id`).
- No changes to subscription/weekly billing logic.
- Historical data corrections are done only after you approve the reconciliation diff — nothing is deleted sight-unseen.

## Technical details
- Migration adds 4 nullable text columns + 1 partial unique index on `payments`; `service_role` already has access (admin/webhook writes via service role).
- Webhook: the charge object is already fetched today for the name-match step (`pi.latest_charge`), so capturing `charge.id` and `charge.amount` there is a small extension, not a new Stripe round-trip.
- Reconciliation function lives in a new `*.functions.ts`, guarded by `requireSupabaseAuth` + `has_role(admin)`, and loads `supabaseAdmin` inside the handler.
