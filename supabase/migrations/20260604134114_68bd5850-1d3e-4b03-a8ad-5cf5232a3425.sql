CREATE TABLE public.notification_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  notification_type TEXT NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT true,
  send_time TIME,
  recipient_type TEXT NOT NULL DEFAULT 'admin',
  recipient_number TEXT,
  message_template TEXT,
  link_template TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.notification_settings TO authenticated;
GRANT ALL ON public.notification_settings TO service_role;

ALTER TABLE public.notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view notification settings"
ON public.notification_settings FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert notification settings"
ON public.notification_settings FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update notification settings"
ON public.notification_settings FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete notification settings"
ON public.notification_settings FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_notification_settings_updated_at
BEFORE UPDATE ON public.notification_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.notification_settings
  (notification_type, enabled, send_time, recipient_type, recipient_number, message_template, link_template)
VALUES
  ('pending_agreements', true, '08:00', 'admin', '267-221-3977', '📝 Unsigned agreements: [customers]', '[link]'),
  ('extension_pending', true, NULL, 'both', '267-221-3977', 'Your rental extension link is ready: [link]', '[link]'),
  ('admin_morning_text', true, '08:00', 'admin', '267-221-3977', '🔧 Active Repairs ([count]) - [list]', '[link]'),
  ('new_issue_alerts', true, NULL, 'admin', '267-221-3977', '⚠️ New issue: [vehicle] - [issue]', '[link]'),
  ('past_due_payments', true, '08:00', 'admin', '267-221-3977', '💰 Past due: [customers, amounts]', '[link]'),
  ('auto_extension_links', true, '08:00', 'customer', '267-221-3977', 'Time to extend your rental! Click here: [link]', '[link]'),
  ('autopay_reminders', true, NULL, 'customer', '267-221-3977', 'Reminder: Your auto-payment of $[amount] will charge tomorrow.', '[link]');