CREATE POLICY "Authenticated manage legacy agreements"
ON storage.objects FOR ALL TO authenticated
USING (bucket_id = 'legacy-agreements')
WITH CHECK (bucket_id = 'legacy-agreements');