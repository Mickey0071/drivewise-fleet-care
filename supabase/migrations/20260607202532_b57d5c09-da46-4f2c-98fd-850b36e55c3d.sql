ALTER TABLE public.runner_tasks
  ADD COLUMN IF NOT EXISTS requires_photos boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS photos_count_required integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checklist_results jsonb,
  ADD COLUMN IF NOT EXISTS runner_notes text;