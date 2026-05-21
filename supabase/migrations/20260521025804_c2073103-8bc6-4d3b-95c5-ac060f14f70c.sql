ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS receipt_pdf_url text,
  ADD COLUMN IF NOT EXISTS receipt_pdf_generated_at timestamp with time zone;