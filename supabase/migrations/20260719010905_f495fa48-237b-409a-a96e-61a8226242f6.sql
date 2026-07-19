
ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS license_front_url text,
  ADD COLUMN IF NOT EXISTS license_back_url text,
  ADD COLUMN IF NOT EXISTS rideshare_proof_url text,
  ADD COLUMN IF NOT EXISTS vehicle_preference text,
  ADD COLUMN IF NOT EXISTS rental_cadence text;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS license_back_image_url text,
  ADD COLUMN IF NOT EXISTS rideshare_proof_url text;
