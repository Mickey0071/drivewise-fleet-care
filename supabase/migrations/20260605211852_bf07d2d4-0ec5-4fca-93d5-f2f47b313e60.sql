ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS mechanic_phone text,
  ADD COLUMN IF NOT EXISTS mechanic_shop text,
  ADD COLUMN IF NOT EXISTS parts_list jsonb;

ALTER TABLE public.repair_history
  ADD COLUMN IF NOT EXISTS mechanic_phone text,
  ADD COLUMN IF NOT EXISTS mechanic_shop text,
  ADD COLUMN IF NOT EXISTS parts_list jsonb;