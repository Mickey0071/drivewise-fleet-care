## Goal

On the Violations page, reservations that show **"⚠️ No Agreement on File"** currently only offer **Send Agreement Link** (texts the renter a link to sign on their own phone). You want to also be able to **create and sign the agreement in office right now**: open an editable agreement, auto-populate everything already on file, fill in the missing pieces, capture a signature on a signature pad, and save it. Once saved, the reservation flips to "Agreement Signed" and the **Create Violation** button becomes available.

These no-agreement rows are the migrated ("Fleet Finesse Migration") reservations, so the new button applies to those.

## What you'll see

For each reservation with no agreement on file, a new green **Create Rental Agreement** button appears next to **Send Agreement Link**.

Clicking it opens a dialog that mirrors the renter signing page, but for in-office use:

- Header showing the customer, vehicle, plate, and rental dates.
- **Your Information** fields (Full Name, DOB, Address, Driver's License #, License State, Phone, Email) — pre-filled with whatever is already on the reservation; you type in the rest.
- The scrollable **Rental Agreement Terms**.
- A **signature pad** the renter signs on your device.
- The four acknowledgement checkboxes.
- A **Save Signed Agreement** button.

On save, the system generates the signed agreement PDF (same template as every other agreement), stores it on the reservation, and — exactly like the texted-link flow — promotes the migrated reservation into a real driver + rental record and links any existing violations to it.

The dialog then closes and the search refreshes: the card now shows **✓ Rental Agreement Signed** with a **Create Violation** button, so you can immediately log the violation.

```text
Nicole Campbell                         [No Agreement on File]
2013 Hyundai Elantra
Rental Period: 5/24/2026 to 5/31/2026
[ Create Rental Agreement ]  [ Send Agreement Link ]
        │
        ▼ (fill + sign in office, Save)
Nicole Campbell                         [✓ Rental Agreement Signed]
2013 Hyundai Elantra
[ Create Violation ]
```

## Technical details

**1. New server function — `signRetroAgreementInOffice`** (in `src/lib/retro-agreement.functions.ts`)
- Admin-authenticated (`.middleware([requireSupabaseAuth])`), keyed by `legacyId` (UUID) instead of a public token.
- Input: `legacyId`, `fullName`, `address`, `licenseNumber`, `dlState`, `dateOfBirth`, `phone`, `email`, `signatureDataUrl`, plus the four `ack` flags.
- Reuses the existing internal helpers: `signatureToJpeg`, `renderRentalAgreementPdf`, and `promoteLegacyRental`. The body is essentially `submitRetroAgreement` with the lookup changed from `.eq("retro_token", token)` to `.eq("id", legacyId)` and no token expiry/clearing logic. It uploads the signature + PDF to the `legacy-agreements` bucket, updates the `legacy_rentals` row (`retro_signed_at`, `retro_signature_url`, `agreement_pdf_url`, captured fields), promotes to real driver/rental, and relinks violations.
- To avoid duplication, extract the shared "build PDF + promote + persist" steps that `submitRetroAgreement` already runs into a small internal helper both functions call.
- Returns `{ ok, promoted, driverId, rentalId, vehicleId }`.

**2. New in-office dialog component** (in `src/components/app/ViolationSearchSection.tsx`)
- A `CreateAgreementModal` modeled on the `sign-agreement-retro` route body, but rendered inside a `Dialog` and calling `signRetroAgreementInOffice` with `legacyId: card.id`.
- Seeds its fields from the `ViolationSearchCard` (`customerName`, `phone`, `email`) and, for the richer fields (address/DL/DOB) not present on the card, leaves them blank for entry. Uses the existing `SignaturePad`, `DEFAULT_SETTINGS`/`renderClauseBody` for terms, and the same acknowledgement checklist.
- On success: toast, close, and re-run the current search (`doSearch()`) so the card refreshes to the agreement-signed state.

**3. Wire the button into the card** (in `ViolationSearchSection.tsx`)
- In the no-agreement branch (currently only `Send Agreement Link`), add a `Create Rental Agreement` button before it that opens the new modal. Add `createAgrFor` state alongside the existing `linkFor`/`createFor` state.

**Notes / scope**
- The new "editable agreement" reuses the existing auto-filled form + signature approach (consistent with every other agreement in the app) rather than a free-form PDF-overlay editor — same auto-populate + fill-the-rest + signature-pad outcome you described.
- No database schema changes are required; this reuses existing `legacy_rentals` columns, storage bucket, and promotion logic.
- Applies to migrated reservations (the rows that show "No Agreement on File"). If you also want this for live rentals that are missing an agreement, that's a small follow-on once this is in.
