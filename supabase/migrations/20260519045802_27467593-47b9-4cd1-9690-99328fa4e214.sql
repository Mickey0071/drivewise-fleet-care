ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS agreement_pdf_url TEXT;
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS agreement_pdf_generated_at TIMESTAMPTZ;