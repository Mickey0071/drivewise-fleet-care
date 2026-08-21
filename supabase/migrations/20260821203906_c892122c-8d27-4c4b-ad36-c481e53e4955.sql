ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS rental_length text,
  ADD COLUMN IF NOT EXISTS rideshare_checkbox boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal';

ALTER TABLE public.waitlist_entries
  DROP CONSTRAINT IF EXISTS waitlist_entries_priority_check;
ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_priority_check CHECK (priority IN ('high', 'normal'));

UPDATE public.waitlist_entries SET priority = 'high' WHERE rideshare_proof_url IS NOT NULL AND priority = 'normal';