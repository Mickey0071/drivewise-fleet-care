ALTER TABLE public.legacy_rentals
  ADD COLUMN IF NOT EXISTS promoted_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS promoted_rental_id text,
  ADD COLUMN IF NOT EXISTS promoted_driver_id text,
  ADD COLUMN IF NOT EXISTS promotion_note text;