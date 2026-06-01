CREATE TABLE public.payment_link_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rental_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  reason TEXT,
  channels TEXT[] NOT NULL DEFAULT '{}',
  link_url TEXT,
  custom_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_link_logs TO authenticated;
GRANT ALL ON public.payment_link_logs TO service_role;

ALTER TABLE public.payment_link_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view payment link logs"
ON public.payment_link_logs
FOR SELECT
TO authenticated
USING (true);

CREATE INDEX idx_payment_link_logs_rental ON public.payment_link_logs (rental_id, created_at DESC);