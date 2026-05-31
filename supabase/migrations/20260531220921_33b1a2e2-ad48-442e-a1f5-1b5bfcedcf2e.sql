ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS dr_service text,
  ADD COLUMN IF NOT EXISTS dr_documents_needed jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dr_location text,
  ADD COLUMN IF NOT EXISTS dr_expected_cost numeric,
  ADD COLUMN IF NOT EXISTS dr_documents_packed jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dr_arrival_at timestamptz,
  ADD COLUMN IF NOT EXISTS dr_service_completed jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dr_actual_cost numeric,
  ADD COLUMN IF NOT EXISTS dr_documents_received jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS dr_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS dr_completion_at timestamptz,
  ADD COLUMN IF NOT EXISTS dr_new_reg_expiry date,
  ADD COLUMN IF NOT EXISTS dr_new_sticker_expiry date,
  ADD COLUMN IF NOT EXISTS dr_notes text;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS inspection_sticker_expiry date,
  ADD COLUMN IF NOT EXISTS last_dmv_service_at date;