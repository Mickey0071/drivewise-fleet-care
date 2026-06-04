ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual_report',
  ADD COLUMN IF NOT EXISTS inspection_id text;