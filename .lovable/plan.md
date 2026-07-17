## Goal

In **Violations → Bulk Upload → Manual Match** dialog, when the admin picks a candidate renter, if that rental has a signed agreement, let them:

1. **Download the signed agreement** immediately (one click)
2. **Match + Create Ticket + Download Dispute Packet** in a single action — commits the ezpass item → real `violations` ticket → returns a ZIP with cover sheet + agreement + license + selfie + receipt + toll photo

## Current state

- Manual match today only stages the row on `ezpass_batch_items` (`manualMatchEzpassItem`); the real `violations` row isn't created until the whole batch is approved via `approveEzpassBatch`.
- `downloadViolationPacket` (in `src/lib/violation-packet.functions.ts`) already builds the full dispute packet ZIP but requires an existing `violations.id`.
- The dialog already shows an `Agreement on file` badge per candidate but has no download or packet action; the top-bar "Generate Dispute Packet" is a "coming soon" stub.

## Changes

### 1. New server fn: `matchAndCommitEzpassItem` in `src/lib/ezpass.functions.ts`

Auth-only. Input: `{ itemId, rentalId }`. Behavior:
- Runs the same match logic as `manualMatchEzpassItem` (updates the batch item)
- Then upserts a single `violations` row for that item (mirroring the per-item logic already in `approveEzpassBatch`: type, plate, amount/fee/total, date_issued, description/notes, driver_id, vehicle_id, rental_id, original doc url from the batch, status = `pending` / `matched` stage)
- Marks the batch item as `committed` (new nullable `committed_violation_id` column already implied by the workflow, or reuse existing `violation_id` field if present — verify at build time and add a small migration only if the column is missing)
- Returns `{ violationId }`

Recompute batch counts afterwards.

### 2. New server fn: `getRentalAgreementUrl` in `src/lib/violations-workflow.functions.ts`

Auth-only. Input `{ rentalId }`. Returns `{ agreementUrl, filename }` from `rentals.agreement_pdf_url` (or the legacy equivalent). Used for the "Download Agreement" quick action so we don't need a full packet build.

### 3. UI changes in `src/routes/violations_.bulk-upload.tsx` — `ManualMatchDialog`

For each candidate card where `r.hasAgreement === true` and it's a Live (non-migration) rental, replace the single **Match** button with a small action cluster:

- **Download Agreement** (outline) — calls `getRentalAgreementUrl` and triggers a browser download
- **Match + Dispute Packet** (primary emerald) — calls `matchAndCommitEzpassItem` → then `downloadViolationPacket({ violationId })` → decodes base64 → triggers ZIP download → toasts "Ticket created + packet downloaded" → closes dialog and calls `onMatched()`
- **Match only** (ghost) — the existing quick-match path (no packet)

Legacy/migrated rentals keep their existing Send/Resend Agreement flow unchanged.

The top-bar "Generate Dispute Packet" stub stays as-is for the pre-selection state (still coming-soon), because a packet requires a chosen rental.

### 4. No changes to

- `approveEzpassBatch` (still commits every remaining un-committed item at batch approval; already-committed items are skipped by checking the new committed flag)
- The existing `manualMatchEzpassItem` (kept for the plain "Match only" path)
- Any renter-facing flows, agreement generation, or dispute recording elsewhere

## Verification

- Open a batch with a matchable toll, click Manual Match, pick a renter that has `Agreement on file`
- Click **Download Agreement** → PDF downloads
- Click **Match + Dispute Packet** → toast, ZIP downloads containing cover sheet + agreement + license + selfie + receipt + toll photo, dialog closes, batch item shows Matched, a new row appears in `violations` linked to that rental, and approving the batch later does not double-create it
