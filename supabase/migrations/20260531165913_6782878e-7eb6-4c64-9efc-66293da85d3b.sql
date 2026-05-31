ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS blocked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS block_reason text,
  ADD COLUMN IF NOT EXISTS blocked_at timestamptz;