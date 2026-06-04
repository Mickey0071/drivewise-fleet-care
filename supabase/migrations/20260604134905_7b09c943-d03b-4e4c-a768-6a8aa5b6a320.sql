-- Track auto extension link sends on rentals
ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS extension_link_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extension_link_sent_date timestamptz;

-- Offers created by the daily cron; the customer chooses daily/weekly on /auto-extend/<token>
CREATE TABLE IF NOT EXISTS public.auto_extension_offers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  rental_id text NOT NULL,
  offer_type text NOT NULL DEFAULT 'daily',
  status text NOT NULL DEFAULT 'pending',
  extension_token text,
  extension_choice text,
  auto_pay_enabled boolean NOT NULL DEFAULT false,
  sent_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.auto_extension_offers TO authenticated;
GRANT ALL ON public.auto_extension_offers TO service_role;

ALTER TABLE public.auto_extension_offers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage auto extension offers"
  ON public.auto_extension_offers FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_auto_extension_offers_updated
  BEFORE UPDATE ON public.auto_extension_offers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS idx_auto_extension_offers_token ON public.auto_extension_offers(token);

-- Public RPC so the customer page can load a safe summary by token (no auth)
CREATE OR REPLACE FUNCTION public.get_auto_extension_offer_public(_token text)
RETURNS TABLE(
  token text,
  rental_id text,
  offer_type text,
  status text,
  extension_token text,
  expires_at timestamptz,
  consumed_at timestamptz,
  current_end_date date,
  billing_period text,
  rental_rate numeric,
  rental_weekly_rate numeric,
  vehicle_daily_rate numeric,
  vehicle_weekly_rate numeric,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_plate text,
  driver_full_name text
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    o.token,
    o.rental_id,
    o.offer_type,
    o.status,
    o.extension_token,
    o.expires_at,
    o.consumed_at,
    r.end_date,
    r.billing_period,
    r.rate,
    r.weekly_rate,
    v.daily_rate,
    v.weekly_rate,
    v.make,
    v.model,
    v.year,
    v.plate,
    d.full_name
  FROM public.auto_extension_offers o
  JOIN public.rentals r ON r.id = o.rental_id
  LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  WHERE o.token = _token
    AND o.expires_at > now();
$$;