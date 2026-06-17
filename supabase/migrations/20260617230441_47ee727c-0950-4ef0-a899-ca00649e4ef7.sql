ALTER TABLE public.extension_requests
  ADD COLUMN IF NOT EXISTS rental_extension_id text,
  ADD COLUMN IF NOT EXISTS applied_payment_id text,
  ADD COLUMN IF NOT EXISTS applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS charge_state text;