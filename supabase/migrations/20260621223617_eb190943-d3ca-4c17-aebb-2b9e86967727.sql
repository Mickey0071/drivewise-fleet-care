ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS prior_balance numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.rentals.prior_balance IS 'Documented balance carried forward from a previous rental that was not entered at booking. Adds to amount owed in the canonical balance engine.';