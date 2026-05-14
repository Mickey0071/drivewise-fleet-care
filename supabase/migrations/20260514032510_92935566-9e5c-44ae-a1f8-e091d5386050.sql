SELECT cron.schedule(
  'send-rental-reminders-daily',
  '0 14 * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--d41d3e7e-f5b7-4980-b1e7-d2e263f62d74.lovable.app/api/public/hooks/send-reminders',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnbXJhdG9ob29neWN6a2d0aWRuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1NzM5ODUsImV4cCI6MjA5NDE0OTk4NX0.uib4eIEYsjatBSp6Plt0hziHJ9srjlir3oBulIzadu8"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);