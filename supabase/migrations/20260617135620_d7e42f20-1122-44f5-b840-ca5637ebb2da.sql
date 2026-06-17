ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS stripe_charge_id text,
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS stripe_event_id text;

CREATE UNIQUE INDEX IF NOT EXISTS payments_stripe_charge_id_uniq
  ON public.payments (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;