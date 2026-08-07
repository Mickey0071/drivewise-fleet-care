ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS renewal_link_sent BOOLEAN DEFAULT false;
ALTER TABLE public.rentals ADD COLUMN IF NOT EXISTS renewal_link_sent_at TIMESTAMP WITH TIME ZONE;