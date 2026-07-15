ALTER TABLE public.mechanic_jobs
  ADD COLUMN IF NOT EXISTS mechanic_recommendations text,
  ADD COLUMN IF NOT EXISTS completed_by_kind text,
  ADD COLUMN IF NOT EXISTS completed_by_name text;