# Cardholder License Verification on Name Mismatch

## Findings recap
- Auto-refund was app-code only (`decideNameMatch` → `"refund"` → `stripe.refunds.create` in the webhook). It is **already disabled**; mismatches now route to admin review with the payment kept, plus an SMS to 267-221-3977.
- Reusable assets already exist: `PhotoCapture` UI, license OCR, `rental-signing` storage bucket, third-party-payer columns, and the `PendingPaymentReviews` dashboard.
- Mismatch is detected post-payment in the Stripe webhook, so the verification UI must live on the post-payment return page, not a live in-payment modal.

## Part 1 — Database (migration)
Add to `rentals`:
- `cardholder_phone` text
- `cardholder_relationship` text
- `cardholder_license_url` text
- `cardholder_verified_at` timestamptz
- `name_mismatch_flag` boolean default false
- keep existing `verification_status` text (values used: `pending` | `submitted` | `refused` | `verified` | `refunded`)

No new table; `cardholder_name`, `name_match_status`, `name_match_score` already exist. GRANTs already exist on `rentals`.

## Part 2 — Webhook (mismatch detection + flagging)
In `src/routes/api/public/payments/webhook.ts` (rental + extension paths), when `decision.alert` is true:
- Set `name_mismatch_flag = true` and `verification_status = 'pending'` on the rental (in addition to existing `name_match_status`).
- Keep the existing admin SMS, but extend it to include `Verification: pending` (matches Part 4 format).
- Remove the now-dead `action === "refund"` branches to eliminate confusion (no behavior change).

## Part 3 — Cardholder verification flow (payer-facing)
- New server functions in `src/lib/cardholder-verification.functions.ts`:
  - `getCardholderVerificationState({ rentalId })` — public, returns `{ needed, cardholderName, renterName, status }` so the return page knows whether to prompt.
  - `submitCardholderVerification({ rentalId, phone, relationship, licenseDataUrl, acks })` — uploads license to `rental-signing`, saves `cardholder_phone`, `cardholder_relationship`, `cardholder_license_url`, `cardholder_verified_at`, sets `verification_status='submitted'`, then sends the admin SMS/email with `Verification: submitted`.
  - `refuseCardholderVerification({ rentalId })` — sets `verification_status='refused'`, fires HIGH RISK admin alert.
- Update `/rent/paid` (`src/routes/rent.paid.tsx`): after success, query verification state; if `needed`, render the **Card Verification Required** form (cardholder name auto-filled, phone, relationship dropdown [Parent|Spouse|Friend|Employer|Self|Other], `PhotoCapture` license upload, 3 required acknowledgement checkboxes, Submit). On skip/close → call refuse. Show confirmation on submit. Payment is never affected.

## Part 4 — Admin alerts
- SMS to 267-221-3977 in the exact requested format including `Verification: [submitted|pending|refused]`.
- Email to admin (via existing `notifyRenter`/GHL email path) with rental details, cardholder info, license link, and risk level (refused = HIGH). Admin email/target: reuse existing notification config; if none, send via GHL to a configured admin contact.

## Part 5 — Persisted on rental
All cardholder fields written to the `rentals` row (Part 1 columns) — permanent.

## Part 6 — Admin review dashboard (Payments page)
Enhance the existing "Payments Needing Review" section:
- Columns: Renter | Cardholder | Amount | Rental | Verification status badge (Verified/Pending/Refused/Submitted).
- Actions: View License (signed URL), View Details, Mark Reviewed (→ `verified`), Process Refund (manual, existing `resolveNameReview` refund path).
- Filters: All | Pending Review | Verified | Refunded.

## Part 7 — Rental detail page
On `src/routes/rentals.tsx` / `my-rentals.$rentalId.tsx` detail, when `name_mismatch_flag = true`, show a **Card Verification** section: cardholder name, relationship, phone, license thumbnail (click to enlarge), verified date, status.

## Part 9/10 — Verification & success criteria
Manually walk the Joe/Sarah Smith scenario against preview; confirm: mismatch flagged, modal on return page, license upload + acks required, payment unaffected, admin SMS with status, dashboard + rental detail show data, refused = high-risk alert.

## Technical notes
- License images stay in the private `rental-signing` bucket; surface via short-lived signed URLs from a server function (never public).
- Admin SMS uses `sendSms` from `@/lib/ghl.server`; email uses the existing notify path.
- Input validation with zod on all new server functions (phone, relationship enum, data-URL image, required acks).
