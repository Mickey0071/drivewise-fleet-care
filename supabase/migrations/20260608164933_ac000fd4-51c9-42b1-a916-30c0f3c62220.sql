CREATE TABLE public.backups (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  period_month text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  email_sent_at timestamptz,
  email_status text NOT NULL DEFAULT 'pending',
  email_attempts integer NOT NULL DEFAULT 0,
  file_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  triggered_by text NOT NULL DEFAULT 'cron',
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backups TO authenticated;
GRANT ALL ON public.backups TO service_role;

ALTER TABLE public.backups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view backups" ON public.backups
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage backups" ON public.backups
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_backups_period ON public.backups (period_month DESC);

CREATE TRIGGER trg_backups_updated_at
  BEFORE UPDATE ON public.backups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();