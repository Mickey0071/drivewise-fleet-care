CREATE TABLE public.refund_requests (
  id text NOT NULL PRIMARY KEY DEFAULT ('rfr_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
  rental_id text NOT NULL,
  payment_id text,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_role text NOT NULL,
  requester_name text,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text,
  status text NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_refund_id text,
  denial_reason text,
  error text,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refund_requests_status_idx ON public.refund_requests(status);
CREATE INDEX refund_requests_rental_idx ON public.refund_requests(rental_id);

CREATE TRIGGER refund_requests_touch_updated_at
  BEFORE UPDATE ON public.refund_requests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.refund_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage refund_requests"
  ON public.refund_requests FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "VAs insert own refund_requests"
  ON public.refund_requests FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'va'::app_role)
    AND requested_by = auth.uid()
  );

CREATE POLICY "VAs read own refund_requests"
  ON public.refund_requests FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'va'::app_role)
    AND requested_by = auth.uid()
  );

CREATE POLICY "Service role manages refund_requests"
  ON public.refund_requests FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');