# Give Christian full Violations access (including renter matching)

## What I found

Christian's account (christiancamautorentals@gmail.com, last signed in Aug 31) already carries the highest access level, so a plain "he needs admin" change would be a no-op. The blocking is somewhere more specific, and the current rules do have a real gap:

- Violation records, rentals, and renter records can only be read and changed by the top-level admin (and partly by runner). A staff-level account sees empty or failing lists on the Violations pages.
- The matcher diagnostics panel on the bulk upload page is hard-locked to admin only.
- The message he described ("permission needed to match") is not text this app writes, so it is coming straight from the database rejecting a read or write. I need the exact wording and the screen to pin the row it was refused on.

## Plan

1. Confirm the account he actually signs in with, and capture the exact on-screen message plus the failing action (bulk upload → Manual Match). If he is signed into a second, lower-level account, correcting that alone may resolve it.
2. Add a shared "violations staff" permission so violations work is no longer tied to the single top-level admin. Everyone with that permission can:
   - view, upload, and edit violations and uploaded batches
   - match and re-match violations to renters and rentals, including manual match and re-scan
   - read the rentals and renter records needed for matching
   - generate and download dispute/transfer packets and mark violations disputed
3. Grant that permission to Christian, keeping his existing access unchanged.
4. Open the matcher diagnostics panel to violations staff instead of admin-only.
5. Re-test the exact flow he hit: upload a PDF, open Manual Match, pick a renter, save, and confirm the match sticks.

## Technical notes

- Add a `has_violations_access(uuid)` security-definer helper (admin OR the new capability) and use it in row-level policies on `violations`, `violation_matches`, `violation_status_history`, `ezpass_batches`, `ezpass_batch_items`, `dispute_packets`, plus read policies on `rentals`, `legacy_rentals`, and `drivers`.
- Grant the matching table privileges to `authenticated` where missing.
- Replace the `_role: "admin"` check in `debugEzpassMatch` (src/lib/ezpass.functions.ts) with the new helper.
- Server functions for matching already run with the admin client, so the fix targets the read paths and role gates, not the write path.
