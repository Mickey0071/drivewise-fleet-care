-- Authority addresses for liability-transfer mail packets
CREATE TABLE public.authority_addresses (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  address_lines text,
  region text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.authority_addresses TO authenticated;
GRANT ALL ON public.authority_addresses TO service_role;

ALTER TABLE public.authority_addresses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view authority addresses"
  ON public.authority_addresses FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert authority addresses"
  ON public.authority_addresses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update authority addresses"
  ON public.authority_addresses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated can delete authority addresses"
  ON public.authority_addresses FOR DELETE TO authenticated USING (true);

CREATE TRIGGER trg_authority_addresses_updated_at
  BEFORE UPDATE ON public.authority_addresses
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.authority_addresses (key, name, address_lines, region) VALUES
  ('nj_ezpass', 'NJ E-ZPass Violation Processing Center', 'NJ E-ZPass' || chr(10) || 'P.O. Box 4971' || chr(10) || 'Trenton, NJ 08650', 'NJ'),
  ('nj_turnpike', 'NJ Turnpike Authority', '', 'NJ'),
  ('ny_ezpass', 'NY E-ZPass Service Center', '', 'NY'),
  ('pa_turnpike', 'PA Turnpike Commission', '', 'PA'),
  ('nj_mvc', 'NJ Motor Vehicle Commission', '', 'NJ');

-- Liability-transfer / tracking columns on violations
ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS liability_transfer_generated_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS liability_transfer_pdf_url text,
  ADD COLUMN IF NOT EXISTS mail_packet_printed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS mailed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS transfer_confirmed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS authority_key text,
  ADD COLUMN IF NOT EXISTS final_warning_sent_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS violation_time text,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS reference_number text;