ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS legacy_id text;

ALTER TABLE public.rentals DROP CONSTRAINT IF EXISTS rentals_legacy_id_check;
ALTER TABLE public.rentals ADD CONSTRAINT rentals_legacy_id_check
  CHECK (legacy_id IS NULL OR legacy_id IN ('fleet-finesse','manual-historic'));

CREATE INDEX IF NOT EXISTS rentals_legacy_id_idx ON public.rentals (legacy_id);

UPDATE public.rentals
SET legacy_id = 'manual-historic'
WHERE legacy_id IS NULL AND (source = 'historic_entry' OR import_source = 'historic_entry');