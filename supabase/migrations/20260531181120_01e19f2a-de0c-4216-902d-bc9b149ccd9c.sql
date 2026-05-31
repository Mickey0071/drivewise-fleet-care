ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS last_inspection_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_inspection_mileage integer;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;