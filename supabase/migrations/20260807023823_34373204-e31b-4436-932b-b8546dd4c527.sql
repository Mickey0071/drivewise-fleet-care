ALTER TABLE public.ezpass_batch_items
  ADD COLUMN IF NOT EXISTS document_type text,
  ADD COLUMN IF NOT EXISTS notice_date date,
  ADD COLUMN IF NOT EXISTS ocr_confidence numeric,
  ADD COLUMN IF NOT EXISTS requires_manual_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS extraction_details jsonb;

ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS notice_date date,
  ADD COLUMN IF NOT EXISTS document_type text;