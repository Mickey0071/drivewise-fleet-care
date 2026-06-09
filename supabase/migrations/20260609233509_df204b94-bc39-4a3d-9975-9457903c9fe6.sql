CREATE TABLE public.legacy_rentals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text,
  order_number text,
  vehicle text,
  year text,
  color text,
  plate text,
  renter_name text,
  pickup_location text,
  start_datetime timestamptz,
  end_datetime timestamptz,
  status text,
  notes text,
  agreement_pdf_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.legacy_rentals TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_rentals TO authenticated;
GRANT ALL ON public.legacy_rentals TO service_role;

ALTER TABLE public.legacy_rentals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read legacy rentals"
ON public.legacy_rentals FOR SELECT
USING (true);

CREATE POLICY "Authenticated can insert legacy rentals"
ON public.legacy_rentals FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update legacy rentals"
ON public.legacy_rentals FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated can delete legacy rentals"
ON public.legacy_rentals FOR DELETE TO authenticated USING (true);