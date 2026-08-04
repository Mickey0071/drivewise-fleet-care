CREATE TABLE public.vehicle_mileage_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id text NOT NULL,
  old_mileage integer,
  new_mileage integer NOT NULL,
  applied boolean NOT NULL DEFAULT true,
  source text NOT NULL,
  actor text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicle_mileage_log_vehicle ON public.vehicle_mileage_log (vehicle_id, created_at DESC);
GRANT SELECT, INSERT ON public.vehicle_mileage_log TO authenticated;
GRANT ALL ON public.vehicle_mileage_log TO service_role;
ALTER TABLE public.vehicle_mileage_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view mileage log" ON public.vehicle_mileage_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can add mileage log" ON public.vehicle_mileage_log FOR INSERT TO authenticated WITH CHECK (true);