-- lovable-cron-fallback-reviewed: per-minute throttled SMS sender armed only while a campaign is sending, unscheduled when drained
DO $$ BEGIN
  CREATE TYPE public.lead_source AS ENUM ('online_form','funnel','manual_entry','waitlist','csv_import','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.consent_status AS ENUM ('unknown','opted_in','opted_out');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE public.consent_source AS ENUM ('online_form','manual_note','reply_YES');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS lead_source public.lead_source,
  ADD COLUMN IF NOT EXISTS source_detail text,
  ADD COLUMN IF NOT EXISTS consent_status public.consent_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consent_source public.consent_source,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_note text,
  ADD COLUMN IF NOT EXISTS do_not_text boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS marketing_token text UNIQUE;

ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS lead_source public.lead_source,
  ADD COLUMN IF NOT EXISTS source_detail text,
  ADD COLUMN IF NOT EXISTS consent_status public.consent_status NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS consent_source public.consent_source,
  ADD COLUMN IF NOT EXISTS consent_at timestamptz,
  ADD COLUMN IF NOT EXISTS consent_note text,
  ADD COLUMN IF NOT EXISTS do_not_text boolean NOT NULL DEFAULT false;

-- Backfill
UPDATE public.drivers d SET lead_source = CASE WHEN EXISTS (
  SELECT 1 FROM public.waitlist_entries w
  WHERE right(regexp_replace(coalesce(w.phone,''),'\D','','g'),10) = right(regexp_replace(coalesce(d.phone,''),'\D','','g'),10)
    AND length(regexp_replace(coalesce(d.phone,''),'\D','','g')) >= 10
) THEN 'waitlist'::public.lead_source ELSE 'manual_entry'::public.lead_source END
WHERE lead_source IS NULL;
UPDATE public.waitlist_entries SET lead_source = CASE WHEN source_param = 'agency' THEN 'funnel'::public.lead_source ELSE 'waitlist'::public.lead_source END WHERE lead_source IS NULL;
UPDATE public.drivers SET marketing_token = replace(gen_random_uuid()::text,'-','') WHERE marketing_token IS NULL;

CREATE OR REPLACE FUNCTION public.drivers_marketing_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lead_source IS NULL THEN
    NEW.lead_source := CASE WHEN NEW.import_source IS NOT NULL AND NEW.import_source <> '' THEN 'csv_import'::lead_source ELSE 'manual_entry'::lead_source END;
  END IF;
  IF NEW.marketing_token IS NULL THEN NEW.marketing_token := replace(gen_random_uuid()::text,'-',''); END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS drivers_marketing_defaults ON public.drivers;
CREATE TRIGGER drivers_marketing_defaults BEFORE INSERT ON public.drivers FOR EACH ROW EXECUTE FUNCTION public.drivers_marketing_defaults();

CREATE OR REPLACE FUNCTION public.waitlist_marketing_defaults() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.lead_source IS NULL THEN
    NEW.lead_source := CASE WHEN NEW.source_param = 'agency' THEN 'funnel'::lead_source ELSE 'waitlist'::lead_source END;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS waitlist_marketing_defaults ON public.waitlist_entries;
CREATE TRIGGER waitlist_marketing_defaults BEFORE INSERT ON public.waitlist_entries FOR EACH ROW EXECUTE FUNCTION public.waitlist_marketing_defaults();

-- Form visits
CREATE TABLE public.form_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_name text NOT NULL,
  visited_at timestamptz NOT NULL DEFAULT now(),
  visitor_id text,
  utm_source text, utm_medium text, utm_campaign text, utm_content text, utm_term text,
  referrer text,
  page_url text,
  customer_id text,
  waitlist_entry_id uuid,
  campaign_id uuid,
  tracking_token text,
  submitted boolean NOT NULL DEFAULT false,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX form_visits_visitor_idx ON public.form_visits(visitor_id);
CREATE INDEX form_visits_customer_idx ON public.form_visits(customer_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.form_visits TO authenticated;
GRANT ALL ON public.form_visits TO service_role;
ALTER TABLE public.form_visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage form visits" ON public.form_visits FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Segments
CREATE TABLE public.marketing_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_segments TO authenticated;
GRANT ALL ON public.marketing_segments TO service_role;
ALTER TABLE public.marketing_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage segments" ON public.marketing_segments FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Templates
CREATE TABLE public.marketing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text NOT NULL DEFAULT 'Promo',
  channel text NOT NULL DEFAULT 'sms',
  subject text,
  body text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_templates TO authenticated;
GRANT ALL ON public.marketing_templates TO service_role;
ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage templates" ON public.marketing_templates FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
INSERT INTO public.marketing_templates (name, category, body) VALUES
 ('Weekly promo','Promo','Hi {{first_name}}, {{company_name}} has cars available this week. Reply or tap to reserve yours.'),
 ('Payment reminder','Payment reminder','Hi {{first_name}}, a friendly reminder that {{balance_due}} is due on your {{vehicle}} ({{plate}}). Thank you!'),
 ('Vehicle available','Waitlist vehicle available','Good news {{first_name}}! A vehicle just opened up at {{company_name}}. Tap to grab it before it''s gone.'),
 ('Referral ask','Referral ask','Hi {{first_name}}, know someone who needs a car for rideshare? Send them to {{company_name}} and we''ll thank you for it!');

-- Campaigns
CREATE TABLE public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL DEFAULT 'sms',
  audience_label text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  total_recipients integer NOT NULL DEFAULT 0,
  unknown_consent_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_campaigns TO authenticated;
GRANT ALL ON public.marketing_campaigns TO service_role;
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage campaigns" ON public.marketing_campaigns FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.marketing_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.marketing_campaigns(id) ON DELETE CASCADE,
  customer_id text,
  name text,
  phone text,
  normalized_phone text,
  consent_status text,
  message text,
  status text NOT NULL DEFAULT 'pending',
  error text,
  sent_at timestamptz,
  clicked_at timestamptz,
  replied_at timestamptz,
  opted_out_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX marketing_recipients_campaign_idx ON public.marketing_recipients(campaign_id, status);
CREATE INDEX marketing_recipients_phone_idx ON public.marketing_recipients(normalized_phone);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.marketing_recipients TO authenticated;
GRANT ALL ON public.marketing_recipients TO service_role;
ALTER TABLE public.marketing_recipients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage recipients" ON public.marketing_recipients FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER marketing_segments_touch BEFORE UPDATE ON public.marketing_segments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER marketing_templates_touch BEFORE UPDATE ON public.marketing_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER marketing_campaigns_touch BEFORE UPDATE ON public.marketing_campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Sender is armed only while a campaign is sending, and disarmed when drained.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.marketing_arm_sender() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-send') THEN
    PERFORM cron.schedule('marketing-send', '* * * * *', $job$
      SELECT net.http_post(
        url := 'https://camautorentals.lovable.app/api/public/hooks/marketing-send',
        headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnbXJhdG9ob29neWN6a2d0aWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzM5ODUsImV4cCI6MjA5NDE0OTk4NX0.uib4eIEYsjatBSp6Plt0hziHJ9srjlir3oBulIzadu8'),
        body := '{}'::jsonb, timeout_milliseconds := 55000);
    $job$);
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.marketing_disarm_sender() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-send') THEN
    PERFORM cron.unschedule('marketing-send');
  END IF;
END $fn$;

CREATE OR REPLACE FUNCTION public.marketing_start_campaign(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  UPDATE public.marketing_campaigns SET status = 'sending', started_at = coalesce(started_at, now())
    WHERE id = _id AND status IN ('scheduled','queued');
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-start-' || _id::text) THEN
    PERFORM cron.unschedule('marketing-start-' || _id::text);
  END IF;
  PERFORM public.marketing_arm_sender();
END $fn$;

-- One-shot job at the scheduled minute (UTC) that starts the campaign.
CREATE OR REPLACE FUNCTION public.marketing_schedule_campaign(_id uuid, _at timestamptz) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE t timestamptz := _at AT TIME ZONE 'UTC';
BEGIN
  PERFORM cron.schedule('marketing-start-' || _id::text,
    format('%s %s %s %s *', extract(minute from t)::int, extract(hour from t)::int, extract(day from t)::int, extract(month from t)::int),
    format('SELECT public.marketing_start_campaign(%L::uuid)', _id));
END $fn$;

CREATE OR REPLACE FUNCTION public.marketing_unschedule_campaign(_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'marketing-start-' || _id::text) THEN
    PERFORM cron.unschedule('marketing-start-' || _id::text);
  END IF;
END $fn$;

REVOKE ALL ON FUNCTION public.marketing_arm_sender() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_disarm_sender() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_start_campaign(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_schedule_campaign(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.marketing_unschedule_campaign(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_arm_sender() TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_disarm_sender() TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_start_campaign(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_schedule_campaign(uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.marketing_unschedule_campaign(uuid) TO service_role;