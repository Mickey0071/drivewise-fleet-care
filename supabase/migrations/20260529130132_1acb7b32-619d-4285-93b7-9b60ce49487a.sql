ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS portal_link_sends jsonb NOT NULL DEFAULT '[]'::jsonb;