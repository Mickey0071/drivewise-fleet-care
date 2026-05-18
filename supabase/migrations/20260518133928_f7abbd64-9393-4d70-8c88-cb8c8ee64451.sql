-- Drop old functions that reference columns we're about to drop
DROP FUNCTION IF EXISTS public.handle_inspection_failures() CASCADE;
DROP FUNCTION IF EXISTS public.handle_maintenance_close() CASCADE;

-- STEP 1: Add columns to inspections
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS inspector_name TEXT;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS job_type TEXT;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='inspections' AND constraint_name='inspections_job_type_check'
  ) THEN
    ALTER TABLE public.inspections ADD CONSTRAINT inspections_job_type_check
      CHECK (job_type IS NULL OR job_type IN ('vehicle_return','repossession','new_acquisition','mechanic_run','dmv_reg','inspection'));
  END IF;
END $$;

ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS checklist_items JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS ready_to_rent BOOLEAN;
ALTER TABLE public.inspections ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT now();

-- fuel_level: currently integer; convert to text with check constraint
DO $$
DECLARE
  v_type TEXT;
BEGIN
  SELECT data_type INTO v_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inspections' AND column_name='fuel_level';
  IF v_type IS NULL THEN
    ALTER TABLE public.inspections ADD COLUMN fuel_level TEXT;
  ELSIF v_type <> 'text' THEN
    ALTER TABLE public.inspections ALTER COLUMN fuel_level DROP DEFAULT;
    ALTER TABLE public.inspections ALTER COLUMN fuel_level TYPE TEXT USING NULL;
  END IF;
END $$;

-- Drop any existing fuel_level check constraints, then add the new one
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid='public.inspections'::regclass
      AND contype='c'
      AND pg_get_constraintdef(oid) ILIKE '%fuel_level%'
  LOOP
    EXECUTE format('ALTER TABLE public.inspections DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.inspections ADD CONSTRAINT inspections_fuel_level_check
  CHECK (fuel_level IS NULL OR fuel_level IN ('full','three_quarter','half','quarter','empty'));

-- STEP 2: Drop dead per-item columns
ALTER TABLE public.inspections DROP COLUMN IF EXISTS tires_status;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS fluids_status;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS brakes_status;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS lights_status;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS body_status;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS interior_status;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS tires_notes;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS fluids_notes;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS brakes_notes;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS lights_notes;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS body_notes;
ALTER TABLE public.inspections DROP COLUMN IF EXISTS interior_notes;

-- STEP 3: tasks table — create if missing, add columns
CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT PRIMARY KEY DEFAULT ('tsk_' || substr(gen_random_uuid()::text, 1, 12)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS runner_name TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS make TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS model TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS plate TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority_level TEXT DEFAULT 'normal';
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema='public' AND table_name='tasks' AND constraint_name='tasks_priority_level_check'
  ) THEN
    ALTER TABLE public.tasks ADD CONSTRAINT tasks_priority_level_check
      CHECK (priority_level IN ('urgent','normal','flexible'));
  END IF;
END $$;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='Authenticated read tasks') THEN
    CREATE POLICY "Authenticated read tasks" ON public.tasks FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='tasks' AND policyname='Staff write tasks') THEN
    CREATE POLICY "Staff write tasks" ON public.tasks FOR ALL TO authenticated
      USING (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'runner'::app_role))
      WITH CHECK (has_role(auth.uid(),'admin'::app_role) OR has_role(auth.uid(),'runner'::app_role));
  END IF;
END $$;

-- STEP 4: maintenance.source_inspection_id (already TEXT in this DB; skip type change)
ALTER TABLE public.maintenance ADD COLUMN IF NOT EXISTS source_inspection_id TEXT;

-- STEP 5: vehicles.has_open_issues (already exists)
ALTER TABLE public.vehicles ADD COLUMN IF NOT EXISTS has_open_issues BOOLEAN NOT NULL DEFAULT false;

-- STEP 6: auto-maintenance trigger
CREATE OR REPLACE FUNCTION public.inspections_auto_maintenance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reasons TEXT[] := ARRAY[]::TEXT[];
  k TEXT;
  v_mid TEXT;
  v_exists BOOLEAN;
BEGIN
  IF NEW.checklist_items IS NOT NULL THEN
    FOR k IN SELECT key FROM jsonb_each_text(NEW.checklist_items) WHERE value = 'fail'
    LOOP
      reasons := array_append(reasons, k);
    END LOOP;
  END IF;
  IF NEW.damage_noted = true THEN
    reasons := array_append(reasons, 'damage');
  END IF;
  IF NEW.ready_to_rent = false THEN
    reasons := array_append(reasons, 'flagged needs mechanic');
  END IF;

  IF array_length(reasons, 1) IS NULL OR array_length(reasons, 1) = 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    SELECT EXISTS(
      SELECT 1 FROM public.maintenance
      WHERE source_inspection_id = NEW.id AND date_completed IS NULL
    ) INTO v_exists;
    IF v_exists THEN
      UPDATE public.vehicles SET has_open_issues = true WHERE id = NEW.vehicle_id;
      RETURN NEW;
    END IF;
  END IF;

  v_mid := 'MN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  INSERT INTO public.maintenance (
    id, vehicle_id, service_type, vendor, date_completed,
    mileage_at_service, cost, notes, source_inspection_id, next_service_due
  ) VALUES (
    v_mid, NEW.vehicle_id,
    'Auto-generated from inspection: ' || array_to_string(reasons, ', '),
    'Pending assignment', NULL,
    COALESCE(NEW.mileage, 0), 0,
    NEW.notes, NEW.id, CURRENT_DATE
  );

  UPDATE public.vehicles SET has_open_issues = true WHERE id = NEW.vehicle_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inspections_after_write ON public.inspections;
CREATE TRIGGER inspections_after_write
AFTER INSERT OR UPDATE ON public.inspections
FOR EACH ROW EXECUTE FUNCTION public.inspections_auto_maintenance();

-- STEP 7: clear-flag trigger
CREATE OR REPLACE FUNCTION public.maintenance_sync_vehicle_flag()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vid TEXT;
  v_open INT;
BEGIN
  v_vid := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  SELECT COUNT(*) INTO v_open FROM public.maintenance
    WHERE vehicle_id = v_vid AND date_completed IS NULL;
  IF v_open = 0 THEN
    UPDATE public.vehicles SET has_open_issues = false WHERE id = v_vid;
  ELSE
    UPDATE public.vehicles SET has_open_issues = true WHERE id = v_vid;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_after_change ON public.maintenance;
CREATE TRIGGER maintenance_after_change
AFTER INSERT OR UPDATE OF date_completed ON public.maintenance
FOR EACH ROW EXECUTE FUNCTION public.maintenance_sync_vehicle_flag();