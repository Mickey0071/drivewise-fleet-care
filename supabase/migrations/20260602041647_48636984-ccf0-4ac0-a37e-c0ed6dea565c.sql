ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS card_brand text,
  ADD COLUMN IF NOT EXISTS card_exp_month integer,
  ADD COLUMN IF NOT EXISTS card_exp_year integer;