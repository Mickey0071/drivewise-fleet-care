ALTER TABLE public.vehicles
ADD COLUMN IF NOT EXISTS maintenance_settings jsonb NOT NULL DEFAULT '{}'::jsonb;