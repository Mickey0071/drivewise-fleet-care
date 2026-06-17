## Goal

When an admin inputs an extension on a reservation, it should be **logged immediately** in the extension log and on the reservation card (end date advanced + charge recorded), instead of staying invisible until the renter signs and pays the Stripe link. A per-extension Paid/Unpaid choice controls how the charge hits the balance.

This is exactly what's wrong on **Luther Bunting / R-527**: the "Extend rental" button today only sends a Stripe pay-link and writes nothing to `rental_extensions` until the renter pays — so the card shows no extension even though one was offered.

## What changes

### 1. Apply + log the extension at the moment of input (server)
In `src/lib/extension-link.functions.ts` (`createExtensionLink`), after computing `newEndIso` / `additionalAmount`, immediately:
- Advance `rentals.end_date` to the new end date.
- Insert a `rental_extensions` row now (previous end, new end, periods, period label, amount) so it shows in the log/card instantly.
- Insert a `payments` row for the extension charge:
  - **Unpaid choice** → `status: "late"` (adds to balance as owed; renter pays via the link).
  - **Paid choice** → `status: "paid"` with today's date and method (does not add to balance).
- Link the `extension_requests` row to the new `rental_extension` id and `payment` id (store on the request row) so the webhook can reconcile.

Add a `chargeState: "owed" | "paid"` input to the server fn. When `paid`, skip generating/sending the Stripe link (nothing to pay) and just return the logged result; when `owed`, create and send the Stripe link as today.

### 2. Make the webhook idempotent (no double-apply)
In `src/routes/api/public/payments/webhook.ts`, `admin_extension` branch: if the `extension_requests` row already has a linked `rental_extension_id`/payment (pre-applied by the admin), then on payment **do not** advance the end date again or insert a second `rental_extensions` row. Only:
- Mark the linked extension's payment `paid`.
- Stamp signature / signed_by / paid_at onto the existing `rental_extensions` row and the `extension_requests` row.

This prevents the end date from jumping twice and duplicate log rows.

### 3. UI: Paid/Unpaid choice in the Extend dialog
In `ExtendRentalDialog` (`src/routes/rentals.tsx`):
- Add a Paid / Unpaid toggle ("Renter will pay via link" vs "Already paid").
- Pass `chargeState` to the server fn.
- **Unpaid:** behaves like today (logs the extension immediately, then shows/sends the pay link).
- **Paid:** logs the extension as paid immediately; success message confirms it's recorded, no link.

After either path, the extension appears in the log/card right away because `rental_extensions` is written synchronously.

## Note on Luther Bunting's $900 balance

The high balance is a **separate** issue from the missing extension. R-527 has unpaid scheduled weekly charges (e.g. the $450 due 6/7 still marked `late`, plus another period) that earlier cash/Stripe payments were booked as standalone receipts instead of being allocated against. The extension log is empty simply because no extension was ever recorded (only a link was sent). This plan fixes the extension-logging behavior so future extensions show up. If you also want me to re-allocate R-527's existing payments so the $900 reflects reality, say so and I'll handle that as a follow-up data fix.

## Technical details

- New columns may be needed on `extension_requests` to link the pre-applied records: `rental_extension_id` (text/uuid) and `applied_payment_id` (text). I'll add these via a migration with proper GRANTs before wiring the code.
- `rental_extensions` already supports all needed fields; no schema change there.
- One source of truth: keep the apply/log logic in the server fn (admin flow is server-based); the card picks it up via the existing `rental_extensions` realtime subscription in the store.
</content>
<summary>Make admin "Extend rental" log the extension immediately (advance end date + record charge) with a Paid/Unpaid choice, instead of waiting for the renter to pay the Stripe link; make the webhook idempotent so it doesn't double-apply.</summary>
</invoke>
