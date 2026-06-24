CREATE TABLE public.portal_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reservation_id text NOT NULL,
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days')
);

CREATE INDEX idx_portal_tokens_reservation ON public.portal_tokens(reservation_id);

GRANT ALL ON public.portal_tokens TO service_role;

ALTER TABLE public.portal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role manages portal tokens"
  ON public.portal_tokens FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');