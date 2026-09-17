ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS docs_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_approved_by uuid,
  ADD COLUMN IF NOT EXISTS docs_rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS docs_rejection_reason text,
  ADD COLUMN IF NOT EXISTS license_number text,
  ADD COLUMN IF NOT EXISTS license_expiration text,
  ADD COLUMN IF NOT EXISTS link_sent_at timestamptz;