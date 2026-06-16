## Goal

When you share a rental link from a vehicle's fleet card, the client should go through the **same end-to-end process as a normal new reservation** — including the payment/deposit step — instead of stopping after signing. The link stays auto-generated for that specific vehicle; you (admin) still set the rate, billing type (daily/weekly), dates, and now an optional deposit before sending.

## What happens today vs. desired

Today (fleet card → `/rent/$token`):
1. Admin picks start date, billing period (daily/weekly/monthly), rate → generates link for that vehicle.
2. Client fills details, uploads license + selfie, signs the agreement.
3. A pending rental is created and an acknowledgement text is sent — **no payment is collected; staff handles it manually.**

Desired: identical to the normal new-reservation flow, where after signing the client is sent to a secure Stripe payment page for the first charge (+ deposit), and the reservation activates automatically once paid.

## Changes

### 1. Admin share dialog — add deposit input
In `ShareRentalDialog.tsx`, add an optional **Deposit ($)** field next to Rate (defaulting to the same `300` used by the new-reservation flow). Keep everything else (start date, daily/weekly, rate) as-is. This is the only new admin input; "type" already maps to the existing daily/weekly selector.

### 2. Store deposit on the share link
Add a `deposit` column to the `rental_share_links` table (migration) and persist it in `createShareLink`. Surface it through the existing public lookup so the client page knows the deposit amount.

### 3. Collect payment after signing (the core change)
In `submitShareApplication` (`share-rental.functions.ts`), after the rental + driver are created and the link is marked consumed, create a **first-payment Stripe link** for `rate + deposit` using the existing `sendPaymentLinkInternal` helper (the same machinery the normal reservation flow uses), tied to the new `rentalId`. Return the payment URL to the client.

- Payment environment is determined server-side (live when the live key is present, otherwise sandbox).
- The Stripe link redirects to the existing `/rent/paid?session_id=...&rental_id=...` page, and the existing payment webhook activates the reservation — exactly like a normal reservation. No new payment plumbing is invented.

### 4. Client page — send them to payment instead of "we'll be in touch"
In `/rent/$token`, when `submitShareApplication` returns a payment URL, redirect the client to it (and also keep the SMS/email payment link as a fallback). The final "thank you" state then reflects "complete your payment" rather than "staff will contact you," matching the normal flow.

## Notes / technical details

- Reuses `sendPaymentLinkInternal` from `payment-link.functions.ts`, `/rent/paid`, and the existing Stripe webhook — so activation, payment logging, and cardholder verification all behave the same as a standard reservation.
- The rental is still created as `pending` and only activates on successful payment, preserving the 24h-hold semantics.
- One migration adds `rental_share_links.deposit numeric default 0`; the public RPC `get_share_link_public` is updated to return it.
- No change to how the link is generated per-vehicle — it remains auto-scoped to the fleet card's vehicle.

## Open question (non-blocking)
If you'd rather the deposit always be a fixed amount (e.g. $300) with no per-link input, I can skip the deposit field and just hardcode it — but the plan above lets you set it per reservation, consistent with the new-reservation dialog.