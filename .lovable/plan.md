## Simplified Violations Workflow + CSV Tools

Per your spec: remove the customer affidavit step entirely, rely on the already-signed rental agreement, auto-generate the liability-transfer packet, send the customer an info-only notice, and let the admin print/mail/track. Plus CSV import (Fleet Finesse) and CSV export.

### Part 1 — Remove affidavit flow
- Delete the customer affidavit page `src/routes/violation.$token_.affidavit.tsx`.
- In `violation-resolution.functions.ts`: remove `signViolationAffidavit`, `getAffidavitPdfUrl`, `buildAndStoreAffidavit`, and the `ezpass-affidavit.server` import. Keep `getViolationForCustomer` and `createViolationCustomerPayment` (so "Pay Now" still works if you want it).
- `src/routes/violation.$token.tsx`: drop the "Sign Affidavit (Recommended)" card and the affidavit confirmation copy. Becomes an **informational notice** ("This violation has been transferred to you per N.J.S.A. 39:4-138.1; the authority will contact you directly") with an optional Pay Now button.
- `violations.tsx`: remove the "Signed Affidavit" filter tab, the affidavit timeline row, and affidavit-related UI.
- Delete `src/lib/ezpass-affidavit.server.ts` (and `ezpass.functions.ts` affidavit pieces if unused elsewhere — I'll verify before deleting).

### Part 2 — New processing workflow
- On match (in the bulk-upload review / `createViolation`), auto-call `generateLiabilityTransfer` so the packet PDF exists immediately, set status to `transfer_generated`.
- Customer notification becomes informational only (no pay-or-sign choice, no action link required).
- Admin reviews → Generate Mail Packet → Mark Mailed → Confirm (these already exist in `LiabilityActions`, kept intact).

### Part 3 — Liability transfer packet
- Cover letter already built in `liability-transfer.functions.ts` and matches your statute text. I'll update the "ATTACHED DOCUMENTS" list to drop "Signed affidavit" and the packet builder to stop appending the affidavit PDF.
- Authority selected by `authority_key` (NJ E-ZPass seeded; others editable on /violations/authorities).

### Part 4 — Reminders
- `violation-reminders.ts`: remove pay/sign reminder cadence. Replace with optional informational follow-up only, or disable entirely (your call — see question below).

### Part 5 — CSV import (Fleet Finesse)  ⚠ needs your input
The spec for column mapping was cut off. I need the CSV headers / sample to map fields into `rentals` / `drivers` / `vehicles`. Plan: a new `/violations/bulk-upload` or `/import` tab with file picker → parse client-side → preview table → server fn `importFleetFinesseCsv` that upserts rows.

### Part 6 — CSV export
- Add an "Export CSV" button (reusing `src/lib/exports.ts`) on the violations page and/or rentals page to download current data.

### Questions before I build
1. Keep the customer "Pay Now" option, or make the customer page purely informational (no payment)?
2. Reminders: remove entirely, or keep one informational follow-up?
3. CSV import: please share the Fleet Finesse CSV headers (or a sample row) and which table(s) it should populate (rentals, drivers, vehicles?).
4. CSV export: which dataset(s) — violations, rentals, or both?

### Technical notes
- No DB schema changes required (columns already exist from the prior migration).
- All server logic stays in `*.functions.ts` with `supabaseAdmin` imported in handlers.
- `routeTree.gen.ts` regenerates automatically when routes are added/removed.
