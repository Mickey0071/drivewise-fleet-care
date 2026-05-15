## What's likely wrong

The "Send link" button calls GHL's API, which requires phone numbers in **E.164** format (`+15555551234`). If you type `555-555-1234` or `5555551234`, GHL either rejects the contact upsert or accepts it but never delivers the SMS — the toast shows a raw GHL error like `GHL /contacts/upsert 422: …` which reads as "it isn't sending."

There are also two small UI issues that can swallow the click:
- The phone `<Input>` and the buttons in the dialog don't have `type="button"`, so pressing **Enter** in the phone field can trigger the wrong handler.
- Errors from GHL surface as a long technical string instead of a helpful message.

## Fix

Edit only `src/components/app/ShareRentalDialog.tsx` and `src/lib/share-rental.functions.ts`:

1. **Normalize the phone number on the server** before calling GHL:
   - Strip everything except digits and a leading `+`
   - If the result is 10 digits → prepend `+1` (US default)
   - If 11 digits starting with `1` → prepend `+`
   - If already starts with `+` → keep as-is
   - Otherwise reject with "Enter a valid phone number (e.g. +1 555 555 5555)"
2. **Cleaner error toast** — catch GHL `4xx` responses in `sendShareLinkSms` and re-throw a friendly message ("Could not send SMS — check the phone number and try again."), keeping the technical detail in server logs.
3. **Add `type="button"`** to every `<Button>` inside `ShareRentalDialog` so Enter in the phone field doesn't accidentally re-trigger "Generate link" or close the dialog.
4. **Helper text** under the phone field: "Use full number including country code, e.g. +1 555 555 5555."

No DB changes. No new secrets. After this you should be able to type either `5555551234` or `+1 555 555 5555` and have it actually send.

If the message says it sent successfully but the customer never receives it, that's a GHL account/number-provisioning issue (not a code bug) — I'll point you to where to check next once we confirm the send succeeds.

Approve and I'll ship it.
