-- Privatize sensitive buckets
UPDATE storage.buckets SET public = false WHERE id IN ('rental-signing', 'claim-documents');

-- rental-signing: drop old public policies, restrict to authenticated admin
DROP POLICY IF EXISTS "Public read rental-signing" ON storage.objects;
DROP POLICY IF EXISTS "Staff write rental-signing" ON storage.objects;

CREATE POLICY "Admins read rental-signing"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'rental-signing' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write rental-signing"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'rental-signing' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update rental-signing"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'rental-signing' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete rental-signing"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'rental-signing' AND public.has_role(auth.uid(), 'admin'));

-- claim-documents: drop any public policies, restrict to authenticated admin
DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT polname FROM pg_policy
    WHERE polrelid = 'storage.objects'::regclass
      AND (
        polname ILIKE '%claim-documents%'
        OR polname ILIKE '%claim documents%'
        OR polname ILIKE '%claim_documents%'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', pol.polname);
  END LOOP;
END $$;

CREATE POLICY "Admins read claim-documents"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'claim-documents' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins write claim-documents"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'claim-documents' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update claim-documents"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'claim-documents' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete claim-documents"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'claim-documents' AND public.has_role(auth.uid(), 'admin'));