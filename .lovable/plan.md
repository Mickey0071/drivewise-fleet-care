# Fix Balance Calculations — One Canonical Rule

## Canonical rule (to apply everywhere)

```text
Balance due = base_rental(original term only)
            + extensions(signed/accepted only)
            + violations(unpaid)
            − cash_payments_received
```

- Base rental never changes when an extension is added.
- Extensions are separate line items, owed only once **signed/accepted** (not when merely **sent**).

## What I found (root cause)

Balance is **not stored** on a rental — it is computed live in `rentalOwed()` / `unpaidExtensionTotal()` (`src/routes/rentals.tsx`, `src/lib/mock/store.ts`). Two rule violations exist today:

1. **Sent-but-unsigned extensions count as owed.** For active rentals, `rentalOwed` calls `unpaidExtensionTotal(id, { includePending: true })`. Every duplicated "extension link sent" request (status `pending`, never signed) inflates the balance — even when that exact period was already signed AND paid.
2. **Violations are not in the balance at all.** Unpaid violation charges are omitted, so some balances are understated.

There are 26 `pending` (sent-only) extension requests, 1 `signed`, 10 `paid` — the 26 pending ones are the main source of phantom balances. 10 reservations are multi-week (candidates for base-vs-extension splitting / bloated charge rows).

## Verified before/after for the two you asked about

### R-576 — Patricia McIntyre (weekly $400, 6/11→6/18, extended +1wk → 6/25, signed & paid)
- Charges paid: $400 (base) + $200 + $400 (signed extension) = **$1,000 received**
- 4 duplicate **sent-only** extension requests for the already-signed 6/25 period → currently adds a **phantom $400**
- Unpaid violation VIO-NAO5SBY2C = **$218.90** (currently ignored)

| | Current (shown) | Canonical |
|---|---|---|
| Base | 400 | 400 |
| Extensions (signed) | 400 | 400 |
| Violations (unpaid) | 0 | 218.90 |
| Payments received | 1,000 | 1,000 |
| **Balance** | **≈ $400 (phantom)** | **$18.90** |

Reason for change: drop sent-only extension (−$400), add unpaid violation (+$218.90).

### R-533 — Janai Allen (weekly $425, 6/6→6/13, end now 6/20)
- Charges paid: $425 (week 1) + **$525 (6/16 — bloated; weekly rate is $425)** = $950 received
- 2 **sent-only** extension requests for 6/20, **none signed** → currently adds a **phantom $425**
- Unpaid violation VIO-2Y35XQ70X = **$6** (currently ignored)
- The 6/20 second week was consumed and paid, but exists only as an unsigned request — so the strict rule would treat it as not-owed, producing a misleading credit.

| | Current (shown) | Canonical (strict) |
|---|---|---|
| Base (orig term) | 425 | 425 |
| Extensions (signed) | 0 | 0 |
| Violations (unpaid) | 0 | 6 |
| Payments received | 950 | 950 |
| **Balance** | **≈ $425 (phantom)** | **−$519 (credit) ⚠ needs human decision** |

R-533 is exactly why we review one-by-one: the $525 row is bloated (should be $425 + a $100 line, or the 2nd week should be promoted to a **signed/accepted** extension so it legitimately counts). I will surface this as a flagged row, not auto-apply.

## Implementation

### 1. Canonical engine (single source of truth)
Add `src/lib/balance.ts` exporting `computeCanonicalBalance(rentalId)` returning the breakdown `{ base, extensionsSigned, violationsUnpaid, paymentsReceived, balance }`. Rules:
- base = original-term charge only (first period through original end date, before any extension).
- extensions: sum signed/accepted `rental_extensions` (signature present) / `extension_requests` with status `signed`/`paid`; **exclude** `pending`/sent.
- violations: unpaid (`paid_at IS NULL`, not resolved/dismissed).
- payments: sum `paid` receipts.
Point `rentalOwed()` at this engine and **remove the `includePending: true` path** so sent-only extensions never count.

### 2. Balance audit mode on /admin/payment-reconciliation
Extend the existing screen (`src/routes/admin.payment-reconciliation.tsx` + `src/lib/payment-reconciliation.functions.ts`) with a "Balance audit" tab that, per reservation, shows current-derived vs canonical balance, the full breakdown, and a verdict (`ok` / `phantom_extension` / `bloated_base` / `missing_violation` / `needs_split`). Every correction is applied only on click and routed through the existing audited RPCs (`admin_correct_payment_amount`, `admin_delete_payment`) with a required reason → `payment_audit_log`. Splitting a bloated base row = correct the base row to the original-term amount + insert a separate extension line (audited).

### 3. Report-first
Step 1 deliverable is the **read-only report** across all reservations (no writes): table of every reservation whose canonical balance differs, with delta and reason. You review it, then approve each correction one-by-one in the review screen; each writes to the audit log.

## Open decisions (please confirm before I build)
1. **Violations in balance:** include all unpaid violations in the reservation balance (rule as written), or keep violations on their own track? This *raises* some balances (R-576 +$218.90, R-533 +$6).
2. **Paid-but-unsigned extensions (R-533's 2nd week / $525):** promote the consumed+paid week to an accepted extension so it counts (balance stays ~$0), OR apply the strict rule and show the resulting credit for manual refund review? Recommended: promote-to-accepted when a matching payment exists, flag the $100 bloat separately.

## Technical notes
- No stored balance column changes; balance stays derived. Only payment/extension **rows** are corrected, all via audited admin RPCs.
- Data corrections happen exclusively through the reconciliation screen — nothing silent.
