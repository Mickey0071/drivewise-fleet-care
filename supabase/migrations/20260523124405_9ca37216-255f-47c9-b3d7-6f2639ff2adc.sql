
-- Extension requests: admin creates one, renter signs+pays via /extend/<token>
CREATE TABLE public.extension_requests (
  id text PRIMARY KEY DEFAULT ('ext_req_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  token text NOT NULL UNIQUE,
  rental_id text NOT NULL,
  periods integer NOT NULL,
  period_label text NOT NULL DEFAULT 'week',
  previous_end_date date,
  new_end_date date NOT NULL,
  additional_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | signed | paid | expired | cancelled
  signature_data_url text,
  signed_by text,
  signed_at timestamptz,
  payment_link_url text,
  stripe_session_id text,
  stripe_payment_link_id text,
  paid_at timestamptz,
  rental_extension_id text,
  payment_id text,
  agreement_version text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days')
);

CREATE INDEX idx_extension_requests_rental ON public.extension_requests(rental_id);
CREATE INDEX idx_extension_requests_token ON public.extension_requests(token);

ALTER TABLE public.extension_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage extension_requests"
  ON public.extension_requests FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Staff read extension_requests"
  ON public.extension_requests FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'runner'::app_role));

CREATE POLICY "Service role manages extension_requests"
  ON public.extension_requests FOR ALL TO public
  USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE TRIGGER trg_ext_req_touch_updated_at
  BEFORE UPDATE ON public.extension_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Public lookup (no auth) for the /extend/<token> page
CREATE OR REPLACE FUNCTION public.get_extension_request_public(_token text)
RETURNS TABLE(
  token text,
  rental_id text,
  periods integer,
  period_label text,
  previous_end_date date,
  new_end_date date,
  additional_amount numeric,
  status text,
  expires_at timestamptz,
  signed_at timestamptz,
  paid_at timestamptz,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_plate text,
  driver_full_name text,
  rate numeric,
  weekly_rate numeric,
  billing_period text
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    er.token, er.rental_id, er.periods, er.period_label,
    er.previous_end_date, er.new_end_date, er.additional_amount,
    er.status, er.expires_at, er.signed_at, er.paid_at,
    v.make, v.model, v.year, v.plate,
    d.full_name, r.rate, r.weekly_rate, r.billing_period
  FROM public.extension_requests er
  JOIN public.rentals r ON r.id = er.rental_id
  LEFT JOIN public.vehicles v ON v.id = r.vehicle_id
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  WHERE er.token = _token AND er.expires_at > now();
$$;
