ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS renewal_link_sent BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS renewal_link_sent_at TIMESTAMPTZ;