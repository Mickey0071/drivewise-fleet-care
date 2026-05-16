-- Extend vehicles with fields shown on the rental agreement
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS color text,
  ADD COLUMN IF NOT EXISTS transmission text,
  ADD COLUMN IF NOT EXISTS fuel_type text,
  ADD COLUMN IF NOT EXISTS seats integer,
  ADD COLUMN IF NOT EXISTS fuel_level_pickup text,
  ADD COLUMN IF NOT EXISTS ez_pass_tag text,
  ADD COLUMN IF NOT EXISTS registration_expiry date,
  ADD COLUMN IF NOT EXISTS insurance_expiry date;

-- Extend drivers with renter details shown on the rental agreement
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS date_of_birth date,
  ADD COLUMN IF NOT EXISTS address text;