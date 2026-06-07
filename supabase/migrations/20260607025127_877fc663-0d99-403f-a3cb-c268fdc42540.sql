ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS customer_token text,
  ADD COLUMN IF NOT EXISTS customer_token_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS sent_to_customer_at timestamptz,
  ADD COLUMN IF NOT EXISTS viewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_choice text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signed_name text,
  ADD COLUMN IF NOT EXISTS signature_url text,
  ADD COLUMN IF NOT EXISTS signed_ip text,
  ADD COLUMN IF NOT EXISTS signed_user_agent text,
  ADD COLUMN IF NOT EXISTS signed_pdf_url text,
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_to_authority_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_to text,
  ADD COLUMN IF NOT EXISTS submission_method text,
  ADD COLUMN IF NOT EXISTS confirmation_number text,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolution_reason text,
  ADD COLUMN IF NOT EXISTS resolution_notes text;

CREATE UNIQUE INDEX IF NOT EXISTS violations_customer_token_key
  ON public.violations (customer_token)
  WHERE customer_token IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_violation_public(_token text)
RETURNS TABLE(
  id text,
  status text,
  resolution_choice text,
  amount numeric,
  total_amount numeric,
  date_issued date,
  description text,
  license_plate text,
  signed_at timestamptz,
  paid_at timestamptz,
  viewed_at timestamptz,
  vehicle_year integer,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  driver_full_name text,
  rental_start_date date,
  rental_end_date date
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    v.id,
    v.status,
    v.resolution_choice,
    v.amount,
    v.total_amount,
    v.date_issued,
    v.description,
    v.license_plate,
    v.signed_at,
    v.paid_at,
    v.viewed_at,
    ve.year,
    ve.make,
    ve.model,
    ve.plate,
    d.full_name,
    r.start_date,
    r.end_date
  FROM public.violations v
  LEFT JOIN public.vehicles ve ON ve.id = v.vehicle_id
  LEFT JOIN public.drivers d ON d.id = v.driver_id
  LEFT JOIN public.rentals r ON r.id = v.rental_id
  WHERE v.customer_token = _token
    AND (v.customer_token_expires_at IS NULL OR v.customer_token_expires_at > now());
$function$;

GRANT EXECUTE ON FUNCTION public.get_violation_public(text) TO anon, authenticated;