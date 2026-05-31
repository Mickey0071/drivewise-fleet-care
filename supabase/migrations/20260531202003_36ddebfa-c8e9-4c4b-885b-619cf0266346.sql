ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS mr_vendor_name text,
  ADD COLUMN IF NOT EXISTS mr_contact_phone text,
  ADD COLUMN IF NOT EXISTS mr_work_order text,
  ADD COLUMN IF NOT EXISTS mr_dropoff_mileage integer,
  ADD COLUMN IF NOT EXISTS mr_dropoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS mr_mechanic_notes text,
  ADD COLUMN IF NOT EXISTS mr_photos jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS shop_vendor text,
  ADD COLUMN IF NOT EXISTS shop_dropoff_at timestamptz,
  ADD COLUMN IF NOT EXISTS shop_est_return date;