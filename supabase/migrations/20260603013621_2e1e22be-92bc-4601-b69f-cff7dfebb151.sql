ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS is_rental_blocking boolean NOT NULL DEFAULT false;