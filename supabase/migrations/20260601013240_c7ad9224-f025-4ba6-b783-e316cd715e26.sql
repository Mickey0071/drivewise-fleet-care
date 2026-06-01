ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS tr_from_address text,
  ADD COLUMN IF NOT EXISTS tr_to_address text,
  ADD COLUMN IF NOT EXISTS tr_reason text,
  ADD COLUMN IF NOT EXISTS tr_instructions text,
  ADD COLUMN IF NOT EXISTS tr_mileage_pickup integer,
  ADD COLUMN IF NOT EXISTS tr_mileage_dropoff integer,
  ADD COLUMN IF NOT EXISTS tr_photos_pickup jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tr_photos_dropoff jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS tr_pickup_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tr_dropoff_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS tr_delivered boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tr_notes text;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS current_location text,
  ADD COLUMN IF NOT EXISTS last_transport_at timestamp with time zone;

DELETE FROM public.tasks WHERE task_type IN ('pickup', 'dropoff');