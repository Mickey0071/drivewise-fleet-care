ALTER TABLE public.maintenance
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS issue_description text,
  ADD COLUMN IF NOT EXISTS solutions jsonb,
  ADD COLUMN IF NOT EXISTS selected_solution jsonb,
  ADD COLUMN IF NOT EXISTS down_payment numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS completion_date timestamp with time zone;