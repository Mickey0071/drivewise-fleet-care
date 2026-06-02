## Phase 2 — Inspection Approval, Alerts, Logging & Audit

Builds on the existing return-inspection flow (`reviewInspection` in `tasks.functions.ts` + `PendingInspections` in the Maintenance dashboard). Reuses the existing SMS sender (`sendSms` from `ghl.server`, same as daily reports). Admin alert number stays `+12672213977`.

### 1. Database migration

`runner_tasks` — add audit columns:
- `reviewed_at` (timestamptz), `reviewed_by` (uuid), `review_action` (text), `forced` (boolean default false)

`inspections` — add link/audit columns (table already has `checklist_items`, `mileage`, `notes`, etc.):
- `task_id` (text), `runner_id` (uuid), `checklist_data` (jsonb), `issues_found` (jsonb)

`vehicles` already has `last_inspection_at` and `last_inspection_mileage` — reused, no change. Vehicle `status` represents inspection status (`available` after approval).

(All are additive `ALTER TABLE ADD COLUMN`; existing GRANTs/RLS unchanged.)

### 2. `reviewInspection` server function (extend existing)

On **Approve**:
- Insert a row into `inspections` (type `return`, `is_return_inspection=true`, `task_id`, `runner_id`, `checklist_data`, `issues_found`, `mileage`, `inspector_name`, `completed_by`, `damage_noted`, `ready_to_rent=true`, `date`/`submitted_at`).
- Auto-create maintenance ticket if issues exist (already implemented).
- Update vehicle: `status='available'`, `last_inspection_at=now()`, `last_inspection_mileage=mileage`.
- If task is tied to a rental (`details.rental_id`): set `rentals.return_inspection_id` + mark return finalized so P&L treats it closed.
- Mark task `status='approved'`, set `reviewed_at/by`, `review_action='approved'`.
- SMS admin: `✓ Inspection approved [vehicle]`.

On **Reject & Re-inspect**: existing reopen + runner SMS, plus `review_action='rejected_reinspect'`, `reviewed_at/by`.
On **Reject (fix manually)**: `status='rejected'`, `review_action='rejected_manual'`, `reviewed_at/by`. No re-send.
On **Force Available**: vehicle `status='available'`; task `status='forced'`, `forced=true`, `review_action='forced'`, `reviewed_at/by`; append audit note `Override at [time] by admin - inspection skipped`. Do **not** insert into `inspections`. SMS admin: `Vehicle forced available — no inspection logged`.

### 3. Dashboard alerts widget

New `ApprovedInspections.tsx` (self-fetches from Supabase like `PendingInspections`): shows last 5 tasks with `status in (approved, forced)`, newest first — `"[Vehicle] inspection approved by [runner] on [date]"` (forced ones flagged as override). Each links to `/fleet/$vehicleId`, plus a "View all" link to Maintenance. Rendered on the admin dashboard (`index.tsx`) for `role === "admin"`.

### 4. Fleet detail — last inspection

On the fleet vehicle detail (`fleet.$vehicleId.tsx`), surface `last_inspection_at` + `last_inspection_mileage` + availability status from Supabase so the card reflects the latest approved inspection.

### 5. Out of scope (Phase 3, per spec)

Runner feedback on rejection, inspection reminder alerts, automated re-inspection scheduling.

### Technical notes

- All writes go through the existing `reviewInspection` `createServerFn` (admin-gated via RLS + `requireSupabaseAuth`); timestamps captured server-side for a tamper-proof audit trail.
- The dashboard widget and fleet detail read live Supabase data directly (the admin app already mixes the mock store for legacy views with Supabase for runner/inspection data).
- SMS failures are caught and never block approval.
