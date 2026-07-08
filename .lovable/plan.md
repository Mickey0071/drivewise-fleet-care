## Goal

Two things, per your instructions:
1. **Clean up Lakeisha's double bill** (rental R-593) and **fix the root cause** so extensions stop leaving a duplicate weekly charge.
2. **Stop all automatic card charges** — a card is only charged when a **Charge Card** button is pushed (by you) or when the renter pays a link themselves. No silent auto-pull out of anyone's account.

## What's actually happening

**The double bill (Lakeisha / R-593):**
- At signing, the system pre-creates upcoming weekly placeholder charges marked "late" (e.g. `PM-R-593-20260706`, due 07-06).
- When an extension is created via the admin extension link, it **pre-applies** the extension: inserts its own `EXTPAY-…` charge for the same 07-06→07-13 week, advances the end date, and logs it.
- The extension flow (and the webhook's "pre-applied" reconcile branch) **never removes the overlapping weekly placeholder**. So the week ends up with two charges — the paid `EXTPAY` and the leftover unpaid `PM-R-593-20260706` "late" row. That leftover is the phantom duplicate.

The webhook already has a `reconcileScheduledDuplicate()` helper that deletes an overlapping unpaid placeholder, but it is skipped on the pre-applied extension path, which is the path these extensions use.

**The auto-pay:**
- `src/routes/api/public/hooks/auto-extension-links.ts` is a cron job that, in addition to texting/emailing the extension link, **charges the saved card off-session automatically** (`off_session: true, confirm: true`). This is the only unattended, no-button charge in the app.
- All other off-session charges are behind explicit buttons: `chargeCardOnFile` (the "Charge Card" button on the reservation card) and `chargeViolation` (admin violation action). Renter link payments are the renter pressing pay. Those all stay.

## Changes

### 1. Data cleanup (one-time)
- Delete the leftover unpaid duplicate `PM-R-593-20260706` (status "late", no Stripe charge) on rental R-593. The real paid extension charge (`EXTPAY-…`) stays.
- Scan for any other rentals with the same pattern (an unpaid "late"/"missed" placeholder that overlaps a paid extension for the same period and amount) and clear those too, so this cleanup isn't just Lakeisha.

### 2. Root-cause fix — extensions clear the overlapping weekly placeholder
- In `src/lib/extension-link.functions.ts` (`createExtensionLink`): after inserting the `EXTPAY` charge and advancing the end date, delete any overlapping **unpaid** scheduled placeholder (status "late"/"missed", no Stripe charge, same amount, due date within the covered period). Same rule the webhook helper already uses.
- In `src/routes/api/public/payments/webhook.ts`: in the **pre-applied extension** branch (where it reconciles `applied_payment_id`/`rental_extension_id` and returns early), also call `reconcileScheduledDuplicate(...)` before returning, so a link-paid pre-applied extension clears the overlap too.

### 3. Turn off automatic charging
- In `src/routes/api/public/hooks/auto-extension-links.ts`: remove the off-session auto-charge block (the `stripe.paymentIntents.create({ off_session: true, confirm: true })` path and the "auto-renewed" success handling). The cron will still send the extension link/reminder so the renter can sign and pay themselves; it will no longer pull money on its own.
- Leave the explicit button paths untouched: `chargeCardOnFile` ("Charge Card" button), `chargeViolation` (admin action), and renter-initiated link/checkout payments.

## Technical notes
- Placeholder cleanup only ever deletes rows with `stripe_charge_id IS NULL` and `paid_date IS NULL`, so no real/paid payment is ever removed.
- No schema changes. Data cleanup runs as a data update; code changes are in the three files above.
- After the change, extensions produce exactly one charge line per period, and cards are charged only on an explicit button press or a renter-completed payment link.
</content>
<parameter name="summary">Clean up Lakeisha's duplicate charge + fix extensions leaving overlapping weekly placeholders, and disable the automatic off-session card charge so cards are only charged via an explicit Charge Card button or renter-paid link.