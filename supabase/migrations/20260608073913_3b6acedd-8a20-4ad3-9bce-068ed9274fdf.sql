ALTER TABLE public.reminder_log DROP CONSTRAINT IF EXISTS reminder_log_reminder_type_check;
ALTER TABLE public.reminder_log ADD CONSTRAINT reminder_log_reminder_type_check
  CHECK (reminder_type = ANY (ARRAY[
    'payment_due'::text,
    'rental_return'::text,
    'admin_past_due'::text,
    'admin_due_today'::text,
    'checkin_2h'::text,
    'cardholder_verify_initial'::text,
    'cardholder_verify_1h'::text,
    'cardholder_verify_daily'::text
  ]));

INSERT INTO public.notification_settings
  (notification_type, enabled, send_time, recipient_type, message_template, link_template)
VALUES (
  'cardholder_verification',
  true,
  '08:00:00',
  'customer',
  'Card verification still needed for your rental. Please complete to avoid a potential payment dispute. [link]',
  '[link]'
)
ON CONFLICT (notification_type) DO NOTHING;