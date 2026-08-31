ALTER TABLE public.notification_settings
  ADD COLUMN IF NOT EXISTS sms_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS app_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'daily',
  ADD COLUMN IF NOT EXISTS send_day text,
  ADD COLUMN IF NOT EXISTS admin_phone text,
  ADD COLUMN IF NOT EXISTS quiet_hours_start time,
  ADD COLUMN IF NOT EXISTS quiet_hours_end time,
  ADD COLUMN IF NOT EXISTS master_sms_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS link_base_url text,
  ADD COLUMN IF NOT EXISTS toggles jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Kill switch: stop every currently-firing automatic alert.
UPDATE public.notification_settings
SET enabled = false, sms_enabled = false, master_sms_enabled = false;

CREATE UNIQUE INDEX IF NOT EXISTS notification_settings_type_key
  ON public.notification_settings (notification_type);

INSERT INTO public.notification_settings (notification_type, enabled, sms_enabled, app_enabled, frequency, send_time, send_day, master_sms_enabled, admin_phone, quiet_hours_start, quiet_hours_end, toggles)
VALUES
  ('__global__', false, false, true, 'off', NULL, NULL, false, '267-221-3977', '21:00', '08:00', '{}'::jsonb),
  ('maintenance', false, false, true, 'daily', '08:00', 'monday', false, NULL, NULL, NULL,
    '{"sms_on_overdue":true,"sms_on_due_soon":false,"app_notification":true}'::jsonb),
  ('repairs', false, false, true, 'daily', '08:00', 'monday', false, NULL, NULL, NULL,
    '{"sms_on_opened":true,"sms_on_mechanic_submit":true,"sms_on_completed":false,"daily_open_summary":true}'::jsonb),
  ('violations', false, false, true, 'daily', '08:00', 'monday', false, NULL, NULL, NULL,
    '{"sms_on_new":true,"sms_on_unmatched_7d":true}'::jsonb),
  ('payments', false, false, true, 'daily', '08:00', 'monday', false, NULL, NULL, NULL,
    '{"sms_on_overdue":true,"sms_on_received":false}'::jsonb),
  ('runner_tasks', false, false, true, 'immediate', '08:00', 'monday', false, NULL, NULL, NULL,
    '{"sms_on_completed":true,"sms_on_declined":true}'::jsonb)
ON CONFLICT (notification_type) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.alert_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section text NOT NULL,
  alert_type text NOT NULL,
  vehicle_id text,
  plate text,
  vehicle_label text,
  headline text,
  detail text NOT NULL,
  sub_line text,
  severity integer NOT NULL DEFAULT 0,
  link_path text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.alert_queue TO authenticated;
GRANT ALL ON public.alert_queue TO service_role;

ALTER TABLE public.alert_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read queued alerts"
  ON public.alert_queue FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_alert_queue_updated_at
  BEFORE UPDATE ON public.alert_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX IF NOT EXISTS alert_queue_pending_idx
  ON public.alert_queue (section, sent_at);