## Update Insurance Claim Checklist to match Accident Checklist

Replace the current 9-step claim checklist with the 8-task accident checklist from the uploaded PDF, and make each task richer: file uploads to prove docs were collected, and amount fields where money is involved.

### Header fields on each claim
Add to `insurance_entries` (already has most): `company` (insurance company), `renter_name`, `renter_phone`. Claim # and vehicle are already captured. Date already exists.

### New checklist tasks (replaces old 9)
1. Incident Report
2. Police Report
3. Photos of Damages
4. Repair Estimate — **amount field**
5. Actual Cash Value — **amount field**
6. Rental Receipt — **amount field**
7. Loss of Use Demand (1099 previous year) — **amount field**
8. Loss of Use Demand (Previous Week to accident) — **amount field**

The `seed_claim_checklist()` trigger will be rewritten to insert these 8 rows with the right flags.

### Per-task fields (new columns on `insurance_claim_checklist`)
- `done` boolean (exists)
- `notes` text — free notes per task
- `amount` numeric nullable — shown only on tasks flagged `requires_amount`
- `requires_amount` boolean — seeded true for tasks 4–8
- `requires_document` boolean — seeded true for all 8
- `document_url` text nullable — uploaded proof (PDF/image)
- `document_name` text nullable

A task shows a green "complete" state only when `done = true` AND (if `requires_document`) `document_url` is set AND (if `requires_amount`) `amount` is set.

### Storage
New public bucket `claim-documents` with authenticated read/write RLS for uploaded proof files (police reports, photos, estimates, receipts).

### UI changes (`src/routes/insurance.tsx` + `ChecklistDialog`)
- Claim form gains: Insurance Company, Renter Name, Renter Phone fields.
- Checklist dialog redesigned as a vertical list of cards, each showing:
  - Checkbox + task label
  - Notes input
  - Amount input (when `requires_amount`)
  - Upload button + filename preview + view/replace/remove (when `requires_document`)
  - Status badge: "Complete" / "Missing docs" / "Missing amount" / "Pending"
- Summary row at top of dialog: "X of 8 complete" + total of all amounts entered.
- Entry table gains a "Claim total" column summing the 5 amount fields.

### Store helpers (`src/lib/mock/store.ts`)
- Extend `toggleChecklistItem` → `updateChecklistItem({ id, done?, notes?, amount?, document_url?, document_name? })`
- New `uploadClaimDocument(itemId, file)` → uploads to `claim-documents` bucket, updates row.

### Files touched
- New migration: schema changes + rewritten `seed_claim_checklist` trigger + storage bucket/policies
- `src/lib/mock/data.ts` — extend `InsuranceEntry` + `InsuranceChecklistItem` types
- `src/lib/mock/store.ts` — new helpers
- `src/routes/insurance.tsx` — form fields, table column, redesigned ChecklistDialog
- `src/integrations/supabase/types.ts` — regenerated after migration

No new secrets, no edge functions.
