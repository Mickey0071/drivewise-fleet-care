ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS discount_total numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.rentals.discount_total IS 'Total goodwill discount / balance waived on this reservation. Subtracted from amount owed in the canonical balance engine.';