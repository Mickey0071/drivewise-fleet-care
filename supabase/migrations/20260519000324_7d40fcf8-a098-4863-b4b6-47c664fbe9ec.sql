-- 4.1 Add username column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

-- 4.2 Backfill existing users
UPDATE public.profiles p
SET username = split_part(u.email, '@', 1)
FROM auth.users u
WHERE p.id = u.id AND p.username IS NULL;

-- 4.3 Update handle_new_user trigger to populate username
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
  v_username TEXT := NEW.raw_user_meta_data->>'username';
BEGIN
  IF v_full IS NULL OR length(trim(v_full)) = 0 THEN
    v_full := trim(coalesce(v_first,'') || ' ' || coalesce(v_last,''));
    IF length(v_full) = 0 THEN v_full := NULL; END IF;
  END IF;

  IF v_username IS NULL OR length(trim(v_username)) = 0 THEN
    v_username := split_part(NEW.email, '@', 1);
  END IF;

  INSERT INTO public.profiles (id, full_name, first_name, last_name, phone, email, username)
  VALUES (
    NEW.id,
    v_full,
    v_first,
    v_last,
    NEW.raw_user_meta_data->>'phone',
    NEW.email,
    v_username
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    first_name = COALESCE(EXCLUDED.first_name, public.profiles.first_name),
    last_name  = COALESCE(EXCLUDED.last_name, public.profiles.last_name),
    phone      = COALESCE(EXCLUDED.phone, public.profiles.phone),
    email      = COALESCE(EXCLUDED.email, public.profiles.email),
    username   = COALESCE(public.profiles.username, EXCLUDED.username);

  SELECT COUNT(*) INTO v_count FROM auth.users;
  IF v_count <= 1 THEN
    v_role := 'admin';
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, v_role)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;