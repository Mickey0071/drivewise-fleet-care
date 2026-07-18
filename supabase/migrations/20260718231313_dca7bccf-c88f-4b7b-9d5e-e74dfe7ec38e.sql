CREATE TABLE public.reservation_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('note','incident')),
  description TEXT NOT NULL,
  problem_category TEXT,
  created_by TEXT,
  maintenance_id TEXT REFERENCES public.maintenance(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX reservation_log_reservation_id_idx ON public.reservation_log(reservation_id, created_at DESC);
CREATE INDEX reservation_log_maintenance_id_idx ON public.reservation_log(maintenance_id);

GRANT SELECT, INSERT ON public.reservation_log TO authenticated;
GRANT ALL ON public.reservation_log TO service_role;

ALTER TABLE public.reservation_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read reservation log"
  ON public.reservation_log FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated can insert reservation log"
  ON public.reservation_log FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Append-only: no UPDATE or DELETE policies. RLS blocks by default.
