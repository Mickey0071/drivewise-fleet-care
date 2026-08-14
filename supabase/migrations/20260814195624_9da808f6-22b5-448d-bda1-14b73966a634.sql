CREATE TABLE public.violation_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id text NOT NULL,
  reservation_id text NOT NULL,
  override_start_date date,
  override_end_date date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (violation_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.violation_matches TO authenticated;
GRANT ALL ON public.violation_matches TO service_role;

ALTER TABLE public.violation_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read violation matches"
  ON public.violation_matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can write violation matches"
  ON public.violation_matches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update violation matches"
  ON public.violation_matches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete violation matches"
  ON public.violation_matches FOR DELETE TO authenticated USING (true);

CREATE INDEX idx_violation_matches_reservation ON public.violation_matches (reservation_id);

CREATE TRIGGER trg_violation_matches_updated_at
  BEFORE UPDATE ON public.violation_matches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();