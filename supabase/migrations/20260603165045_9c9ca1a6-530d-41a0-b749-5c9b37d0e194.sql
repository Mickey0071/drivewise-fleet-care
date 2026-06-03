ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS customer_notes text,
  ADD COLUMN IF NOT EXISTS diagnosis_notes text,
  ADD COLUMN IF NOT EXISTS created_from_issue boolean NOT NULL DEFAULT false;