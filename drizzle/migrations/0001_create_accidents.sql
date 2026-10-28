CREATE TABLE public.accidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  accident_date date,
  rental_id text,
  vehicle_id text,
  driver_id text,
  renter_name text,
  vehicle_label text,
  insurance_company text,
  insurance_phone text,
  policy_number text,
  claim_number text,
  other_driver_name text,
  other_driver_phone text,
  other_driver_insurance text,
  other_driver_plate text,
  checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  status text NOT NULL DEFAULT 'open',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.accidents TO authenticated;
GRANT ALL ON public.accidents TO service_role;
ALTER TABLE public.accidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage accidents" ON public.accidents FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'));
CREATE INDEX accidents_rental_idx ON public.accidents(rental_id);
CREATE INDEX accidents_vehicle_idx ON public.accidents(vehicle_id);
CREATE TRIGGER accidents_touch BEFORE UPDATE ON public.accidents FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE POLICY "Staff read accident docs" ON storage.objects FOR SELECT TO authenticated
USING (bucket_id='accident-docs' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va')));
CREATE POLICY "Staff upload accident docs" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id='accident-docs' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va')));
CREATE POLICY "Staff delete accident docs" ON storage.objects FOR DELETE TO authenticated
USING (bucket_id='accident-docs' AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va')));