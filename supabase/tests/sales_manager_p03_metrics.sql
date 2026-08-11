-- SALES_MANAGER P0.3 · métricas reales del panel (blocked / skipped / no_procede).
\set ON_ERROR_STOP on
BEGIN;

DO $$
DECLARE
  u_sm  uuid := '22222222-2222-2222-2222-222222222222';
  u_com uuid := '33333333-3333-3333-3333-333333333333';
  b     uuid := '0485d8cf-c1a2-4412-b38f-e37fb18961a2';
  j     jsonb; fila jsonb; snap jsonb;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u_sm,'sm@test.local'), (u_com,'com@test.local')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.profiles (id, email, full_name) VALUES
    (u_sm,'sm@test.local','Gestor'), (u_com,'com@test.local','Comercial')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (u_sm,'sales_manager'), (u_com,'comercial_zona')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.sales_manager_team_members (manager_id, member_id, active)
    VALUES (u_sm, u_com, true) ON CONFLICT DO NOTHING;
  INSERT INTO public.buildings (id, direccion, ciudad) VALUES (b,'CALLE TEST 1','MADRID')
    ON CONFLICT (id) DO NOTHING;

  -- Tareas vencidas en cada estado relevante.
  INSERT INTO public.building_tasks (building_id, user_id, task_type, task_key, title, status, due_date, created_at)
  VALUES
    (b, u_com, 'manual', 'v5:2026-08-10:T-01:x1', 'pendiente vencida',  'pending',    now() - interval '2 days', now() - interval '3 days'),
    (b, u_com, 'manual', 'v5:2026-08-10:T-01:x2', 'bloqueada vencida',  'blocked',    now() - interval '2 days', now() - interval '3 days'),
    (b, u_com, 'manual', 'v5:2026-08-10:T-02:x3', 'saltada',            'skipped',    now() - interval '2 days', now() - interval '3 days'),
    (b, u_com, 'manual', 'v5:2026-08-10:T-02:x4', 'no procede',         'no_procede', now() - interval '2 days', now() - interval '3 days'),
    (b, u_com, 'manual', 'v5:2026-08-10:T-03:x5', 'cancelada',          'cancelled',  now() - interval '2 days', now() - interval '3 days'),
    (b, u_com, 'manual', 'v5:2026-08-10:T-03:x6', 'sustituida',         'superseded', now() - interval '2 days', now() - interval '3 days');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_sm, 'role','authenticated')::text, true);
  j := public.get_sales_manager_dashboard(now() - interval '10 days', now() + interval '1 day');
  fila := (SELECT x FROM jsonb_array_elements(j->'rows') x WHERE x->>'user_id' = u_com::text);
  IF fila IS NULL THEN RAISE EXCEPTION 'CASO M0 FAIL: el gestor no ve a su comercial'; END IF;
  snap := fila->'snapshot';

  IF (snap->>'vencidas_ahora')::int <> 1 THEN
    RAISE EXCEPTION 'CASO M1 FAIL: vencidas_ahora = % (esperado 1, sólo la pendiente)', snap->>'vencidas_ahora';
  END IF;
  RAISE NOTICE 'CASO M1 PASS · blocked/cancelled/superseded/skipped no penalizan el SLA';

  IF (snap->>'bloqueadas_vencidas')::int <> 1 THEN
    RAISE EXCEPTION 'CASO M2 FAIL: bloqueadas_vencidas = %', snap->>'bloqueadas_vencidas';
  END IF;
  RAISE NOTICE 'CASO M2 PASS · bloqueadas_vencidas se informa aparte';

  IF (snap->>'skipped')::int <> 1 OR (snap->>'no_procede')::int <> 1 THEN
    RAISE EXCEPTION 'CASO M3 FAIL: skipped=% no_procede=%', snap->>'skipped', snap->>'no_procede';
  END IF;
  RAISE NOTICE 'CASO M3 PASS · skipped y no_procede son contadores distintos';

  IF (snap->>'unknown')::int <> 0 OR (snap->>'terminadas_sin_cierre')::int <> 2 THEN
    RAISE EXCEPTION 'CASO M4 FAIL: unknown=% terminadas_sin_cierre=%',
      snap->>'unknown', snap->>'terminadas_sin_cierre';
  END IF;
  RAISE NOTICE 'CASO M4 PASS · cancelled/superseded son terminales conocidos';

  -- Un comercial no puede llamar al panel.
  BEGIN
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u_com, 'role','authenticated')::text, true);
    PERFORM public.get_sales_manager_dashboard(now() - interval '1 day', now());
    RAISE EXCEPTION 'CASO M5 FAIL: el comercial ejecutó el panel';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'CASO M5 PASS · panel restringido a gestor/admin';
  END;
END $$;

ROLLBACK;
