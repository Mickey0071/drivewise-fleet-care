ALTER TABLE public.runner_tasks
  ADD COLUMN IF NOT EXISTS token text UNIQUE,
  ADD COLUMN IF NOT EXISTS runner_name text,
  ADD COLUMN IF NOT EXISTS runner_phone text,
  ADD COLUMN IF NOT EXISTS token_expires_at timestamp with time zone;

ALTER TABLE public.runner_tasks ALTER COLUMN runner_id DROP NOT NULL;

UPDATE public.runner_tasks
  SET status = 'archived'
  WHERE status IS DISTINCT FROM 'archived';