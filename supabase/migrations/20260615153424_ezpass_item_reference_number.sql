ALTER TABLE public.ezpass_batch_items
  ADD COLUMN IF NOT EXISTS reference_number text;
