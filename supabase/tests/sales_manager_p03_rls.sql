-- SALES_MANAGER P0.3 · RLS y cierre de has_role ejecutados de verdad.
-- Todo dentro de una transacción que TERMINA EN ROLLBACK.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.como(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE v text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role','authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);
  EXECUTE _sql INTO v;
  PERFORM set_config('role', 'none', true);
  RESET ROLE;
  RETURN v;
EXCEPTION WHEN others THEN
  PERFORM set_config('role', 'none', true);
  RESET ROLE;
  RETURN 'ERROR:' || SQLSTATE;
END $$;

DO $$
DECLARE
  u_admin uuid := '11111111-1111-1111-1111-111111111111';
  u_sm    uuid := '22222222-2222-2222-2222-222222222222';
  u_com   uuid := '33333333-3333-3333-3333-333333333333';
  u_wa    uuid := '44444444-4444-4444-4444-444444444444';
  u_view  uuid := '55555555-5555-5555-5555-555555555555';
  r text;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (u_admin,'admin@test.local'), (u_sm,'sm@test.local'), (u_com,'com@test.local'),
    (u_wa,'wa@test.local'), (u_view,'view@test.local')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, full_name) VALUES
    (u_admin,'admin@test.local','Admin'), (u_sm,'sm@test.local','Gestor'),
    (u_com,'com@test.local','Comercial'), (u_wa,'wa@test.local','WA'),
    (u_view,'view@test.local','Viewer')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin,'admin'), (u_sm,'sales_manager'), (u_com,'comercial_zona'),
    (u_wa,'whatsapp'), (u_view,'viewer')
  ON CONFLICT DO NOTHING;

  -- CASO 1: has_role ya no es invocable por authenticated (42501).
  r := pg_temp.como(u_com, format('SELECT public.has_role(%L::uuid, ''admin'')::text', u_admin));
  IF r <> 'ERROR:42501' THEN RAISE EXCEPTION 'CASO 1 FAIL: has_role accesible (%)', r; END IF;
  RAISE NOTICE 'CASO 1 PASS · authenticated no puede consultar el rol de un tercero';

  -- CASO 2: current_user_has_role responde por uno mismo, sin user_id.
  r := pg_temp.como(u_sm, 'SELECT public.current_user_has_role(''sales_manager'')::text');
  IF r <> 'true' THEN RAISE EXCEPTION 'CASO 2 FAIL: self-check roto (%)', r; END IF;
  r := pg_temp.como(u_com, 'SELECT public.current_user_has_role(''admin'')::text');
  IF r <> 'false' THEN RAISE EXCEPTION 'CASO 2 FAIL: comercial se cree admin (%)', r; END IF;
  RAISE NOTICE 'CASO 2 PASS · current_user_has_role self funciona y no escala';

  -- CASO 3: internal_member_has_role está cerrada a authenticated.
  r := pg_temp.como(u_sm, format('SELECT public.internal_member_has_role(%L::uuid, ''admin'')::text', u_admin));
  IF r <> 'ERROR:42501' THEN RAISE EXCEPTION 'CASO 3 FAIL: helper interno expuesto (%)', r; END IF;
  RAISE NOTICE 'CASO 3 PASS · internal_member_has_role sólo para service_role';

  -- CASO 4: políticas históricas conservan el acceso previsto.
  --   admin ve todos los roles; el resto sólo los suyos.
  r := pg_temp.como(u_admin, 'SELECT count(*)::text FROM public.user_roles');
  IF r::int < 5 THEN RAISE EXCEPTION 'CASO 4 FAIL: el admin perdió visibilidad (%)', r; END IF;
  r := pg_temp.como(u_com, 'SELECT count(*)::text FROM public.user_roles');
  IF r <> '1' THEN RAISE EXCEPTION 'CASO 4 FAIL: el comercial ve roles ajenos (%)', r; END IF;
  RAISE NOTICE 'CASO 4 PASS · user_roles: admin todo, tercero sólo self';

  -- CASO 5: perfiles ajenos no son legibles por un comercial.
  r := pg_temp.como(u_com, format('SELECT count(*)::text FROM public.profiles WHERE id = %L::uuid', u_admin));
  IF r <> '0' THEN RAISE EXCEPTION 'CASO 5 FAIL: perfil ajeno visible (%)', r; END IF;
  RAISE NOTICE 'CASO 5 PASS · profiles self+admin';

  -- CASO 6: RPC mínima de nombres para WhatsApp; el viewer no.
  r := pg_temp.como(u_wa, format('SELECT count(*)::text FROM public.get_agent_display_names(ARRAY[%L::uuid])', u_com));
  IF r <> '1' THEN RAISE EXCEPTION 'CASO 6 FAIL: WhatsApp sin nombres (%)', r; END IF;
  r := pg_temp.como(u_view, format('SELECT count(*)::text FROM public.get_agent_display_names(ARRAY[%L::uuid])', u_com));
  IF r <> '0' THEN RAISE EXCEPTION 'CASO 6 FAIL: viewer obtiene nombres (%)', r; END IF;
  RAISE NOTICE 'CASO 6 PASS · nombres sólo para whatsapp/admin';

  -- CASO 7: must_change_password no se puede limpiar desde el cliente.
  UPDATE public.profiles SET must_change_password = true WHERE id = u_com;
  PERFORM pg_temp.como(u_com, format(
    '(WITH x AS (UPDATE public.profiles SET must_change_password = false WHERE id = %L::uuid RETURNING 1) SELECT count(*)::text FROM x)', u_com));
  IF NOT (SELECT must_change_password FROM public.profiles WHERE id = u_com) THEN
    RAISE EXCEPTION 'CASO 7 FAIL: el usuario se quitó el flag';
  END IF;
  RAISE NOTICE 'CASO 7 PASS · must_change_password sólo por flujo privilegiado';
END $$;

ROLLBACK;
