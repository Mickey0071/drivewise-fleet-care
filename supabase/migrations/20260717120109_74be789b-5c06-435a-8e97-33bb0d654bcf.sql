
CREATE TABLE IF NOT EXISTS public.mechanics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  phone text NOT NULL,
  shop text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.mechanics TO authenticated;
GRANT ALL ON public.mechanics TO service_role;

ALTER TABLE public.mechanics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read mechanics" ON public.mechanics
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert mechanics" ON public.mechanics
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update mechanics" ON public.mechanics
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete mechanics" ON public.mechanics
  FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_mechanics_updated_at
  BEFORE UPDATE ON public.mechanics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS preferred_mechanic_id uuid REFERENCES public.mechanics(id) ON DELETE SET NULL;
