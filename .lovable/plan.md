## Goal

Three connected fixes to the rental renewal flow:

1. **Balance bug** — stop showing a balance for paid-up renters whose rental simply passed its end date.
2. **Auto-renew** — when auto-renew is ON, automatically charge the saved card each period *and* send an accept/decline link; only stop when paused.
3. **Decline** — let the renter decline, which pauses auto-renew and raises an in-dashboard alert that the renter doesn't want to extend.

---

### Why the balance shows $850

The Balance column (`rentalBalance` in `src/routes/rentals.tsx`) currently does this once a rental passes its end date:

```text
if (today > end) return unpaid + extOwed;   // shows ALL unpaid schedule rows as overdue
```

So R-517 (ended May 30) shows the full remaining base schedule as "overdue" even though the renter paid through her period. It's the past-due base rental being surfaced, not a renewal charge.

---

### 1. Balance only when a renewal begins

In `rentalBalance` (`src/routes/rentals.tsx`), change the past-end-date branch so a paid-up renter shows **$0** after the end date, and a balance only appears once an actual extension/renewal exists:

- After the end date, return **only** `unpaidExtensionTotal(r.id)` (extension charges that were created/charged), not the base unpaid schedule.
- Base unpaid within the paid period is unchanged (still billed during the active window).
- `rentalStatus` past-due logic keys off `rentalBalance > 0`, so a paid-up renter past end date will read **On Rent** until a renewal charge is created — matching "balance only if renewal begins."

### 2. Auto-renew: auto-charge saved card + accept/decline link

The pieces already exist: `rentals.auto_renew` flag (with a toggle in the rental dialog), the `auto_extension_offers` table, the `get_auto_extension_offer_public` RPC, the `/api/public/hooks/auto-extension-links` cron, and saved-card fields on `drivers` (`stripe_customer_id`, `stripe_payment_method_id`, `card_last4`).

Rework `src/routes/api/public/hooks/auto-extension-links.ts` so that, per due period:

- **Skip** any rental where `auto_renew = false` (paused) — this is the pause switch.
- Generate the `auto_extension_offer` and **send the accept/decline link** (existing behavior) so the renter is notified.
- If the driver has a saved card, **auto-charge off-session** for the period amount (daily = configured daily rate, weekly = weekly rate) via a Stripe `paymentIntent` (`off_session: true`, `customer` + `payment_method`), routed through `createStripeClient`.
  - On success: record the payment, create the extension (reuse the same logic the payments webhook uses for `kind=admin_extension`), and advance the rental end date.
  - On card failure: leave the link active so the renter can pay manually, and SMS the admin.
- Make the cron re-arm each period instead of firing once: track the last auto-renew period (e.g. `last_auto_renew_date` on `rentals`) instead of the one-shot `extension_link_sent` flag, so it renews every cycle until paused.

This means the renter no longer *needs* to tap the link for the charge to happen — but the link still lets them decline.

### 3. Decline → pause + dashboard alert

- Add a **Decline** button to `src/routes/auto-extend.$token.tsx` alongside the accept/sign/pay flow.
- Add a `declineAutoExtension` server function (`src/lib/auto-extension.functions.ts`) that, given the offer token: sets the offer `status='declined'`, sets the rental `auto_renew=false` (stops further charges/links), records `extension_declined_at`, and SMSes the admin.
- Surface an **alert on the rentals dashboard** (`src/routes/rentals.tsx`): rentals with a recent `extension_declined_at` show a banner / highlighted row ("Renter declined to extend") so staff see it in the dashboard tab.

---

### Technical changes

**Migration** (new file):
- `rentals`: add `last_auto_renew_date date`, `extension_declined_at timestamptz`.
- `auto_extension_offers`: allow `status='declined'` (text column, no enum change needed).

**Files edited:**
- `src/routes/rentals.tsx` — balance branch fix + declined-rental alert in the dashboard.
- `src/routes/api/public/hooks/auto-extension-links.ts` — pause check, per-period re-arm, off-session auto-charge + extension application.
- `src/lib/auto-extension.functions.ts` — new `declineAutoExtension` server fn.
- `src/routes/auto-extend.$token.tsx` — Decline button + confirmation state.
- `src/lib/mock/store.ts` + `src/integrations/supabase/types.ts` — map new rental fields.

**No changes** to the existing payments webhook contract, the manual extension flow, or P&L wiring (auto-renew charges flow through the same payment recording path that already feeds P&L).

---

### Open dependency

Auto-charging requires the renter's card to have been saved during their original checkout (the webhook already saves it via `setup_future_usage`). Renters who paid before card-saving was in place won't have a card on file — for them the cron falls back to sending the accept/decline link only. I'll note this in the UI.