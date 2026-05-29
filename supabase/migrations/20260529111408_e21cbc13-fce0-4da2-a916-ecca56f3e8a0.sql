ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS card_owner_id_url text,
  ADD COLUMN IF NOT EXISTS card_owner_selfie_url text,
  ADD COLUMN IF NOT EXISTS card_owner_name text,
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS verification_timestamp timestamp with time zone;