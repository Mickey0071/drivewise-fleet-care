-- Audit columns on runner_tasks for inspection review trail
ALTER TABLE public.runner_tasks
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS review_action text,
  ADD COLUMN IF NOT EXISTS forced boolean NOT NULL DEFAULT false;

-- Link/audit columns on inspections for runner-submitted inspections
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS task_id text,
  ADD COLUMN IF NOT EXISTS runner_id uuid,
  ADD COLUMN IF NOT EXISTS checklist_data jsonb,
  ADD COLUMN IF NOT EXISTS issues_found jsonb;