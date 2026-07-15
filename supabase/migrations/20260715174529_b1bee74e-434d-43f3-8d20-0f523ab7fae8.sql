
CREATE POLICY "Authenticated can read waitlist uploads"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'waitlist-uploads');
