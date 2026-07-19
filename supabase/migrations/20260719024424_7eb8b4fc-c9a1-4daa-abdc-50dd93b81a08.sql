ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'Form',
  ADD COLUMN IF NOT EXISTS admin_notes TEXT;

UPDATE public.waitlist_entries SET source = 'Form' WHERE source IS NULL;