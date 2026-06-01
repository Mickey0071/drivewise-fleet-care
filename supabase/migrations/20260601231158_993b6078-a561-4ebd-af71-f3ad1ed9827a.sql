ALTER TABLE public.extension_requests
  ADD COLUMN IF NOT EXISTS name_match_status text,
  ADD COLUMN IF NOT EXISTS name_match_score numeric,
  ADD COLUMN IF NOT EXISTS cardholder_name text;

CREATE INDEX IF NOT EXISTS idx_rentals_name_match_status ON public.rentals(name_match_status);
CREATE INDEX IF NOT EXISTS idx_extension_requests_name_match_status ON public.extension_requests(name_match_status);