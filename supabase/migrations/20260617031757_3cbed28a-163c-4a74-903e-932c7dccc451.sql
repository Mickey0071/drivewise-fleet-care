ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS last_auto_renew_date date,
  ADD COLUMN IF NOT EXISTS extension_declined_at timestamptz;