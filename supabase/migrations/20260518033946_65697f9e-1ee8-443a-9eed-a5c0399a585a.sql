-- Auto-asignar rol comercial_zona a jesus@afflux.es al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  user_count INTEGER;
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;

  -- Reglas de rol:
  -- 1) Primer usuario del sistema = admin
  -- 2) jesus@afflux.es = comercial_zona (usuario de prueba)
  -- 3) Resto = viewer
  IF lower(NEW.email) = 'jesus@afflux.es' THEN
    assigned_role := 'comercial_zona'::public.app_role;
  ELSE
    SELECT COUNT(*) INTO user_count FROM public.profiles;
    IF user_count <= 1 THEN
      assigned_role := 'admin'::public.app_role;
    ELSE
      assigned_role := 'viewer'::public.app_role;
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- Si jesus ya existe en auth.users, fuerza su rol a comercial_zona
DO $$
DECLARE
  jesus_id uuid;
BEGIN
  SELECT id INTO jesus_id FROM auth.users WHERE lower(email) = 'jesus@afflux.es' LIMIT 1;
  IF jesus_id IS NOT NULL THEN
    -- limpia roles previos y asigna comercial_zona
    DELETE FROM public.user_roles WHERE user_id = jesus_id;
    INSERT INTO public.user_roles (user_id, role) VALUES (jesus_id, 'comercial_zona'::public.app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    -- asegura profile
    INSERT INTO public.profiles (id, email, full_name)
    VALUES (jesus_id, 'jesus@afflux.es', 'Jesús (Comercial Zona)')
    ON CONFLICT (id) DO UPDATE SET full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);
  END IF;
END $$;