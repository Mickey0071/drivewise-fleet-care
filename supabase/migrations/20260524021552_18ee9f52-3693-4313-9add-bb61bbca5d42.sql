ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS staff_review_status text;
CREATE INDEX IF NOT EXISTS rentals_staff_review_status_idx ON public.rentals (staff_review_status) WHERE staff_review_status IS NOT NULL;
UPDATE public.rentals
  SET staff_review_status = 'pending'
  WHERE staff_review_status IS NULL
    AND client_signature_url IS NOT NULL
    AND payment_received = false;