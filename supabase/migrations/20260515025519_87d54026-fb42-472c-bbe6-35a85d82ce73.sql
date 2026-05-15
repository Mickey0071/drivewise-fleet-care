
CREATE TABLE public.rental_share_links (
  token text PRIMARY KEY,
  vehicle_id text NOT NULL,
  start_date date NOT NULL,
  billing_period text NOT NULL DEFAULT 'weekly',
  rate numeric NOT NULL DEFAULT 0,
  weekly_rate numeric NOT NULL DEFAULT 0,
  daily_rate numeric NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  consumed_rental_id text,
  consumed_at timestamptz,
  created_by uuid
);

CREATE INDEX idx_rental_share_links_vehicle ON public.rental_share_links (vehicle_id);
CREATE INDEX idx_rental_share_links_expires ON public.rental_share_links (expires_at);

ALTER TABLE public.rental_share_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read share links"
  ON public.rental_share_links FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write share links"
  ON public.rental_share_links FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Public lookup function (used by the customer-facing rental page).
-- Returns only non-PII vehicle/terms info; never exposes admin data.
CREATE OR REPLACE FUNCTION public.get_share_link_public(_token text)
RETURNS TABLE (
  token text,
  vehicle_id text,
  start_date date,
  billing_period text,
  rate numeric,
  weekly_rate numeric,
  daily_rate numeric,
  notes text,
  expires_at timestamptz,
  consumed boolean,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_image_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.token,
    s.vehicle_id,
    s.start_date,
    s.billing_period,
    s.rate,
    s.weekly_rate,
    s.daily_rate,
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
$$;

GRANT EXECUTE ON FUNCTION public.get_share_link_public(text) TO anon, authenticated;
