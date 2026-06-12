-- Retroactive rental agreement support for migrated (legacy) rentals
ALTER TABLE public.legacy_rentals
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS dl_state text,
  ADD COLUMN IF NOT EXISTS dob text,
  ADD COLUMN IF NOT EXISTS retro_token text,
  ADD COLUMN IF NOT EXISTS retro_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS retro_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS retro_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS retro_signature_url text,
  ADD COLUMN IF NOT EXISTS retro_signed_ip text;

CREATE UNIQUE INDEX IF NOT EXISTS legacy_rentals_retro_token_key
  ON public.legacy_rentals (retro_token) WHERE retro_token IS NOT NULL;

-- Public, token-scoped read for the retroactive signing page (no login)
CREATE OR REPLACE FUNCTION public.get_retro_agreement_public(_token text)
RETURNS TABLE(
  id uuid,
  renter_name text,
  vehicle text,
  year text,
  color text,
  plate text,
  start_datetime timestamptz,
  end_datetime timestamptz,
  address text,
  dl_number text,
  dl_state text,
  dob text,
  phone text,
  email text,
  retro_signed_at timestamptz,
  expired boolean
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    lr.id, lr.renter_name, lr.vehicle, lr.year, lr.color, lr.plate,
    lr.start_datetime, lr.end_datetime, lr.address, lr.dl_number, lr.dl_state,
    lr.dob, lr.phone, lr.email, lr.retro_signed_at,
    (lr.retro_token_expires_at IS NOT NULL AND lr.retro_token_expires_at < now()) AS expired
  FROM public.legacy_rentals lr
  WHERE lr.retro_token = _token
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_retro_agreement_public(text) TO anon, authenticated;