DO $$
DECLARE
  new_uid uuid;
BEGIN
  SELECT id INTO new_uid FROM auth.users WHERE email = 'david.casero@afflux.es';
  IF new_uid IS NULL THEN
    new_uid := gen_random_uuid();
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', new_uid, 'authenticated', 'authenticated',
      'david.casero@afflux.es', crypt('Afflux2026!', gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
    );
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), new_uid,
      jsonb_build_object('sub', new_uid::text, 'email', 'david.casero@afflux.es', 'email_verified', true),
      'email', new_uid::text, now(), now(), now());
  END IF;
  INSERT INTO public.user_roles (user_id, role)
  VALUES (new_uid, 'comercial_zona')
  ON CONFLICT (user_id, role) DO NOTHING;
END $$;