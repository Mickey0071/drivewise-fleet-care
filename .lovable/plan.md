## Insurance page

Add a new top-level **Insurance** section to the sidebar at `/insurance` that tracks insurance activity per vehicle and walks you through filing a claim.

### What you'll see

The page has three areas stacked on one card layout:

1. **Summary bar** — Total premiums paid, total claim payouts received, and net (payouts − premiums) for the current year.
2. **Entries tracker** (left/main) — Log entries with: date, vehicle, entry type (Premium or Claim), claim type (Collision / Comprehensive / Liability / Total Loss / Other — only shown when entry type is Claim), amount, description, notes. Table of all entries below the form with edit + delete, sortable by date, filter by vehicle and by type. CSV export via the existing `ReportActions` component.
3. **Claim checklist** (right side panel) — A reusable checklist you can run for each open claim. Pre-populated steps:
   - Take photos of all damage (vehicle, scene, other party)
   - Collect other driver's license, insurance, plate
   - File police report; capture report number
   - Call insurance to open claim; capture claim number
   - Upload photos and documents
   - Get repair estimate(s)
   - Schedule repair / total-loss inspection
   - Confirm rental coverage / loaner
   - Track payout received
   
   Each claim entry gets its own checklist instance; progress (e.g. "4/9") shows on the entry row.

### Backend

New table `public.insurance_entries`:
- `id` text (default `'ins_' || short uuid`)
- `vehicle_id` text (nullable — for overhead/policy-level premiums not tied to a vehicle)
- `type` text — `'premium'` or `'claim'`
- `claim_type` text nullable — Collision / Comprehensive / Liability / Total Loss / Other
- `date` date
- `amount` numeric — positive number (premium = cost, claim = payout received)
- `description` text
- `notes` text nullable
- `policy_number` text nullable
- `claim_number` text nullable
- `status` text — `'open'` / `'closed'` (claims only; premiums always `'closed'`)
- `created_by` uuid, `created_at`, `updated_at`

New table `public.insurance_claim_checklist`:
- `id` text
- `entry_id` text → `insurance_entries.id` (cascade delete)
- `label` text
- `done` boolean default false
- `sort_order` int

RLS: authenticated read + write (matches `expenses`/`vehicles` patterns already in the app). A trigger seeds the default 9 checklist items whenever an entry with `type='claim'` is inserted.

### Frontend

- New route `src/routes/insurance.tsx` (homepage of the section)
- New sidebar entry in `src/components/app/AppSidebar.tsx` ("Insurance", Shield icon)
- New store helpers in `src/lib/mock/store.ts`: `addInsuranceEntry`, `updateInsuranceEntry`, `deleteInsuranceEntry`, `toggleChecklistItem`, plus realtime subscriptions on both tables (mirrors the `vehicle_photos` pattern)
- New types in `src/lib/mock/data.ts`: `InsuranceEntry`, `InsuranceChecklistItem`, and in-memory arrays
- Component `src/components/app/ClaimChecklist.tsx` for the per-claim checklist panel

No edge functions, no new secrets. The existing TanStack Start + Supabase patterns cover everything.