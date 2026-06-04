CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autopay-reminders-hourly') THEN
    PERFORM cron.unschedule('autopay-reminders-hourly');
  END IF;
END $$;

SELECT cron.schedule(
  'autopay-reminders-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://camautorentals.lovable.app/api/public/hooks/autopay-reminders',
    headers := jsonb_build_object('Content-Type','application/json','apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnbXJhdG9ob29neWN6a2d0aWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzM5ODUsImV4cCI6MjA5NDE0OTk4NX0.uib4eIEYsjatBSp6Plt0hziHJ9srjlir3oBulIzadu8'),
    body := '{"type":"autopay_reminder"}'::jsonb
  );
  $$
);