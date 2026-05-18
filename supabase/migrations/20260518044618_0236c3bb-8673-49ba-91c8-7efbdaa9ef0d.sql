
-- Add pass/fail checklist columns to inspections
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS tires_status TEXT CHECK (tires_status IN ('pass','fail')),
  ADD COLUMN IF NOT EXISTS fluids_status TEXT CHECK (fluids_status IN ('pass','fail')),
  ADD COLUMN IF NOT EXISTS brakes_status TEXT CHECK (brakes_status IN ('pass','fail')),
  ADD COLUMN IF NOT EXISTS lights_status TEXT CHECK (lights_status IN ('pass','fail')),
  ADD COLUMN IF NOT EXISTS body_status TEXT CHECK (body_status IN ('pass','fail')),
  ADD COLUMN IF NOT EXISTS interior_status TEXT CHECK (interior_status IN ('pass','fail')),
  ADD COLUMN IF NOT EXISTS tires_notes TEXT,
  ADD COLUMN IF NOT EXISTS fluids_notes TEXT,
  ADD COLUMN IF NOT EXISTS brakes_notes TEXT,
  ADD COLUMN IF NOT EXISTS lights_notes TEXT,
  ADD COLUMN IF NOT EXISTS body_notes TEXT,
  ADD COLUMN IF NOT EXISTS interior_notes TEXT,
  ADD COLUMN IF NOT EXISTS inspector_name TEXT;

-- Vehicle flag for open issues
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS has_open_issues BOOLEAN NOT NULL DEFAULT false;

-- Maintenance link back to triggering inspection (TEXT to match inspections.id)
ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS source_inspection_id TEXT REFERENCES public.inspections(id) ON DELETE SET NULL;

-- Allow NULL date_completed (pending tickets)
ALTER TABLE public.maintenance ALTER COLUMN date_completed DROP NOT NULL;
ALTER TABLE public.maintenance ALTER COLUMN date_completed DROP DEFAULT;

-- Trigger function: auto-create maintenance ticket on failed inspection items
CREATE OR REPLACE FUNCTION public.handle_inspection_failures()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  failed_items TEXT[] := ARRAY[]::TEXT[];
  notes_parts TEXT[] := ARRAY[]::TEXT[];
  v_service TEXT;
  v_notes TEXT;
  v_mid TEXT;
BEGIN
  IF NEW.tires_status = 'fail' THEN
    failed_items := array_append(failed_items, 'Tires');
    IF NEW.tires_notes IS NOT NULL AND NEW.tires_notes <> '' THEN
      notes_parts := array_append(notes_parts, 'Tires: ' || NEW.tires_notes);
    END IF;
  END IF;
  IF NEW.fluids_status = 'fail' THEN
    failed_items := array_append(failed_items, 'Fluids');
    IF NEW.fluids_notes IS NOT NULL AND NEW.fluids_notes <> '' THEN
      notes_parts := array_append(notes_parts, 'Fluids: ' || NEW.fluids_notes);
    END IF;
  END IF;
  IF NEW.brakes_status = 'fail' THEN
    failed_items := array_append(failed_items, 'Brakes');
    IF NEW.brakes_notes IS NOT NULL AND NEW.brakes_notes <> '' THEN
      notes_parts := array_append(notes_parts, 'Brakes: ' || NEW.brakes_notes);
    END IF;
  END IF;
  IF NEW.lights_status = 'fail' THEN
    failed_items := array_append(failed_items, 'Lights');
    IF NEW.lights_notes IS NOT NULL AND NEW.lights_notes <> '' THEN
      notes_parts := array_append(notes_parts, 'Lights: ' || NEW.lights_notes);
    END IF;
  END IF;
  IF NEW.body_status = 'fail' THEN
    failed_items := array_append(failed_items, 'Body');
    IF NEW.body_notes IS NOT NULL AND NEW.body_notes <> '' THEN
      notes_parts := array_append(notes_parts, 'Body: ' || NEW.body_notes);
    END IF;
  END IF;
  IF NEW.interior_status = 'fail' THEN
    failed_items := array_append(failed_items, 'Interior');
    IF NEW.interior_notes IS NOT NULL AND NEW.interior_notes <> '' THEN
      notes_parts := array_append(notes_parts, 'Interior: ' || NEW.interior_notes);
    END IF;
  END IF;

  IF NEW.damage_noted = true AND array_length(failed_items, 1) IS NULL THEN
    failed_items := array_append(failed_items, 'General damage');
  END IF;

  IF array_length(failed_items, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  v_service := 'Auto-generated from inspection: ' || array_to_string(failed_items, ', ');
  v_notes := COALESCE(NULLIF(array_to_string(notes_parts, E'\n'), ''), NULL);
  v_mid := 'MN-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.maintenance (
    id, vehicle_id, service_type, vendor, date_completed,
    mileage_at_service, cost, notes, source_inspection_id, next_service_due
  ) VALUES (
    v_mid, NEW.vehicle_id, v_service, 'Pending assignment', NULL,
    COALESCE(NEW.mileage, 0), 0, v_notes, NEW.id, CURRENT_DATE
  );

  UPDATE public.vehicles SET has_open_issues = true WHERE id = NEW.vehicle_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_inspection_failures ON public.inspections;
CREATE TRIGGER trg_inspection_failures
AFTER INSERT OR UPDATE ON public.inspections
FOR EACH ROW EXECUTE FUNCTION public.handle_inspection_failures();

-- Trigger function: clear has_open_issues when last open maintenance is closed
CREATE OR REPLACE FUNCTION public.handle_maintenance_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  open_count INT;
BEGIN
  IF NEW.date_completed IS NOT NULL AND (OLD.date_completed IS NULL OR OLD.date_completed IS DISTINCT FROM NEW.date_completed) THEN
    SELECT COUNT(*) INTO open_count
    FROM public.maintenance
    WHERE vehicle_id = NEW.vehicle_id AND date_completed IS NULL AND id <> NEW.id;
    IF open_count = 0 THEN
      UPDATE public.vehicles SET has_open_issues = false WHERE id = NEW.vehicle_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maintenance_close ON public.maintenance;
CREATE TRIGGER trg_maintenance_close
AFTER UPDATE ON public.maintenance
FOR EACH ROW EXECUTE FUNCTION public.handle_maintenance_close();
