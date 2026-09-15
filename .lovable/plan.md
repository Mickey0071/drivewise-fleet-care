# Text alert when a cardholder license is submitted for approval

Right now, when someone uses the verification link you text them and uploads their license, the app records it and it shows up in the dashboard alert box — but no text goes out to your cell. Only the older post-payment flow sends a text, and that text has no link to tap.

## What changes

1. When a license is submitted through a verification link, send a text to 267-221-3977 right away:

```text
APPROVAL NEEDED - Card verification
Renter: John Smith
Cardholder: Mary Smith
License uploaded, waiting on your approval.
Approve: https://camautorentals.lovable.app/rentals?detail=<rental>
```

2. The link opens the rental with the verification box already showing the license photo, cardholder details, and the Mark Reviewed / Process Refund buttons — the same place the dashboard alert takes you.

3. Add the same tappable approval link to the two existing texts (name mismatch submitted, and cardholder refused), so every one of these alerts gets you straight to the approval screen.

4. This approval text is treated as urgent: it goes out even during quiet hours, so an upload at night still reaches you.

5. The dashboard alert box keeps working exactly as it does now — you can still approve entirely in the app without touching the text.

## Technical notes

- `submitVerificationByToken` in `src/lib/cardholder-verification.functions.ts` gains an admin SMS step (renter name via `renterNameFor`, cardholder name from the rental row) plus an `admin_alert_sent` entry in the verification audit trail.
- New helper in the same file builds the approval deep link from `PUBLIC_APP_ORIGIN` (fallback `https://camautorentals.lovable.app`) as `/rentals?detail=<rentalId>` — matching what `VerificationAlertsCard` navigates to.
- Urgent delivery: send via `sendSms` from `@/lib/ghl.server` to the configured admin phone (`admin_phone`, default `267-221-3977`) so quiet hours don't suppress it; the master SMS switch is still respected. Failures are caught and logged, never blocking the cardholder's submission.
- `submitCardholderVerification` and `refuseCardholderVerification` messages get the same approval link appended.
- No schema changes, no UI changes.
