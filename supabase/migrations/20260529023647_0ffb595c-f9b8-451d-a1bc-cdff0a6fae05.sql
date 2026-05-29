CREATE TABLE public.violation_status_history (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  violation_id text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  changed_by uuid,
  changed_by_name text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX idx_vsh_violation ON public.violation_status_history (violation_id, created_at DESC);

GRANT SELECT, INSERT ON public.violation_status_history TO authenticated;
GRANT ALL ON public.violation_status_history TO service_role;

ALTER TABLE public.violation_status_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read violation_status_history"
ON public.violation_status_history
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Staff insert violation_status_history"
ON public.violation_status_history
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Service role manages violation_status_history"
ON public.violation_status_history
FOR ALL
USING (auth.role() = 'service_role'::text)
WITH CHECK (auth.role() = 'service_role'::text);
