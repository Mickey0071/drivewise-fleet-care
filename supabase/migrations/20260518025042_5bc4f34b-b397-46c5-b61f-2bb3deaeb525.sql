CREATE TABLE public.pending_inspections (
  vehicle_id text PRIMARY KEY,
  rental_id text NOT NULL,
  token text NOT NULL UNIQUE,
  runner_phone text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pending_inspections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read pending_inspections"
ON public.pending_inspections FOR SELECT TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Staff insert pending_inspections"
ON public.pending_inspections FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Staff update pending_inspections"
ON public.pending_inspections FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Staff delete pending_inspections"
ON public.pending_inspections FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));