CREATE TABLE public.vehicle_photos (
  id text PRIMARY KEY DEFAULT ('vph_' || substr(gen_random_uuid()::text, 1, 12)),
  vehicle_id text NOT NULL,
  url text NOT NULL,
  caption text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_vehicle_photos_vehicle_id ON public.vehicle_photos(vehicle_id);

ALTER TABLE public.vehicle_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read vehicle_photos"
ON public.vehicle_photos FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated write vehicle_photos"
ON public.vehicle_photos FOR ALL TO authenticated USING (true) WITH CHECK (true);