ALTER TABLE public.rentals
  ADD COLUMN IF NOT EXISTS verification_link_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_link_sent_by uuid,
  ADD COLUMN IF NOT EXISTS verification_resend_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS verification_reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS verification_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_token text,
  ADD COLUMN IF NOT EXISTS verification_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_events jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_rentals_verification_token ON public.rentals (verification_token);

-- Public lookup of a rental by its secure verification token (used by the
-- /verify-card/[token] landing page). Returns only the fields needed to render
-- the verification form; never exposes payment or PII beyond cardholder name.
CREATE OR REPLACE FUNCTION public.get_verification_by_token(_token text)
RETURNS TABLE(
  rental_id text,
  cardholder_name text,
  renter_name text,
  verification_status text,
  expired boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    r.id AS rental_id,
    COALESCE(r.cardholder_name, '') AS cardholder_name,
    COALESCE(d.full_name, '') AS renter_name,
    COALESCE(r.verification_status, 'pending') AS verification_status,
    (r.verification_token_expires_at IS NOT NULL AND r.verification_token_expires_at < now()) AS expired
  FROM public.rentals r
  LEFT JOIN public.drivers d ON d.id = r.driver_id
  WHERE r.verification_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_verification_by_token(text) TO anon, authenticated;

-- Disable automated cardholder verification reminders (moved to in-app alerts).
UPDATE public.notification_settings
  SET enabled = false, updated_at = now()
  WHERE notification_type = 'cardholder_verification';