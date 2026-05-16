## Goal

Restructure the public renter sign page (`/sign/$token`) into a two-page flow and clean up the agreement.

## New flow

**Page 1 — Identity verification**
1. Upload driver's license (photo)
2. Take selfie (front camera)
3. "Continue" button — disabled until both photos are captured

**Page 2 — Agreement & signature**
1. Full rental agreement (scrollable preview)
2. Type full legal name
3. Draw signature
4. "Submit & complete reservation" button

Photos captured on page 1 stay in component state and are submitted together with the signature on page 2 (single `submitSigningPackage` call — no backend changes needed).

## Files to change

**`src/routes/sign.$token.tsx`**
- Add `step` state (`"identity" | "agreement"`).
- Render only the license + selfie cards when `step === "identity"`, with a Continue button that advances to `"agreement"` once both `licenseUrl` and `selfieUrl` exist.
- Render the agreement preview + name + signature pad when `step === "agreement"`, with a Back button and the existing Submit button.
- Keep all existing state and the single `submit()` call exactly as-is.

**`src/components/app/RentalAgreement.tsx`**
- Remove the "Vehicle Condition at Pickup" section (the `<SectionLabel>` and the condition table that iterates `settings.conditionRows`).
- Leave everything else (renter info, vehicle info, terms, clauses, signatures) untouched.

## Not changing

- No server function changes (`sign.functions.ts` stays the same).
- No database changes.
- No changes to SMS or agreement-sending flow.
- `agreementSettings.conditionRows` stays in place in case it's used elsewhere later.
