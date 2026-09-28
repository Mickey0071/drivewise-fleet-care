CREATE POLICY "Staff read vehicle documents" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'vehicle-documents' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va')));
CREATE POLICY "Staff upload vehicle documents" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vehicle-documents' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va')));
CREATE POLICY "Staff update vehicle documents" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'vehicle-documents' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va')));