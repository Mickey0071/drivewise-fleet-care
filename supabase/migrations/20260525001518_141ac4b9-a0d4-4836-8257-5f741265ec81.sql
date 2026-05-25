-- Issue 1, 2, 3: Remove sensitive tables from Realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.drivers;
ALTER PUBLICATION supabase_realtime DROP TABLE public.expenses;
ALTER PUBLICATION supabase_realtime DROP TABLE public.insurance_entries;
ALTER PUBLICATION supabase_realtime DROP TABLE public.insurance_claim_checklist;
ALTER PUBLICATION supabase_realtime DROP TABLE public.staff;
ALTER PUBLICATION supabase_realtime DROP TABLE public.payroll_runs;
ALTER PUBLICATION supabase_realtime DROP TABLE public.payroll_lines;
ALTER PUBLICATION supabase_realtime DROP TABLE public.payments;
ALTER PUBLICATION supabase_realtime DROP TABLE public.rentals;
ALTER PUBLICATION supabase_realtime DROP TABLE public.rental_extensions;

-- Issue 5: Tighten inspections SELECT — staff only, drivers see own via rental
DROP POLICY IF EXISTS "Authenticated read inspections" ON public.inspections;
CREATE POLICY "Staff read inspections"
  ON public.inspections FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Drivers read own inspections"
  ON public.inspections FOR SELECT TO authenticated
  USING (
    rental_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.rentals r
      WHERE r.id = inspections.rental_id AND r.driver_id = current_driver_id()
    )
  );

-- Issue 6a: Tighten maintenance SELECT — staff only
DROP POLICY IF EXISTS "Authenticated read maintenance" ON public.maintenance;
CREATE POLICY "Staff read maintenance"
  ON public.maintenance FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

-- Issue 6b: Tighten violations SELECT — staff, drivers see own
DROP POLICY IF EXISTS "Authenticated read violations" ON public.violations;
CREATE POLICY "Staff read violations"
  ON public.violations FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));
CREATE POLICY "Drivers read own violations"
  ON public.violations FOR SELECT TO authenticated
  USING (driver_id = current_driver_id());

-- Issue 4: Restrict Realtime channel subscriptions (realtime.messages)
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated can use realtime" ON realtime.messages;
CREATE POLICY "Authenticated can use realtime"
  ON realtime.messages FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "Authenticated can send realtime"
  ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (true);