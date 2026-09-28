ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS tag_state text,
  ADD COLUMN IF NOT EXISTS tag_expiry date,
  ADD COLUMN IF NOT EXISTS title_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS registration_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags_missing boolean NOT NULL DEFAULT false;

CREATE TABLE public.vehicle_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL,
  titled boolean NOT NULL,
  title_state text,
  title_number text,
  title_status text,
  title_photo_path text,
  registration_on_file boolean NOT NULL,
  registration_photo_path text,
  registration_expiry date,
  tags_on_vehicle boolean NOT NULL,
  plate text,
  tag_state text,
  tag_expiry date,
  insurance_card boolean NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_onboarding TO authenticated;
GRANT ALL ON public.vehicle_onboarding TO service_role;
ALTER TABLE public.vehicle_onboarding ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage vehicle onboarding" ON public.vehicle_onboarding
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'));
CREATE INDEX idx_vehicle_onboarding_vehicle ON public.vehicle_onboarding(vehicle_id);
CREATE TRIGGER trg_vehicle_onboarding_updated BEFORE UPDATE ON public.vehicle_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.paperwork_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL,
  task_type text NOT NULL CHECK (task_type IN ('dmv','title_transfer','tag_order')),
  issue text NOT NULL CHECK (issue IN ('title','registration','tags')),
  assignee text NOT NULL,
  due_date date,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  notes text,
  completed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.paperwork_tasks TO authenticated;
GRANT ALL ON public.paperwork_tasks TO service_role;
ALTER TABLE public.paperwork_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage paperwork tasks" ON public.paperwork_tasks
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'));
CREATE INDEX idx_paperwork_tasks_vehicle ON public.paperwork_tasks(vehicle_id);
CREATE TRIGGER trg_paperwork_tasks_updated BEFORE UPDATE ON public.paperwork_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();