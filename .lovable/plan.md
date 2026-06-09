## Violations Workflow + NJ Auto Liability Transfer

Builds on the existing pipeline (OCR bulk upload, auto-match, affidavit generation in `ezpass.functions.ts` / `violations.functions.ts`, and the ZIP packet in `violation-packet.functions.ts`). Parts 2–4 already work and stay intact. Per your answers: **manual trigger only** (no background cron), signer = "Rentalprise LLC Admin", seed NJ E-ZPass at P.O. Box 4971, Trenton, NJ 08650.

### 1. Database (one migration)
- New `authority_addresses` table: `key`, `name`, `address_lines` (text), `region`, `is_active`, timestamps. Seeded with NJ E-ZPass (P.O. Box 4971, Trenton, NJ 08650) plus editable placeholder rows for NJ Turnpike Authority, NY E-ZPass, PA Turnpike, NJ MVC (you fill addresses in-app).
- Add columns to `violations`: `liability_transfer_generated_at`, `liability_transfer_pdf_url`, `mail_packet_printed_at`, `mailed_at`, `transfer_confirmed_at`, `authority_key`, `final_warning_sent_at`. Existing `reminder_sent_at`, `submitted_*`, `resolved_*` are reused for the timeline.
- GRANTs + RLS: authenticated full access on `authority_addresses` (admin app, no anon).

### 2. Part 1 — Manual entry on /violations/bulk-upload
- Convert the page top into two tabs: **Upload PDF/Image** (existing, unchanged) and **Manual Entry** (new).
- Manual table: rows of Date · Time · Plate · Location · Amount · delete; `+ Add Row`; `Process All`.
- New server fn `createManualEzpassBatch` builds the same batch/items the OCR path produces, then runs the existing auto-match, so it flows into the identical review screen (Parts 2–4).

### 3. Parts 5–7 — Liability transfer (no signature)
- New `liability-transfer.functions.ts`:
  - `getAuthorityAddresses` / `upsertAuthorityAddress` (admin edit).
  - `generateLiabilityTransfer(violationId)` — manual button. Builds the NJ N.J.S.A. 39:4-138.1 cover letter (your exact text, signer "Rentalprise LLC Admin", owner Rentalprise LLC d/b/a Camauto Rentals, 416 Sicklerville Rd) pulling vehicle/renter/rental data, picks the authority address by `authority_key`, renders a PDF, stores it, and stamps `liability_transfer_generated_at`. Works with no customer signature.
  - `generateMailPacket(violationId)` — single combined PDF: cover letter → original violation notice → DL front/back → rental agreement → signed affidavit (each included only if on file). Reuses the fetch/merge approach from `violation-packet.functions.ts` but outputs one PDF (via pdf-lib) instead of a ZIP.
- Cover-letter and packet PDFs built with the same jsPDF/pdf-lib libs already in the project.

### 4. Part 8 — Tracking dashboard on /violations
- Add status filter tabs: All · Awaiting Response · Signed Affidavit · Paid Directly · Auto-Transfer Generated · Mail Packet Printed · Mailed · Confirmed Resolved (derived from existing + new timestamp columns).
- Per-violation expandable **timeline** rendering the day-stamped events from the stored timestamps.
- Row actions: `Generate Liability Transfer` (enabled once >7 days since `sent_to_customer_at` with no pay/sign), `Generate Mail Packet`, and mark buttons for Printed / Mailed / Confirmed (call a small `markViolationStage` server fn).
- A dashboard banner/count of violations past 7 days with no response, ready for transfer (your manual flag, since no cron).

### 5. Part 9 — Reminders (toggle-aware, manual/triggered)
- Add `send_reminders` handling for violation stages in the existing notifications framework so Day-3 reminder / Day-6 final warning / Day-7 last-chance and the "transfer ready" admin text (267-221-3977) all respect Notification Tab toggles. Because you chose manual-only, these fire from the existing `/api/public/hooks/violation-reminders` endpoint logic (extended for the 3/6/7 cadence and `final_warning_sent_at`) rather than new always-on cron — you keep control of scheduling.

### Out of scope / your input later
- Real addresses for NJ Turnpike, NY E-ZPass, PA Turnpike, NJ MVC (seeded as editable blanks).
- No new automatic background cron is added (per your choice); the day-8 auto-generation is exposed as the manual button + dashboard flag.

### Technical notes
- Reuses `drivers`, `vehicles`, `rentals` joins already used by the packet builder for renter name/address/DL/DOB/expiry.
- New server fns live in `*.functions.ts` (client-safe), admin Supabase access via `supabaseAdmin` imported inside handlers.
- No changes to auto-generated files; `routeTree.gen.ts` updates itself.