CREATE OR REPLACE FUNCTION public.maintenance_sync_vehicle_flag()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_vid TEXT;
  v_open INT;
BEGIN
  v_vid := COALESCE(NEW.vehicle_id, OLD.vehicle_id);
  SELECT COUNT(*) INTO v_open FROM public.maintenance
    WHERE vehicle_id = v_vid
      AND date_completed IS NULL
      AND (
        status IS NULL
        OR (status <> 'complete' AND is_rental_blocking = true)
      );
  IF v_open = 0 THEN
    UPDATE public.vehicles SET has_open_issues = false WHERE id = v_vid;
  ELSE
    UPDATE public.vehicles SET has_open_issues = true WHERE id = v_vid;
  END IF;
  RETURN NEW;
END;
$function$;