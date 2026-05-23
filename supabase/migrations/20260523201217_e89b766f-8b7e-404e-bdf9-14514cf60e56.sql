ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS third_party_payer boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payer_id_image_url text,
  ADD COLUMN IF NOT EXISTS payer_name_extracted text,
  ADD COLUMN IF NOT EXISTS payer_phone text;