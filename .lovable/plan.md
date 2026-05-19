
# Diagnostic: Signature → Payment Link Flow

This is a read-only diagnosis. Nothing is being changed. Findings for each numbered item:

---

## 1) Signature flow

**Route:** `src/routes/sign.$token.tsx` serves `/sign/$token`. The customer:
1. Loads `getRentalForSigning({ token })` → fetches rental + vehicle + driver.
2. Step 1: uploads driver's-license photo + selfie.
3. Step 2: reads the `<RentalAgreement />` component, types full name, signs with `<SignaturePad />`, clicks **Submit & complete reservation**.
4. Client calls `submitSigningPackage({ token, signatureDataUrl, licenseDataUrl, selfieDataUrl, signedBy })`.

**Server handler:** `src/lib/sign.functions.ts → submitSigningPackage` (lines 184–275).

Fields written to `rentals` on submit:
- `client_signature_url` (storage path of uploaded signature PNG)
- `signature_data_url` (same URL — duplicated for legacy compatibility)
- `license_image_url`
- `selfie_image_url`
- `client_signed_at` = now
- `signed_at` = now
- `signed_by` = typed name
- `agreement_version` = `"v1.0"`
- `reservation_status` → `"active"` **only if** the rental was `pending` AND `payment_received = true`. Otherwise stays `pending`.

Side effects:
- `drivers.insurance_on_file` set to `true`.
- SMS sent to renter (line 263–268):

  > "Thank you for choosing Camauto. Your signed agreement and ID have been received."

- **No payment link is sent here.** The code comment at line 255 explicitly states: *"After signing: send a plain thank-you. No automatic payment link — staff handles payment manually."*
- Idempotent: if `client_signature_url` already set, returns early with `{ alreadySigned: true }` and skips upload + SMS.

---

## 2) Payment link generation

**Only one generator:** `src/lib/payment-link.functions.ts → sendPaymentLink` (createServerFn, auth-required).

How it works:
1. Validates `phone`, `amountCents (≥ 50)`, `description`, `environment ("sandbox"|"live")`, optional `rentalId`, `paymentId`.
2. Resolves origin from `Origin`/`Referer` header (fallback `PUBLIC_APP_ORIGIN` secret).
3. **Dynamically creates a fresh Stripe Product + Price + Payment Link per call** via `stripe.paymentLinks.create(...)`. No hardcoded URL, no config-stored link.
4. Metadata `{ kind: "first_payment" | "payment_link", rental_id, payment_id }` is set on the Link AND on `payment_intent_data.metadata` so the webhook can find the rental on completion.
5. `after_completion.redirect.url` → `{origin}/rent/paid?session_id={CHECKOUT_SESSION_ID}&rental_id=…`.
6. `restrictions.completed_sessions.limit = 1` — one-time use.
7. Sends SMS via GHL with body:

   > `Rentalprise Auto: $X.XX due. Pay: https://buy.stripe.com/…`

**Triggers (callers) — all manual button clicks:**
- `src/routes/rentals.tsx` line 285 — staff clicks the **"Send Payment Link"** button on a rental row (only when `!paymentReceived`).
- `src/routes/payments.tsx` line 40 — staff sends a payment link from the Payments page.

There is **no scheduled job, webhook, or post-signature hook** that calls `sendPaymentLink`. Generation is 100% manual today.

---

## 3) Customer-facing SMS templates

All SMS go through `src/lib/ghl.server.ts → sendSms()` (GHL/LeadConnector API, `+1` E.164 normalization, 12s timeout). All call sites:

| Location | Recipient | Body |
|---|---|---|
| `share-rental.functions.ts:125` (`sendShareLinkSms`) | Customer | "Camauto Rentals: You're invited to rent a vehicle. Complete your application … {url}" |
| `share-rental.functions.ts:412` (after share-flow submit) | Customer | "Thank you for choosing Camauto, {first}! Your application has been received. We'll be in touch shortly to confirm pickup." |
| `share-rental.functions.ts:430` | Admin who made the share link | "Camauto Rentals: New rental application received from {name} ({phone}) for vehicle {id}. Rental {rentalId}." |
| `sign.functions.ts:78` (`sendSigningLink`) | Customer | "Camauto Rentals: Please complete your rental agreement online and upload your driver's license + selfie here: {origin}/sign/{token}. You do not need to come in to sign." |
| `sign.functions.ts:264` (post-signature) | Customer | "Thank you for choosing Camauto. Your signed agreement and ID have been received." |
| `payment-link.functions.ts:117` (`sendPaymentLink`) | Customer | "Rentalprise Auto: $X.XX due. Pay: {stripe url}" ← **only SMS containing a payment link** |
| `rental-sms.functions.ts:14` (`sendRentalSms`) | Customer (generic) | Caller-supplied body. Used by `rentals.tsx` for damage alerts, return confirmation ("Your vehicle return has been confirmed. Thanks for renting with Camauto!"), extension confirmations, and swap confirmations. |
| `renter-chat.functions.ts:24` | Customer | Free-form staff reply in the renter chat thread. |
| `vehicle-photo-share.functions.ts:28` | Customer | Vehicle photo gallery share link. |
| `api/public/payments/webhook.ts:111` | Customer (driver profile) | "Rentalprise Auto: Payment received ($X.XX). Your rental is now active — see you at pickup!" |
| `api/public/payments/webhook.ts:152` | Customer | "Rentalprise Auto: Your rental subscription is active ($X.XX). Welcome aboard!" |
| `api/public/payments/webhook.ts:191` | Customer | "Rentalprise Auto: Your subscription has been canceled. You'll retain access until {date}." |
| `api/public/hooks/send-reminders.ts:129` | Customer | Templated payment-due reminder (cron-driven). |
| `inspection.functions.ts:43,176` | Runner / summary phone | Runner-facing — not customer. |
| `tasks.functions.ts:122,232` | Runner | Runner-facing — not customer. |

