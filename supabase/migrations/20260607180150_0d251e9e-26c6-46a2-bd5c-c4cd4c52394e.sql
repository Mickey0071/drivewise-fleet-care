CREATE TABLE public.mechanic_jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  maintenance_id TEXT NOT NULL,
  vehicle_id TEXT,
  mechanic_name TEXT NOT NULL,
  mechanic_phone TEXT NOT NULL,
  mechanic_shop TEXT,
  issue_description TEXT,
  additional_context TEXT,
  checklist_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  checklist_results JSONB,
  parts_list JSONB,
  labour_cost NUMERIC NOT NULL DEFAULT 0,
  estimated_hours NUMERIC,
  mechanic_notes TEXT,
  token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'sent',
  sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  submitted_at TIMESTAMP WITH TIME ZONE,
  created_by_admin TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mechanic_jobs TO authenticated;
GRANT ALL ON public.mechanic_jobs TO service_role;

ALTER TABLE public.mechanic_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view mechanic jobs"
  ON public.mechanic_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert mechanic jobs"
  ON public.mechanic_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update mechanic jobs"
  ON public.mechanic_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete mechanic jobs"
  ON public.mechanic_jobs FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_mechanic_jobs_maintenance ON public.mechanic_jobs (maintenance_id);
CREATE INDEX idx_mechanic_jobs_token ON public.mechanic_jobs (token);

CREATE TRIGGER trg_mechanic_jobs_updated_at
  BEFORE UPDATE ON public.mechanic_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();