## Goal
Make the "Text to customer" SMS box visible immediately when the Share Rental dialog opens, instead of being hidden until after the link is generated.

## Change
In `src/components/app/ShareRentalDialog.tsx`, restructure the dialog so:

1. **Always visible (top section):** rental details (start date, billing period, rate) + a "Send to customer" panel with name + phone inputs.
2. **Single primary button:** "Generate & send link" — creates the share link, then immediately sends the SMS to the entered phone number in one click. If phone is empty, it just generates the link.
3. **After generation:** show the public URL with Copy button, plus the existing Email panel and a "Resend SMS" button so the user can text it again or to a different number.

This way the user sees the phone input from the moment they open the dialog and doesn't have to do a two-step "generate, then scroll down to text" flow.

## Files
- `src/components/app/ShareRentalDialog.tsx` — reorder JSX, merge generate + sendSms into one handler, keep all existing server function calls (`createShareLink`, `sendShareLinkSms`) and validation unchanged.

## Out of scope
- No DB or server function changes.
- No changes to the signing link (`/sign/$token`) flow.
