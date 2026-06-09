ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS tags text;
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS tags text;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS import_source text;
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS import_source text;