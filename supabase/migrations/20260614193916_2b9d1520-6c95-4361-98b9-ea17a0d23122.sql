ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS workflow_stage text,
  ADD COLUMN IF NOT EXISTS is_orphan boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS dispute_method text,
  ADD COLUMN IF NOT EXISTS disputed_at timestamp with time zone;

ALTER TABLE public.violations
  ADD CONSTRAINT violations_workflow_stage_check
  CHECK (workflow_stage IS NULL OR workflow_stage IN ('uploaded','matched','disputed','completed'));

CREATE INDEX IF NOT EXISTS idx_violations_workflow_stage ON public.violations (workflow_stage);