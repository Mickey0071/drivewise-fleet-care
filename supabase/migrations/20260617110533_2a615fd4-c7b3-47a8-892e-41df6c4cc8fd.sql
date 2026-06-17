ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS accident_report jsonb,
  ADD COLUMN IF NOT EXISTS accident_token text;

CREATE UNIQUE INDEX IF NOT EXISTS rentals_accident_token_key
  ON public.rentals (accident_token)
  WHERE accident_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_accident_intake_public(_token text)
RETURNS TABLE(
  rental_id text,
  vehicle text,
  plate text,
  driver_full_name text,
  start_date date,
  end_date date,
  accident_report jsonb
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id,
    trim(concat_ws(' ', v.year::text, v.make, v.model)),
    v.plate,
    d.full_name,
    r.start_date,
    r.end_date,
    r.accident_report
  FROM public.rentals r
  LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  WHERE r.accident_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_accident_intake_public(text) TO anon, authenticated;