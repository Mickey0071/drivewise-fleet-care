CREATE TABLE public.reminder_log (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rental_id text NOT NULL,
  reminder_type text NOT NULL CHECK (reminder_type IN ('payment_due', 'rental_return')),
  target_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  phone text,
  message text,
  UNIQUE (rental_id, reminder_type, target_date)
);

ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read reminder_log"
  ON public.reminder_log FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role writes reminder_log"
  ON public.reminder_log FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX idx_reminder_log_rental ON public.reminder_log(rental_id, target_date);