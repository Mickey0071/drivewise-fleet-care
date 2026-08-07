CREATE TABLE public.plate_renter_matches (
  plate text PRIMARY KEY,
  driver_id text NOT NULL,
  renter_name text NOT NULL,
  agreement_path text,
  agreement_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.plate_renter_matches TO authenticated;
GRANT ALL ON public.plate_renter_matches TO service_role;

ALTER TABLE public.plate_renter_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view plate matches"
  ON public.plate_renter_matches FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated staff can create plate matches"
  ON public.plate_renter_matches FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated staff can update plate matches"
  ON public.plate_renter_matches FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated staff can delete plate matches"
  ON public.plate_renter_matches FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_plate_renter_matches_updated_at
  BEFORE UPDATE ON public.plate_renter_matches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();