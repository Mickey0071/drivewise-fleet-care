## What you want

In the Share Rental dialog, after generating a link: type the customer's phone number, click **Send**, and Lovable sends the SMS to them via GoHighLevel — no opening of your phone's Messages app, no manual sending.

## Good news

GHL is already fully wired up in the project:
- Secrets `GHL_PIT_TOKEN` and `GHL_LOCATION_ID` are configured
- `src/lib/ghl.server.ts` already has a `sendSms(phone, message, name)` helper that creates the contact in GHL and sends the SMS through the Conversations API
- `src/lib/share-rental.functions.ts` still has `sendShareLinkSms` — the server function that takes `{ token, url, phone, name }` and calls `sendSms` with a pre-written message: *"Camauto Rentals: You're invited to rent a vehicle. Complete your application (license + selfie + signature) here: {url}"*

I just need to re-wire the UI button to call it. (My last change replaced this with the native `sms:` link, which is what you don't want.)

## Plan

**Edit `src/components/app/ShareRentalDialog.tsx`** (1 file, frontend only):

1. Re-import `sendShareLinkSms` and wire it through `useServerFn`
2. Change the "Text to customer" section back to a clean form:
   - Phone number input (required)
   - **Send link** button
3. On click:
   - Validate phone is filled
   - Show a spinner while sending
   - Call the GHL server function with `{ token, url, phone, name }`
   - On success: green toast "Sent to {phone}"
   - On error: red toast with the GHL error message
4. Keep the existing **email** section as-is (opens mail client — unchanged)

## What this gives you

- You generate a link in the dialog
- Type the customer's phone number (e.g. +15558675309)
- Click **Send link**
- ~1 second later: the customer receives an SMS from your GHL-connected number with the link
- The contact is auto-created/updated in your GHL location with their name + phone
- No phone needed on your end, works from desktop and mobile

## Risk / cost

- Frontend-only edit, 1 file. Smallest possible build.
- GHL costs apply per SMS sent (your existing GHL plan)
- If GHL is misconfigured or out of credits, the toast will show the exact error so you know

## To go live

After approval: I make the edit → you click **Publish → Update**.
