CREATE TABLE public.renter_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id text REFERENCES public.drivers(id) ON DELETE SET NULL,
  phone text,
  message text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('sent','received')),
  sent_at timestamptz NOT NULL DEFAULT now(),
  ghl_message_id text UNIQUE,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.renter_messages TO authenticated;
GRANT ALL ON public.renter_messages TO service_role;

ALTER TABLE public.renter_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can read renter messages" ON public.renter_messages
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert renter messages" ON public.renter_messages
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Staff can update renter messages" ON public.renter_messages
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE INDEX idx_renter_messages_driver ON public.renter_messages(driver_id, sent_at DESC);
CREATE INDEX idx_renter_messages_unread ON public.renter_messages(driver_id) WHERE read = false AND direction = 'received';

CREATE TRIGGER trg_renter_messages_updated_at
  BEFORE UPDATE ON public.renter_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();