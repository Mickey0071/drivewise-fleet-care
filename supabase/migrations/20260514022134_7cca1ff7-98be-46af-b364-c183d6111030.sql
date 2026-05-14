
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS sign_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS client_signature_url text,
  ADD COLUMN IF NOT EXISTS client_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS license_image_url text,
  ADD COLUMN IF NOT EXISTS selfie_image_url text;

CREATE INDEX IF NOT EXISTS rentals_sign_token_idx ON public.rentals (sign_token);

INSERT INTO storage.buckets (id, name, public)
VALUES ('rental-signing', 'rental-signing', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read rental-signing" ON storage.objects;
CREATE POLICY "Public read rental-signing"
ON storage.objects FOR SELECT
USING (bucket_id = 'rental-signing');

DROP POLICY IF EXISTS "Staff write rental-signing" ON storage.objects;
CREATE POLICY "Staff write rental-signing"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'rental-signing');
