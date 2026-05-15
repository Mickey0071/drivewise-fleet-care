## Goal

From the dashboard, generate a unique share link for any **available** vehicle, send it to a prospective renter via SMS or email (or copy/paste), and let that renter open the link, fill out their info, upload their ID + selfie, sign, and complete the rental — all without an account.

## User flow

1. Admin opens **Fleet** (or vehicle detail page).
2. On any vehicle with status = `available`, click **"Share rental link"**.
3. Dialog shows:
   - Optional rental terms (start date, billing period, rate — pre-filled from vehicle).
   - Generated public URL (`/rent/<token>`).
   - Buttons: **Copy link**, **Send SMS** (phone input), **Send Email** (email input).
4. Customer opens the link on their phone:
   - Sees vehicle photo, make/model, daily/weekly rate, start date.
   - Form: full name, phone, email, license number + expiry, rideshare platform.
   - Upload driver's license photo + selfie.
   - Sign rental agreement (existing SignaturePad).
   - Submit → creates `driver` + `rental` records, marks vehicle `rented`, signature stored.
5. Admin sees the new rental appear in the rentals list (status = signed, payment pending).

## Implementation

### Database (1 migration)

Add a new table `rental_share_links`:
- `token` (text, primary key, ~32 random chars, indexed)
- `vehicle_id` (text, fk-style to vehicles.id)
- `start_date`, `billing_period`, `rate`, `weekly_rate` (snapshot of terms)
- `created_at`, `expires_at` (default now() + 14 days)
- `consumed_rental_id` (text, nullable — set when customer completes)
- `created_by` (uuid, nullable)
- RLS: authenticated users read/write; **anon SELECT allowed** (for public link page) but limited to non-PII fields via a SECURITY DEFINER function.

### Server functions (`src/lib/share-rental.functions.ts`)

- `createShareLink({ vehicleId, startDate, billingPeriod, rate })` — auth required, inserts row, returns `{ token, url }`.
- `sendShareLinkSms({ token, phone, name? })` — auth required, builds message, calls existing `sendSms` helper from `ghl.server.ts`.
- `sendShareLinkEmail({ token, email, name? })` — auth required, sends via Lovable Email infra (scaffold if not yet present) OR fall back to a `mailto:` link if email infra is not configured. **Decision below.**
- `getShareLinkPublic({ token })` — **no auth**, returns vehicle photo/make/model/rate/start date/billing period only (no admin data).
- `submitShareApplication({ token, fullName, phone, email, licenseNumber, licenseExpiry, rideshare, licenseDataUrl, selfieDataUrl, signatureDataUrl, signedBy })` — no auth; uploads images to `rental-signing` bucket; inserts driver, rental (signed + reservation_status `confirmed`), updates vehicle to `rented`, marks share link consumed.

### UI

- **`src/components/app/ShareRentalDialog.tsx`** — new. Triggered from Fleet card (only when `status === "available"`) and Vehicle detail page header. Shows form, link, copy button, SMS field + send, email field + send.
- **`src/routes/fleet.tsx`** — add a small "Share" button in each available vehicle card (stop-propagation so it doesn't navigate to detail). Wire to dialog.
- **`src/routes/fleet.$vehicleId.tsx`** — add "Share rental link" button in the header for available vehicles.
- **`src/routes/rent.$token.tsx`** — new public page. Loads `getShareLinkPublic`, renders branded application form + ID upload + selfie + signature, submits via `submitShareApplication`. Mirrors style of `sign.$token.tsx`.

### Email delivery

The project already has GHL SMS wired up but no email infrastructure. Two options:

- **(A) Use Lovable Email** — proper transactional email via verified domain. Requires running email domain setup + `setup_email_infra` + `scaffold_transactional_email`. Best long-term; takes a few extra setup steps from you (DNS records).
- **(B) `mailto:` only** — the dialog opens the admin's mail client pre-filled with the link. Zero setup, works immediately. Limitation: sends from your personal mailbox, no tracking.

**Recommendation: start with (B) `mailto:` for email, full SMS via existing GHL integration.** I'll add (A) later if you want branded emails. SMS is the more useful channel for this anyway.

## Out of scope (this round)

- Payment collection on the public page (rental is created with `payment_received = false`; admin records payment after).
- Link revocation UI (links auto-expire after 14 days; can add revoke later).
- Per-link expiration customization.

## Open question

Confirm the email approach: **mailto for now (fast), or set up Lovable Email (branded, ~10 min DNS step)?** I'll default to mailto if you don't specify.
