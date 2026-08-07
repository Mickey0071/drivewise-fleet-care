ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'app';
ALTER TABLE public.violations ADD COLUMN IF NOT EXISTS agreement_pdf_url text;
ALTER TABLE public.violations ADD COLUMN IF NOT EXISTS agreement_signed_date date;