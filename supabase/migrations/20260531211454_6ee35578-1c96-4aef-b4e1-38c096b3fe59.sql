ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS pr_vendor_name text,
  ADD COLUMN IF NOT EXISTS pr_contact_phone text,
  ADD COLUMN IF NOT EXISTS pr_parts_needed text,
  ADD COLUMN IF NOT EXISTS pr_destination text,
  ADD COLUMN IF NOT EXISTS pr_parts_picked_up jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pr_cost numeric,
  ADD COLUMN IF NOT EXISTS pr_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS pr_pickup_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS pr_delivered_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS pr_delivery_notes text;