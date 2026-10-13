CREATE TABLE public.additional_drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id text NOT NULL REFERENCES public.rentals(id) ON DELETE CASCADE,
  invited_name text,
  full_name text,
  date_of_birth date,
  phone text,
  email text,
  address text,
  street_address text,
  city text,
  state text,
  zip_code text,
  license_number text,
  license_state text,
  license_expiration date,
  license_photo_url text,
  selfie_url text,
  signature_url text,
  printed_name text,
  addendum_pdf_url text,
  acknowledgements jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_also_payer boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'invited',
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid,
  rejection_reason text,
  revoked_at timestamptz,
  revoked_by uuid,
  ocr_match_status text,
  ocr_license_number text,
  token text NOT NULL UNIQUE,
  token_expires_at timestamptz NOT NULL,
  token_used_at timestamptz,
  invited_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT additional_drivers_status_chk CHECK (status IN ('invited','pending','approved','rejected','revoked'))
);
CREATE INDEX additional_drivers_rental_idx ON public.additional_drivers(rental_id);
CREATE INDEX additional_drivers_license_idx ON public.additional_drivers(lower(license_number));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.additional_drivers TO authenticated;
GRANT ALL ON public.additional_drivers TO service_role;

ALTER TABLE public.additional_drivers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage additional drivers"
ON public.additional_drivers FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));