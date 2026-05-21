ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_method_id text,
  ADD COLUMN IF NOT EXISTS cardholder_name text,
  ADD COLUMN IF NOT EXISTS name_match_status text,
  ADD COLUMN IF NOT EXISTS name_match_score numeric;