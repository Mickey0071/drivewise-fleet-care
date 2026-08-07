ALTER TABLE public.dispute_packets
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_via text NOT NULL DEFAULT 'upload';