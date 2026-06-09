ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS accept_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS decline_token text UNIQUE,
  ADD COLUMN IF NOT EXISTS accepted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS accepted_by text,
  ADD COLUMN IF NOT EXISTS declined_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS declined_by text,
  ADD COLUMN IF NOT EXISTS decline_reason text,
  ADD COLUMN IF NOT EXISTS decline_notes text,
  ADD COLUMN IF NOT EXISTS action_taken text NOT NULL DEFAULT 'pending';

CREATE OR REPLACE FUNCTION public.get_repair_action_public(_token text)
 RETURNS TABLE(
   id text, action_taken text, status text,
   vehicle_year integer, vehicle_make text, vehicle_model text, vehicle_plate text,
   issue_description text, parts_list jsonb, parts_cost numeric, labor_cost numeric, cost numeric,
   mechanic_name text, mechanic_phone text, is_accept boolean, is_decline boolean
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    m.id, m.action_taken, m.status,
    v.year, v.make, v.model, v.plate,
    COALESCE(m.issue_description, m.service_type),
    m.parts_list, m.parts_cost, m.labor_cost, m.cost,
    m.mechanic_name, m.mechanic_phone,
    (m.accept_token = _token) AS is_accept,
    (m.decline_token = _token) AS is_decline
  FROM public.maintenance m
  LEFT JOIN public.vehicles v ON v.id = m.vehicle_id
  WHERE m.accept_token = _token OR m.decline_token = _token
  LIMIT 1;
$function$;