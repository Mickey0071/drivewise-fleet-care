CREATE TABLE public.receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number text NOT NULL DEFAULT ('RC-' || to_char(now(),'YYYYMMDD') || '-' || substr(md5(random()::text),1,5)),
  rental_id text,
  customer_name text,
  customer_phone text,
  customer_email text,
  vehicle_label text,
  receipt_date date NOT NULL DEFAULT current_date,
  period_start date,
  period_end date,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  tax_rate numeric NOT NULL DEFAULT 6.625,
  subtotal numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  amount_paid numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.receipts TO authenticated;
GRANT ALL ON public.receipts TO service_role;
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff manage receipts" ON public.receipts FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'))
WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'va'));
CREATE INDEX receipts_rental_idx ON public.receipts(rental_id);
CREATE TRIGGER receipts_touch BEFORE UPDATE ON public.receipts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();