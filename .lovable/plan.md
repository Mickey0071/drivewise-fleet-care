## Goal
Remove US country code (+1) references from the phone input in the Share Rental dialog since all customers are US-based.

## Change
In `src/components/app/ShareRentalDialog.tsx`:
1. Change phone input placeholder from `+1 555 555 5555` to `555 555 5555`.
2. Remove or simplify the helper note under the phone input that mentions country codes and 10-digit US numbers.

No server function or SMS logic changes — the phone number is passed through exactly as entered.

## Files
- `src/components/app/ShareRentalDialog.tsx` — text-only edits (placeholder + helper note).

## Out of scope
- No changes to SMS sending logic (`sendShareLinkSms` server function).
- No auto-formatting or auto-prepending of +1.