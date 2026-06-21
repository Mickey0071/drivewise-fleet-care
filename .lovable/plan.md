## Goal
On the extension tab, let staff choose how much to collect via the Stripe link right now ("Amount to collect now"), pre-filled with the full extension charge but editable to any amount > $0. The link uses that amount; the account still records the FULL period charge, so a partial payment naturally leaves the difference as an open balance. Additive change to the extension flow only.

## How the current extension flow works (for reference)
1. `ExtendRentalDialog` (`src/routes/rentals.tsx`) computes the full charge via `computeExtensionCharge` and calls the `createExtensionLink` server function.
2. `createExtensionLink` (`src/lib/extension-link.functions.ts`):
   - Inserts a `payments` charge row (`EXTPAY-…`, amount = full charge, status `late`).
   - Inserts a `rental_extensions` log row (`additional_amount` = full charge).
   - Advances `end_date`.
   - Builds the Stripe Payment Link priced at `amountCents = additionalAmount * 100`.
3. On payment, the webhook (`src/routes/api/public/payments/webhook.ts`, pre-applied block ~L679) flips that `EXTPAY` charge row to `paid` (currently keeping its full amount).
4. Balance is `rentalTimeCharge − rentalPaymentsReceived` (`src/lib/mock/store.ts`). The extension's full period is in `rentalTimeCharge`; `rentalPaymentsReceived` only counts `paid` rows. This formula is NOT touched.

## Changes

### 1. UI — `ExtendRentalDialog` in `src/routes/rentals.tsx`
- Add state `collectAmount` (string). When `charge` recomputes (duration / end date change), reset the field to the full `charge.additionalAmount`.
- Render an editable field **"Amount to collect now"** (only in the `chargeState === "owed"` branch, next to / under the existing "Extension charge" panel). Pre-filled with the full charge.
- Validation:
  - Must parse to a number `> 0`, else block send with a toast.
  - If `< charge.additionalAmount`: show inline note `A balance of $X will remain on this reservation.` (X = full − entered).
  - If `>= charge.additionalAmount`: no warning.
- Pass `collectAmount` (as a number) to `createLinkFn` alongside the existing args.
- Update the confirmation/info copy so it references the collected amount for the link and, when partial, the remaining balance. The "Log & Send Extension Link" button and signature-status chip are unchanged.

### 2. Server — `createExtensionLink` in `src/lib/extension-link.functions.ts`
- Add `collectAmount?: number` to the input validator. Default to the full computed charge when absent; require `> 0` and cap defensively.
- Keep `additionalAmount` (full period charge) exactly as today for: the `payments` charge row, the `rental_extensions` log row, and `extension_requests.additional_amount`.
- Use a new `collectCents = Math.round(collectAmount * 100)` for the Stripe `prices.create` `unit_amount` ONLY (the only behavior change).
- Return both `additionalAmount` (full charge) and the `collectAmount` so the dialog can show the link amount and remaining balance.

### 3. Webhook — pre-applied extension reconciliation in `src/routes/api/public/payments/webhook.ts`
- In the block that marks `extReqRow.applied_payment_id` as `paid` (~L680-692), also set that row's `amount` to the amount actually collected (`amountDollars` from `session.amount_total`) instead of leaving it at the full charge.
- Effect: `rentalPaymentsReceived` counts the collected amount ($200), while `rentalTimeCharge` still includes the full extension period ($450) → balance shows the $250 remainder automatically. For a full-amount collection this is a no-op (collected == full), so existing behavior is preserved.
- No other webhook branch changes; the balance formula is untouched.

## Out of scope (unchanged)
- Balance formula (`rentalTimeCharge`, `rentalPaymentsReceived`, `rentalCanonicalOwed` in `store.ts`).
- Signature flow, return flow, "Already paid" (no-link) extension path, auto-extension, and manual `admin-extensions` recording.

## Verification & report
1. Show the extension tab with the new "Amount to collect now" field and its pre-filled default (Playwright screenshot against the running app).
2. Trace/test a weekly $450 extension with collect = $200: confirm the Stripe price line uses $200, the `rental_extensions`/charge record the $450, a $200 paid payment is recorded on reconciliation, and `rentalCanonicalOwed` = $250. Where live Stripe execution isn't possible in-sandbox, verify by reading the code path and, if needed, a direct DB check of an extension row.
3. Confirm no change to reservations not extended in the test.
4. Confirm the balance-formula code in `store.ts` was not modified.
