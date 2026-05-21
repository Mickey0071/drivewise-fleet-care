CREATE TABLE IF NOT EXISTS public.rental_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  charge_date timestamptz NOT NULL DEFAULT now(),
  period_label text,
  status text NOT NULL,
  error_msg text,
  stripe_payment_intent_id text,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_charges_rental_id ON public.rental_charges(rental_id);
CREATE INDEX IF NOT EXISTS idx_rental_charges_status ON public.rental_charges(status);
CREATE INDEX IF NOT EXISTS idx_rental_charges_charge_date ON public.rental_charges(charge_date DESC);

ALTER TABLE public.rental_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read rental_charges"
  ON public.rental_charges FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service role manages rental_charges"
  ON public.rental_charges FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');