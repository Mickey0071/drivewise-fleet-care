-- Add task dispatch columns
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_vehicle_id TEXT REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS linked_rental_id TEXT,
  ADD COLUMN IF NOT EXISTS task_type TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS due_date DATE,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_inspection_id TEXT,
  ADD COLUMN IF NOT EXISTS runner_notes TEXT;

-- Enforce allowed enum values via CHECK constraints (idempotent)
DO $$ BEGIN
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_task_type_check
    CHECK (task_type IN ('pickup','dropoff','dmv','repo','parts','inspection','mechanic_run','other'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.tasks ADD CONSTRAINT tasks_status_check
    CHECK (status IN ('pending','in_progress','completed','cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to_user_id ON public.tasks(assigned_to_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_linked_vehicle_id ON public.tasks(linked_vehicle_id);

-- Replace broad RLS with admin-full / runner-own
DROP POLICY IF EXISTS "Authenticated read tasks" ON public.tasks;
DROP POLICY IF EXISTS "Staff write tasks" ON public.tasks;

CREATE POLICY "Admins read all tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins insert tasks"
  ON public.tasks FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete tasks"
  ON public.tasks FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Runners read own tasks"
  ON public.tasks FOR SELECT TO authenticated
  USING (
    assigned_to_user_id = auth.uid()
    AND (public.has_role(auth.uid(), 'runner') OR public.has_role(auth.uid(), 'driver'))
  );

CREATE POLICY "Runners update own tasks"
  ON public.tasks FOR UPDATE TO authenticated
  USING (
    assigned_to_user_id = auth.uid()
    AND (public.has_role(auth.uid(), 'runner') OR public.has_role(auth.uid(), 'driver'))
  );
