CREATE TABLE public.service_types (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_types TO authenticated;
GRANT ALL ON public.service_types TO service_role;

ALTER TABLE public.service_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view service types"
ON public.service_types FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert service types"
ON public.service_types FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Authenticated can update service types"
ON public.service_types FOR UPDATE TO authenticated USING (true);

CREATE POLICY "Authenticated can delete service types"
ON public.service_types FOR DELETE TO authenticated USING (true);

INSERT INTO public.service_types (name, sort_order) VALUES
  ('Oil Change', 0),
  ('Inspection', 1),
  ('Registration', 2),
  ('Other', 3)
ON CONFLICT (name) DO NOTHING;