ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS deposit_required numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_processed boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS deposit_date timestamptz;