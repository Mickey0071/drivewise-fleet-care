-- Link a violation to the retroactive-agreement "shell" used to collect a signature
ALTER TABLE public.violations
  ADD COLUMN IF NOT EXISTS retro_legacy_rental_id uuid,
  ADD COLUMN IF NOT EXISTS mail_override_at timestamptz,
  ADD COLUMN IF NOT EXISTS mail_override_note text,
  ADD COLUMN IF NOT EXISTS mail_override_by uuid;

-- Allow a legacy_rentals shell to point back at the live rental/driver it should
-- fill in once the retroactive agreement is signed.
ALTER TABLE public.legacy_rentals
  ADD COLUMN IF NOT EXISTS target_rental_id text,
  ADD COLUMN IF NOT EXISTS target_driver_id text;