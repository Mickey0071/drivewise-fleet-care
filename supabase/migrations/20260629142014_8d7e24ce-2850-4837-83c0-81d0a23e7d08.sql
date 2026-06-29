CREATE TABLE public.runners (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (phone)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.runners TO authenticated;
GRANT ALL ON public.runners TO service_role;

ALTER TABLE public.runners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view runners"
  ON public.runners FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can add runners"
  ON public.runners FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update runners"
  ON public.runners FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete runners"
  ON public.runners FOR DELETE TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$
LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_runners_updated_at BEFORE UPDATE ON public.runners
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();