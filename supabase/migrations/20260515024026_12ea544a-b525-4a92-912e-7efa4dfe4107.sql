
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS image_url text;

INSERT INTO storage.buckets (id, name, public)
VALUES ('vehicle-photos', 'vehicle-photos', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Vehicle photos public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'vehicle-photos');

CREATE POLICY "Authenticated upload vehicle photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'vehicle-photos');

CREATE POLICY "Authenticated update vehicle photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'vehicle-photos');

CREATE POLICY "Authenticated delete vehicle photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'vehicle-photos');
