# Fix: "Link expired" on rental share links

## Problem
Public rent links (`/rent/$token`) currently expire after **14 days** (DB default on `rental_share_links.expires_at`). Renters who open the link later see "This rental link is invalid or expired" with no recovery path.

## Changes

### 1. Extend default expiry to 60 days
- Migration: alter `public.rental_share_links.expires_at` default from `now() + '14 days'` to `now() + '60 days'`.
- Backfill: bump `expires_at` on existing **unconsumed** links so currently-expired ones become valid again (`expires_at = greatest(expires_at, now() + '60 days')` where `consumed_rental_id IS NULL`).

### 2. Update UI copy
- `src/components/app/ShareRentalDialog.tsx`: change both strings ("expires in 14 days") to "expires in 60 days".

### 3. Allow staff to regenerate an expired link
- Add `regenerateShareLink` server function in `src/lib/share-rental.functions.ts` that:
  - Takes the old token, looks up its vehicle/dates/rate.
  - If `consumed_rental_id IS NOT NULL`, refuse (rental already used).
  - Otherwise update `expires_at = now() + '60 days'` and return the same token (no need to mint a new URL).
- In `ShareRentalDialog`, when a previously-created link is shown, add a small "Extend 60 days" button that calls this fn and toasts confirmation.

## Out of scope
- Per-link custom expiry picker (can add later if needed).
- Auto-notifying the renter when a link is extended.

## Files touched
- `supabase/migrations/<new>.sql` (default + backfill)
- `src/lib/share-rental.functions.ts` (new `regenerateShareLink`)
- `src/components/app/ShareRentalDialog.tsx` (copy + extend button)
