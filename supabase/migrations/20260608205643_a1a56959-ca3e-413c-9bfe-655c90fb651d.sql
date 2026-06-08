-- Parts suppliers (junkyards / parts vendors)
CREATE TABLE public.parts_suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  phone text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.parts_suppliers TO authenticated;
GRANT ALL ON public.parts_suppliers TO service_role;

ALTER TABLE public.parts_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view suppliers"
  ON public.parts_suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage suppliers"
  ON public.parts_suppliers FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Part inquiries (sent to a supplier for a price quote)
CREATE TABLE public.part_inquiries (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  token text NOT NULL UNIQUE,
  supplier_id uuid REFERENCES public.parts_suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  supplier_phone text,
  part_name text NOT NULL,
  vin text,
  plate text,
  year integer,
  make text,
  model text,
  sub_model text,
  notes text,
  status text NOT NULL DEFAULT 'pending',
  quote_price numeric,
  quote_availability text,
  quote_notes text,
  quoted_at timestamptz,
  link_sent_at timestamptz,
  sent_by uuid,
  viewed_at timestamptz,
  token_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.part_inquiries TO authenticated;
GRANT ALL ON public.part_inquiries TO service_role;

ALTER TABLE public.part_inquiries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage part inquiries"
  ON public.part_inquiries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Update triggers
CREATE TRIGGER trg_parts_suppliers_updated
  BEFORE UPDATE ON public.parts_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_part_inquiries_updated
  BEFORE UPDATE ON public.part_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Public token resolver for the supplier-facing quote page
CREATE OR REPLACE FUNCTION public.get_part_inquiry_public(_token text)
RETURNS TABLE(
  token text, supplier_name text, part_name text,
  vin text, plate text, year integer, make text, model text, sub_model text,
  notes text, status text, quote_price numeric, quote_availability text,
  quote_notes text, expired boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    pi.token, pi.supplier_name, pi.part_name,
    pi.vin, pi.plate, pi.year, pi.make, pi.model, pi.sub_model,
    pi.notes, pi.status, pi.quote_price, pi.quote_availability, pi.quote_notes,
    (pi.token_expires_at IS NOT NULL AND pi.token_expires_at < now()) AS expired
  FROM public.part_inquiries pi
  WHERE pi.token = _token
  LIMIT 1;
$$;