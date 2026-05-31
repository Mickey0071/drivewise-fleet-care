-- Repo task tracking fields on tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS rp_reason text,
  ADD COLUMN IF NOT EXISTS rp_customer_name text,
  ADD COLUMN IF NOT EXISTS rp_customer_phone text,
  ADD COLUMN IF NOT EXISTS rp_tow_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rp_status_checklist jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rp_odometer integer,
  ADD COLUMN IF NOT EXISTS rp_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rp_pickup_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS rp_location_after text,
  ADD COLUMN IF NOT EXISTS rp_notes text;

-- Repo tracking fields on vehicles
ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS repo_location text,
  ADD COLUMN IF NOT EXISTS repo_date date;