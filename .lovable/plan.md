## Goal

On a reservation, let staff request a card on file two ways from one button:
1. **Enter card manually** — the existing secure Stripe form (unchanged).
2. **Send card link to renter** — text (and optionally email) the customer a secure link where they add their own card. The message clearly states it is **not a charge**, just a card on file to hold the reservation.

No money is ever moved by this flow — it uses a Stripe SetupIntent (save card only), exactly like the current manual "Add/Update Card" flow.

## What changes for you

The **Add/Update Card** button on each reservation card (Rentals page) becomes a small dropdown:
- **Enter card manually** → opens the current card form.
- **Text card link to renter** → sends an SMS with the secure add-card link.
- **Email card link to renter** → emails the same link (only if an email is on file).

The renter opens the link on their phone, sees copy like *"Camauto Rentals just needs a card on file to hold your reservation — this is not a charge,"* enters their card, and it saves straight onto their profile. Once saved, the reservation card shows the card on file just as it does today.

## How it works (technical)

**1. New storage — `card_requests` table (migration)**
Columns: `id`, `token` (unique), `driver_id`, `rental_id`, `status` (`pending` / `completed` / `expired`), `created_at`, `expires_at`, `completed_at`. RLS enabled; no anon/authenticated policies needed because the public page is served through service-role server functions. Include GRANTs (`authenticated` for staff reads if surfaced later, `service_role` all).

**2. New server functions — `src/lib/card-request.functions.ts`**
- `sendCardRequest` (auth, `requireSupabaseAuth`): looks up the rental's driver, mints a token, inserts a `card_requests` row (e.g. 7-day expiry), builds `/add-card/<token>` on the public origin, and sends via `notifyRenter` (SMS + branded email) with the "not a charge / card on file to hold" copy. Supports `sendSms` / `sendEmail` flags.
- `getCardRequestByToken` (public, no auth): resolves the token via `supabaseAdmin`; returns `{ found, expired, status, renterName }`.
- `createCardRequestSetupIntent` (public, no auth): mirrors `createDriverSetupIntent` but keyed by token — ensures the driver's Stripe customer exists and returns a SetupIntent `clientSecret`.
- `saveCardRequestCard` (public, no auth): mirrors `saveDriverCard` — attaches the payment method, saves `card_last4`/`brand`/`exp` onto the driver, and marks the `card_requests` row `completed`.

These reuse the existing Stripe helpers (`createStripeClient`) and the same driver card columns the manual flow already writes, so the saved card appears identically on the reservation card.

**3. New public page — `src/routes/add-card.$token.tsx`**
Token-based, no login. Mirrors the structure of `verify-card.$token.tsx`: branded header, loading/invalid/expired/completed states, and a Stripe `Elements` + `PaymentElement` form (reusing the `CardForm` pattern from `AddCardDialog`). Prominent reassurance text that this is **not a charge**, only a card on file to hold the reservation. On success shows a "Card saved — you're all set" confirmation.

**4. Rentals page — `src/routes/rentals.tsx`**
Replace the two `Add/Update Card` buttons (card-on-file present and absent branches) with a `DropdownMenu` (pattern already used for "Send agreement") offering **Enter card manually**, **Text card link to renter**, and **Email card link to renter**. The manual item keeps `setAddCardRental(r)`; the send items call `sendCardRequest` with `getPublicAppOrigin()` and toast success/failure. `AddCardDialog` stays as-is.

## Out of scope
- No automatic charging or holds are placed — this only saves a card. (Actual authorization holds would be a separate request.)
