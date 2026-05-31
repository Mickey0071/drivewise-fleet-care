ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS field_token text,
  ADD COLUMN IF NOT EXISTS field_submitted_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS work_orders_field_token_key
  ON public.work_orders (field_token)
  WHERE field_token IS NOT NULL;