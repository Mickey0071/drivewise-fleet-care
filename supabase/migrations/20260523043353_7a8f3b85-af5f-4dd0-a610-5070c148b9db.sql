
-- Add 'va' (Virtual Assistant) to app_role enum
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'va';

-- Staff setup tokens
CREATE TABLE IF NOT EXISTS public.staff_setup_tokens (
  token text PRIMARY KEY,
  email text NOT NULL,
  first_name text,
  last_name text,
  phone text,
  role public.app_role NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_setup_tokens_email ON public.staff_setup_tokens (lower(email));

ALTER TABLE public.staff_setup_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage staff_setup_tokens"
ON public.staff_setup_tokens
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));
