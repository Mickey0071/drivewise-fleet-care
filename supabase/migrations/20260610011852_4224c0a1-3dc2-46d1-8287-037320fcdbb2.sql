CREATE TABLE public.legacy_customers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source text NOT NULL DEFAULT 'fleet_finesse',
  sn text,
  name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  address text,
  city text,
  state text,
  zip_code text,
  date_created text,
  status text,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.legacy_customers TO authenticated;
GRANT ALL ON public.legacy_customers TO service_role;

ALTER TABLE public.legacy_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view legacy customers"
  ON public.legacy_customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert legacy customers"
  ON public.legacy_customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update legacy customers"
  ON public.legacy_customers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete legacy customers"
  ON public.legacy_customers FOR DELETE TO authenticated USING (true);

CREATE TRIGGER update_legacy_customers_updated_at
  BEFORE UPDATE ON public.legacy_customers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();