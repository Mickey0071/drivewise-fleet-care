CREATE TABLE public.refund_recovery (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rental_id TEXT,
  driver_id TEXT,
  amount NUMERIC NOT NULL DEFAULT 0,
  refunded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  stripe_charge_id TEXT,
  stripe_refund_id TEXT UNIQUE,
  source TEXT NOT NULL DEFAULT 'system',
  status TEXT NOT NULL DEFAULT 'needs_recovery',
  customer_notified BOOLEAN NOT NULL DEFAULT false,
  note TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.refund_recovery TO authenticated;
GRANT ALL ON public.refund_recovery TO service_role;

ALTER TABLE public.refund_recovery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated staff can view refund recovery"
  ON public.refund_recovery FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated staff can insert refund recovery"
  ON public.refund_recovery FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated staff can update refund recovery"
  ON public.refund_recovery FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER update_refund_recovery_updated_at
  BEFORE UPDATE ON public.refund_recovery
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();