CREATE TABLE public.runner_tasks (
  id text NOT NULL DEFAULT ('task_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)) PRIMARY KEY,
  type text NOT NULL,
  vehicle_id text NOT NULL,
  runner_id uuid NOT NULL,
  assigned_by uuid,
  assigned_at timestamp with time zone NOT NULL DEFAULT now(),
  due_date date,
  status text NOT NULL DEFAULT 'assigned',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion jsonb,
  mileage integer,
  completed_at timestamp with time zone,
  photo_urls text[] NOT NULL DEFAULT '{}'::text[],
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.runner_tasks TO authenticated;
GRANT ALL ON public.runner_tasks TO service_role;

ALTER TABLE public.runner_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage runner_tasks"
ON public.runner_tasks FOR ALL TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages runner_tasks"
ON public.runner_tasks FOR ALL TO public
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Runners read own runner_tasks"
ON public.runner_tasks FOR SELECT TO authenticated
USING (runner_id = auth.uid());

CREATE POLICY "Runners update own runner_tasks"
ON public.runner_tasks FOR UPDATE TO authenticated
USING (runner_id = auth.uid())
WITH CHECK (runner_id = auth.uid());

CREATE TRIGGER trg_runner_tasks_updated_at
BEFORE UPDATE ON public.runner_tasks
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_runner_tasks_runner ON public.runner_tasks(runner_id, status);
CREATE INDEX idx_runner_tasks_vehicle ON public.runner_tasks(vehicle_id);