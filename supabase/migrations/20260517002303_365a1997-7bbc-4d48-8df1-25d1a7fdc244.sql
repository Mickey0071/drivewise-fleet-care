CREATE TABLE public.share_link_sms_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL,
  vehicle_id text,
  phone text NOT NULL,
  recipient_name text,
  status text NOT NULL CHECK (status IN ('sent','failed')),
  error_message text,
  attempted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_share_link_sms_log_created_at ON public.share_link_sms_log (created_at DESC);
CREATE INDEX idx_share_link_sms_log_token ON public.share_link_sms_log (token);

ALTER TABLE public.share_link_sms_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read sms log"
ON public.share_link_sms_log
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Authenticated insert sms log"
ON public.share_link_sms_log
FOR INSERT
TO authenticated
WITH CHECK (true);