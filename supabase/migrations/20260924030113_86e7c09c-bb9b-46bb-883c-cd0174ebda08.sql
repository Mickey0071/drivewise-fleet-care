ALTER TABLE public.waitlist_entries
  ADD COLUMN IF NOT EXISTS vetting_tier text NOT NULL DEFAULT 'unvetted',
  ADD COLUMN IF NOT EXISTS drives_rideshare boolean,
  ADD COLUMN IF NOT EXISTS accepts_deposit boolean,
  ADD COLUMN IF NOT EXISTS accepts_daily_rate boolean,
  ADD COLUMN IF NOT EXISTS preferred_start text,
  ADD COLUMN IF NOT EXISTS source_param text NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS campaign_param text,
  ADD COLUMN IF NOT EXISTS intake_payload jsonb,
  ADD COLUMN IF NOT EXISTS normalized_phone text,
  ADD COLUMN IF NOT EXISTS qualification_sms_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS courtesy_sms_sent_at timestamptz;

ALTER TABLE public.waitlist_entries
  DROP CONSTRAINT IF EXISTS waitlist_entries_vetting_tier_check;
ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_vetting_tier_check
  CHECK (vetting_tier IN ('qualified', 'low_go', 'unvetted'));

ALTER TABLE public.waitlist_entries
  DROP CONSTRAINT IF EXISTS waitlist_entries_source_param_check;
ALTER TABLE public.waitlist_entries
  ADD CONSTRAINT waitlist_entries_source_param_check
  CHECK (source_param IN ('agency', 'facebook', 'manual', 'direct'));

UPDATE public.waitlist_entries
SET normalized_phone = CASE
      WHEN length(regexp_replace(phone, '\D', '', 'g')) = 10
        THEN '+1' || regexp_replace(phone, '\D', '', 'g')
      WHEN length(regexp_replace(phone, '\D', '', 'g')) = 11
        AND regexp_replace(phone, '\D', '', 'g') LIKE '1%'
        THEN '+' || regexp_replace(phone, '\D', '', 'g')
      ELSE NULL
    END,
    source_param = CASE lower(coalesce(source, ''))
      WHEN 'admin' THEN 'manual'
      WHEN 'agency' THEN 'agency'
      WHEN 'facebook' THEN 'facebook'
      WHEN 'direct' THEN 'direct'
      ELSE 'direct'
    END
WHERE normalized_phone IS NULL OR source_param = 'direct';

CREATE INDEX IF NOT EXISTS waitlist_entries_normalized_phone_idx
  ON public.waitlist_entries (normalized_phone)
  WHERE normalized_phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS waitlist_entries_month_source_tier_idx
  ON public.waitlist_entries (created_at, source_param, vetting_tier);

CREATE TABLE public.waitlist_intake_rate_limits (
  key_hash text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1 CHECK (request_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.waitlist_intake_rate_limits TO service_role;
ALTER TABLE public.waitlist_intake_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_waitlist_intake_rate_limit(
  _key_hash text,
  _window_seconds integer DEFAULT 60,
  _max_requests integer DEFAULT 30
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.waitlist_intake_rate_limits%ROWTYPE;
BEGIN
  IF _key_hash IS NULL OR length(_key_hash) < 16 THEN
    RETURN false;
  END IF;

  INSERT INTO public.waitlist_intake_rate_limits (key_hash)
  VALUES (_key_hash)
  ON CONFLICT (key_hash) DO UPDATE
  SET request_count = CASE
        WHEN public.waitlist_intake_rate_limits.window_started_at <= now() - make_interval(secs => _window_seconds)
          THEN 1
        ELSE public.waitlist_intake_rate_limits.request_count + 1
      END,
      window_started_at = CASE
        WHEN public.waitlist_intake_rate_limits.window_started_at <= now() - make_interval(secs => _window_seconds)
          THEN now()
        ELSE public.waitlist_intake_rate_limits.window_started_at
      END,
      updated_at = now()
  RETURNING * INTO _row;

  RETURN _row.request_count <= _max_requests;
END;
$$;
REVOKE ALL ON FUNCTION public.consume_waitlist_intake_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_waitlist_intake_rate_limit(text, integer, integer) TO service_role;