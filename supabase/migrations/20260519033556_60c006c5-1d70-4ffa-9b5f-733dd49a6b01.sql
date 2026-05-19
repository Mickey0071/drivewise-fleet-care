
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS return_inspection_id TEXT,
  ADD COLUMN IF NOT EXISTS mileage_out INTEGER,
  ADD COLUMN IF NOT EXISTS mileage_in INTEGER,
  ADD COLUMN IF NOT EXISTS final_charge_amount NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS final_charge_breakdown JSONB;

ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS is_return_inspection BOOLEAN NOT NULL DEFAULT false;

UPDATE public.inspections
   SET is_return_inspection = true
 WHERE job_type = 'vehicle_return' AND is_return_inspection = false;
