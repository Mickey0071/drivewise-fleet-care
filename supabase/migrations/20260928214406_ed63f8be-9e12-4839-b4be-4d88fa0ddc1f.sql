CREATE OR REPLACE FUNCTION public.vehicles_paperwork_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status = 'available' AND (COALESCE(NEW.registration_missing,false) OR COALESCE(NEW.tags_missing,false))
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'available'
          OR OLD.registration_missing IS DISTINCT FROM NEW.registration_missing
          OR OLD.tags_missing IS DISTINCT FROM NEW.tags_missing) THEN
    RAISE EXCEPTION 'Vehicle cannot be set to Available until missing % are resolved',
      CASE WHEN NEW.registration_missing AND NEW.tags_missing THEN 'registration and tags'
           WHEN NEW.registration_missing THEN 'registration' ELSE 'tags' END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_vehicles_paperwork_gate BEFORE INSERT OR UPDATE ON public.vehicles
  FOR EACH ROW EXECUTE FUNCTION public.vehicles_paperwork_gate();