ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS diagnosis_title text,
  ADD COLUMN IF NOT EXISTS original_issue_id text,
  ADD COLUMN IF NOT EXISTS split_index integer,
  ADD COLUMN IF NOT EXISTS split_total integer;