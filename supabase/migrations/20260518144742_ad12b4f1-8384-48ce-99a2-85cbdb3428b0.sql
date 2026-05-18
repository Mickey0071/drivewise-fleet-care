
-- Add profile fields for signup capture
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS first_name TEXT,
  ADD COLUMN IF NOT EXISTS last_name TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT;

-- Update signup trigger to capture first/last/email/phone from auth metadata
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
  v_role public.app_role;
  v_first TEXT := NEW.raw_user_meta_data->>'first_name';
  v_last  TEXT := NEW.raw_user_meta_data->>'last_name';
  v_full  TEXT := NEW.raw_user_meta_data->>'full_name';
BEGIN
  IF v_full IS NULL OR length(trim(v_full)) = 0 THEN
    v_full := trim(coalesce(v_first,'') || ' ' || coalesce(v_last,''));
    IF length(v_full) = 0 THEN v_full := NULL; END IF;
  END IF;

  INSERT INTO public.profiles (id, full_name, first_name, last_name, phone, email)
  VALUES (
    NEW.id,
    v_full,
    v_first,
    v_last,
    NEW.raw_user_meta_data->>'phone',
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name  = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    phone      = COALESCE(EXCLUDED.phone, public.profiles.phone),
    email      = COALESCE(EXCLUDED.email, public.profiles.email);

  SELECT COUNT(*) INTO v_count FROM auth.users;
  IF v_count <= 1 THEN
    v_role := 'admin';
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
    ON CONFLICT DO NOTHING;
  END IF;
  -- Non-first users: no role assigned — admin must approve.
  RETURN NEW;
END;
$function$;

-- Ensure trigger on auth.users exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
