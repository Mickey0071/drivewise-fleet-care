## Goal
Give admins a log of every share-link SMS attempt — phone, status (sent / failed), failure reason, and timestamp — so they can debug delivery issues like the recent "invalid token" error.

## Database
Create a new table `share_link_sms_log`:
- `id` uuid pk
- `token` text (the share link token attempted)
- `vehicle_id` text (nullable, looked up from share link)
- `phone` text (the destination phone)
- `recipient_name` text (nullable)
- `status` text — `'sent'` or `'failed'`
- `error_message` text (nullable; populated on failure)
- `attempted_by` uuid (auth.uid() of admin)
- `created_at` timestamptz default now()

RLS:
- Admins read all rows (`has_role(auth.uid(), 'admin')`).
- Service role / authenticated insert (server fn uses admin client, so simple authenticated-insert policy is fine).
- No update/delete policies (immutable log).

## Server changes
`src/lib/share-rental.functions.ts`:
- In `sendShareLinkSms.handler`, wrap the `sendSms` call so we always insert one row into `share_link_sms_log` — `status='sent'` on success, `status='failed'` with the raw error message on failure. Use `supabaseAdmin` for the insert so logging never fails due to RLS.
- Add `requireSupabaseAuth` middleware to `sendShareLinkSms` (currently missing) so we can record `attempted_by = context.userId`.

Also fix the underlying bug noticed earlier: replace the weak `genToken()` (which can produce <8-char tokens) with `crypto.getRandomValues` → 32-char hex. This stops the spurious "invalid token" failures from being logged.

## UI
New route `src/routes/sms-log.tsx` — admin-only page:
- Header: "Share link SMS log".
- Table columns: Sent at, Phone, Recipient, Vehicle, Status badge, Error (truncated, hover for full), Token (last 6 chars).
- Filter buttons: All / Sent / Failed.
- Loads via a new server fn `getShareLinkSmsLog` (uses `supabaseAdmin`, gated by `requireSupabaseAuth` + admin role check).
- Add nav entry in `src/components/app/AppSidebar.tsx` under the admin section ("SMS log").

## Files touched
- `supabase/migrations/<new>.sql` — table + RLS.
- `src/lib/share-rental.functions.ts` — log on send, fix `genToken`, add auth middleware, add `getShareLinkSmsLog` server fn.
- `src/routes/sms-log.tsx` — new admin page.
- `src/components/app/AppSidebar.tsx` — new nav link.

## Out of scope
- No log for the acknowledgment / admin-notify SMS inside `submitShareApplication` (can add later if needed).
- No re-send button on the log page.
- No retention / cleanup job.