ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS cardholder_phone text,
  ADD COLUMN IF NOT EXISTS cardholder_relationship text,
  ADD COLUMN IF NOT EXISTS cardholder_license_url text,
  ADD COLUMN IF NOT EXISTS cardholder_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS name_mismatch_flag boolean NOT NULL DEFAULT false;