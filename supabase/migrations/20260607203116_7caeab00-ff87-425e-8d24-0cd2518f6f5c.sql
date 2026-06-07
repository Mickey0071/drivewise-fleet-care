DROP POLICY IF EXISTS "Authenticated can view mechanic jobs" ON public.mechanic_jobs;
DROP POLICY IF EXISTS "Authenticated can insert mechanic jobs" ON public.mechanic_jobs;
DROP POLICY IF EXISTS "Authenticated can update mechanic jobs" ON public.mechanic_jobs;
DROP POLICY IF EXISTS "Authenticated can delete mechanic jobs" ON public.mechanic_jobs;

CREATE POLICY "Staff read mechanic jobs" ON public.mechanic_jobs
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Admins insert mechanic jobs" ON public.mechanic_jobs
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Runners insert mechanic jobs" ON public.mechanic_jobs
  FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Admins update mechanic jobs" ON public.mechanic_jobs
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Runners update mechanic jobs" ON public.mechanic_jobs
  FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Admins delete mechanic jobs" ON public.mechanic_jobs
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Runners delete mechanic jobs" ON public.mechanic_jobs
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'runner'::app_role));