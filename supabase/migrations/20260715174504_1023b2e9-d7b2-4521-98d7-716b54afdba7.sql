
CREATE TABLE public.waitlist_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  license_url TEXT,
  selfie_url TEXT,
  status TEXT NOT NULL DEFAULT 'Waitlisted',
  converted_rental_id TEXT,
  converted_at TIMESTAMPTZ,
  admin_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.waitlist_entries TO authenticated;
GRANT ALL ON public.waitlist_entries TO service_role;

ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view waitlist entries"
  ON public.waitlist_entries FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can update waitlist entries"
  ON public.waitlist_entries FOR UPDATE
  TO authenticated
  USING (true) WITH CHECK (true);

CREATE POLICY "Authenticated users can delete waitlist entries"
  ON public.waitlist_entries FOR DELETE
  TO authenticated
  USING (true);

CREATE TRIGGER update_waitlist_entries_updated_at
  BEFORE UPDATE ON public.waitlist_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX waitlist_entries_status_created_idx
  ON public.waitlist_entries (status, created_at);
