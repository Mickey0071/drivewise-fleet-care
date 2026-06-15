ALTER TABLE public.legacy_rentals
  ADD COLUMN IF NOT EXISTS plate_inferred_from_vehicle boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plate_needs_review boolean NOT NULL DEFAULT false;