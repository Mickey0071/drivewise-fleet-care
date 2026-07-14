ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS parts_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS labor_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb;