ALTER TABLE public.runner_tasks
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS completion_ack_at timestamptz;