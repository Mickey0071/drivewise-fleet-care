ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS source text;
CREATE INDEX IF NOT EXISTS rentals_source_start_idx ON public.rentals (source, start_date DESC);