Only `payment-link.functions.ts` currently injects a payment link into a customer SMS.

---

## 4) Customer-facing email

**There is no email infrastructure in the project.** No SMTP, Resend, SendGrid, Postmark, or `nodemailer` is imported anywhere.

`ShareRentalDialog.tsx` has a `handleSendEmail` helper, but it only opens the user's local mail client via `mailto:` — it doesn't send through any server.

Sign + payment flows are SMS-only today.

---

## 5) Rentals table — full column list

```
id                       text
vehicle_id               text
driver_id                text
start_date               date
end_date                 date
weekly_rate              numeric
deposit_paid             numeric
payment_status           text
notes                    text
billing_period           text
rate                     numeric
signature_data_url       text           ← legacy signature URL
signed_at                timestamptz
signed_by                text
agreement_version        text
reservation_status       text           ← "pending" | "active" | …
pending_created_at       timestamptz
payment_received         boolean        ← flipped by Stripe webhook
created_at               timestamptz
updated_at               timestamptz
sign_token               text           ← /sign/$token gate
client_signature_url     text           ← canonical signature URL
client_signed_at         timestamptz
license_image_url        text
selfie_image_url         text
billing_cadence          text           ← "daily" | "weekly"
rate_amount              numeric
auto_renew               boolean
current_period_end       date
returned_at              timestamptz    ← (added earlier today, all NULL)
return_inspection_id     text
mileage_out              integer
mileage_in               integer
final_charge_amount      numeric
final_charge_breakdown   jsonb
```

Signature-related: `sign_token`, `signature_data_url`, `client_signature_url`, `client_signed_at`, `signed_at`, `signed_by`, `agreement_version`, `license_image_url`, `selfie_image_url`.

Payment-related: `payment_received`, `payment_status`, `deposit_paid`, `rate`, `rate_amount`, `weekly_rate`, `billing_period`, `billing_cadence`, `current_period_end`, `auto_renew`.

There is **no** column linking a rental to a generated Stripe Payment Link (no `payment_link_url`, no `payment_link_id`, no `payment_link_sent_at`). Each click of "Send Payment Link" mints a new Stripe Product/Price/Link with no record kept on the rental row.

---

## 6) Stripe integration — fully wired

**Secrets present:**
- `STRIPE_SANDBOX_API_KEY`
- `STRIPE_LIVE_API_KEY`
- `PAYMENTS_SANDBOX_WEBHOOK_SECRET`
- `PAYMENTS_LIVE_WEBHOOK_SECRET`
- `LOVABLE_API_KEY` (for the connector gateway)
- `PUBLIC_APP_ORIGIN`

**Client utility:** `src/lib/stripe.server.ts`
- `createStripeClient(env)` — Stripe SDK pointed at Lovable's connector-gateway proxy (`connector-gateway.lovable.dev/stripe`) with API version `2026-03-25.dahlia`.
- `verifyWebhook(req, env)` — manual HMAC-SHA256 verification with 5-minute timestamp tolerance and rotation-safe multi-`v1` matching.

**Browser-side:** `src/lib/stripe.ts` — exposes `getStripe()` (loadStripe) and `getStripeEnvironment()` derived from `VITE_PAYMENTS_CLIENT_TOKEN` (`pk_test_` ⇒ sandbox).

**Webhook handler:** `src/routes/api/public/payments/webhook.ts` → `POST /api/public/payments/webhook?env=sandbox|live`. Handles:
- `checkout.session.completed` (lines 29–118) — when `session.metadata.rental_id` is present and `kind ≠ subscription`:
  - Inserts a `subscriptions` ledger row.
  - Updates `rentals.payment_received = true`, `reservation_status = 'active'`, clears `pending_created_at`.
  - Sets `vehicles.status = 'rented'`.
  - Upserts a paid `payments` row for the first period and inserts the next scheduled payment.
  - SMS receipt to the driver profile.
- `customer.subscription.created` / `.updated` / `.deleted` — upserts the `subscriptions` row, sends activation/cancellation SMS.

So **Stripe round-trip is complete**: link → checkout → webhook → rental flipped active → driver gets receipt SMS.

---

## Summary of the gap

Today, the only thing connecting "signature received" to "payment link sent" is a **human clicking the "Send Payment Link" button** on the Rentals page. After `submitSigningPackage` runs, the renter receives a plain thank-you SMS and the reservation stays `pending` until either (a) staff manually generates a payment link via `sendPaymentLink` and the renter pays, or (b) `payment_received` is already true (e.g. deposit collected another way) — in which case the reservation flips to `active` at signing.

There is no automation, scheduled job, or event hook bridging step 3 → step 4. That bridge is the natural place for new automation, and `sendPaymentLink` already does the heavy lifting (Stripe Link creation + SMS + metadata for the existing webhook).

When you're ready, tell me how you want the bridge to behave (auto-send on signature? on a delay? only for certain rentals?) and I'll write an implementation plan.
