ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS runner_id uuid,
  ADD COLUMN IF NOT EXISTS repair_request_notes text,
  ADD COLUMN IF NOT EXISTS approval_status text,
  ADD COLUMN IF NOT EXISTS approval_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS approved_by uuid;