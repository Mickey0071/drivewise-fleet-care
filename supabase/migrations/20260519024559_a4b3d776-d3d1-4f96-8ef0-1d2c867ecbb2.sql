ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS real_email TEXT;

UPDATE public.profiles
SET real_email = email
WHERE real_email IS NULL
  AND email IS NOT NULL
  AND email <> ''
  AND email NOT LIKE '%@camauto.local';