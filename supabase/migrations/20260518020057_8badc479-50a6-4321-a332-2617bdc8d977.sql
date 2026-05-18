
-- Helper: map current auth user to their linked driver id (via profiles.driver_ref)
CREATE OR REPLACE FUNCTION public.current_driver_id()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT driver_ref FROM public.profiles WHERE id = auth.uid()
$$;

-- ============ drivers ============
DROP POLICY IF EXISTS "Authenticated read drivers" ON public.drivers;
CREATE POLICY "Staff read all drivers" ON public.drivers
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Drivers read own record" ON public.drivers
  FOR SELECT TO authenticated
  USING (id = public.current_driver_id());

-- ============ rentals ============
DROP POLICY IF EXISTS "Authenticated read rentals" ON public.rentals;
CREATE POLICY "Staff read all rentals" ON public.rentals
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Drivers read own rentals" ON public.rentals
  FOR SELECT TO authenticated
  USING (driver_id = public.current_driver_id());

-- ============ payments ============
DROP POLICY IF EXISTS "Authenticated read payments" ON public.payments;
CREATE POLICY "Staff read all payments" ON public.payments
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Drivers read own payments" ON public.payments
  FOR SELECT TO authenticated
  USING (driver_id = public.current_driver_id());

-- ============ rental_extensions ============
DROP POLICY IF EXISTS "Authenticated read extensions" ON public.rental_extensions;
CREATE POLICY "Staff read all extensions" ON public.rental_extensions
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Drivers read own extensions" ON public.rental_extensions
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.rentals r WHERE r.id = rental_extensions.rental_id AND r.driver_id = public.current_driver_id()));

-- ============ share_link_sms_log ============
DROP POLICY IF EXISTS "Authenticated insert sms log" ON public.share_link_sms_log;
CREATE POLICY "Staff insert sms log" ON public.share_link_sms_log
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

-- ============ storage: vehicle-photos ============
DROP POLICY IF EXISTS "Authenticated upload vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated update vehicle photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated delete vehicle photos" ON storage.objects;
CREATE POLICY "Staff upload vehicle photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vehicle-photos' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));
CREATE POLICY "Staff update vehicle photos" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vehicle-photos' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));
CREATE POLICY "Staff delete vehicle photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vehicle-photos' AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role)));

-- ============ Realtime: remove sensitive tables from broadcast ============
ALTER PUBLICATION supabase_realtime DROP TABLE public.staff;
ALTER PUBLICATION supabase_realtime DROP TABLE public.payroll_runs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.payroll_lines;
