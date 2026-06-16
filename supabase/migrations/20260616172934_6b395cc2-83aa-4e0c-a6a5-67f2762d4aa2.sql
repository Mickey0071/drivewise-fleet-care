ALTER TABLE public.rental_share_links ADD COLUMN IF NOT EXISTS deposit numeric NOT NULL DEFAULT 0;

DROP FUNCTION IF EXISTS public.get_share_link_public(text);

CREATE OR REPLACE FUNCTION public.get_share_link_public(_token text)
 RETURNS TABLE(token text, vehicle_id text, start_date date, billing_period text, rate numeric, weekly_rate numeric, daily_rate numeric, deposit numeric, notes text, expires_at timestamp with time zone, consumed boolean, vehicle_make text, vehicle_model text, vehicle_year integer, vehicle_image_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    s.token,
    s.vehicle_id,
    s.start_date,
    s.billing_period,
    s.rate,
    s.weekly_rate,
    s.daily_rate,
    s.deposit,
    s.notes,
    s.expires_at,
    (s.consumed_rental_id IS NOT NULL) AS consumed,
    v.make AS vehicle_make,
    v.model AS vehicle_model,
    v.year AS vehicle_year,
    v.image_url AS vehicle_image_url
  FROM public.rental_share_links s
  LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
  WHERE s.token = _token
    AND s.expires_at > now();
$function$;