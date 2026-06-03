ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS parts_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS labor_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mechanic_notes text;