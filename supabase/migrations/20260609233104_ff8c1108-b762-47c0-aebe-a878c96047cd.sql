CREATE TABLE public.import_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'fleet_finesse',
  file_name text,
  rows_total integer NOT NULL DEFAULT 0,
  drivers_created integer NOT NULL DEFAULT 0,
  drivers_matched integer NOT NULL DEFAULT 0,
  rentals_created integer NOT NULL DEFAULT 0,
  rentals_skipped integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  unmatched_plates text[],
  errors text[],
  status text NOT NULL DEFAULT 'completed',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.import_logs TO authenticated;
GRANT ALL ON public.import_logs TO service_role;

ALTER TABLE public.import_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view import logs"
ON public.import_logs FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated can insert import logs"
ON public.import_logs FOR INSERT TO authenticated WITH CHECK (true);