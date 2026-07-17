
-- 1. New columns on violations to persist the generated Transfer packet.
ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS transfer_packet_url TEXT,
  ADD COLUMN IF NOT EXISTS transfer_packet_generated_at TIMESTAMPTZ;

-- 2. Singleton settings row for the reusable authorized signer + signature image.
CREATE TABLE IF NOT EXISTS public.packet_settings (
  id TEXT PRIMARY KEY DEFAULT 'default',
  signer_name TEXT NOT NULL DEFAULT 'Michael Campbell',
  signer_title TEXT NOT NULL DEFAULT 'Authorized Representative',
  signer_company TEXT NOT NULL DEFAULT 'Camauto Rentals / Rentalprise LLC',
  signature_url TEXT,
  default_authority TEXT NOT NULL DEFAULT 'NJ E-ZPass',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT packet_settings_singleton CHECK (id = 'default')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.packet_settings TO authenticated;
GRANT ALL ON public.packet_settings TO service_role;

ALTER TABLE public.packet_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read packet settings" ON public.packet_settings;
CREATE POLICY "Authenticated users can read packet settings"
  ON public.packet_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Authenticated users can write packet settings" ON public.packet_settings;
CREATE POLICY "Authenticated users can write packet settings"
  ON public.packet_settings FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Seed the singleton row so reads always return a value.
INSERT INTO public.packet_settings (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_packet_settings_updated_at ON public.packet_settings;
CREATE TRIGGER trg_packet_settings_updated_at
  BEFORE UPDATE ON public.packet_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
