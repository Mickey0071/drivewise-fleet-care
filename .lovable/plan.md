# Photo auto-fill for parts tickets

Add a "Scan ticket" photo upload to both parts entry flows. The image is sent to Lovable AI (Gemini vision), which reads the parts receipt / invoice / handwritten ticket and fills the form fields automatically. User can edit before saving.

## Where it shows up

1. **Admin Parts page** (`/admin/parts`) — "Scan ticket" button above the form. Auto-fills: part name, part cost, labor cost, supplier, notes, and (best-effort) technician.
2. **Mechanic diagnostic checklist** (`/mechanic-job/$token`, "Parts Needed" section) — "Scan parts ticket" button. Auto-fills the parts list: one row per part with name, qty, part $, labor $.

## How it works

1. User taps "Scan ticket" → camera/file picker (reuse the existing `PhotoCapture` component pattern from waitlist/violations).
2. Client compresses the image (existing `image-compress.ts`) and sends a data URL to a new server function.
3. Server function uploads the photo to a new private `parts-tickets` storage bucket and calls Lovable AI (`google/gemini-2.5-flash`) with a strict JSON schema:
   - Admin variant: `{ part_name, part_cost, labor_cost, supplier, technician, notes, confidence }`
   - Mechanic variant: `{ parts: [{ name, qty, price, labor }], confidence, notes }`
4. Response fields populate the form. Empty/unreadable fields are left blank. A small "Scanned — review before saving" banner appears with the confidence and a "Clear" button. All fields remain editable.
5. Nothing auto-submits.

## Files

- **New**: `src/lib/parts-photo.functions.ts` — two server functions (`analyzePartsTicketAdmin`, `analyzePartsTicketMechanic`), both `requireSupabaseAuth` for the admin one; the mechanic one is public and validated by the existing `$token` in the request (added as an input, checked against `mechanic_jobs`).
- **Migration**: create private `parts-tickets` storage bucket (staff-only read via signed URLs, same pattern as `violation-photos`).
- **Edit** `src/routes/admin.parts.tsx` — add scan button + handler that sets the existing `partName`, `partCost`, `laborCost`, `supplier`, `notes`, technician state.
- **Edit** `src/routes/mechanic-job.$token.tsx` — add scan button in the "Parts Needed" header that replaces/extends the `parts` array with scanned rows (append, don't wipe).
- **Reuse**: existing `PhotoCapture`-style capture UI (or a small inline `<input type="file" accept="image/*" capture="environment">`) and `image-compress.ts`.

## Guardrails

- Suppliers: only accept a supplier value if it matches (case-insensitive) an existing row in `parts_suppliers`; otherwise put the raw name into `notes` and leave supplier blank so the admin picks.
- Technicians: same — only preselect if it matches a known technician name; otherwise leave blank.
- Numeric fields default to 0 when unreadable.
- 10 MB size cap, jpeg/png/webp only, mirroring `violation-photo.functions.ts`.
- Errors from the AI gateway (402/429) surface as a toast; the form stays usable for manual entry.

No changes to submit logic, totals, DB schema for maintenance/parts, or other screens.