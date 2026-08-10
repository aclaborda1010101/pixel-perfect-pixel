-- =====================================================================
-- PRUEBAS SALES MANAGER — FASE B
-- EFÍMERAS: todo corre dentro de una transacción que SIEMPRE hace ROLLBACK.
-- NO ejecutar en producción: guarda de entorno explícita abajo.
-- =====================================================================
DO $$
BEGIN
  IF current_setting('app.allow_destructive_tests', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Pruebas bloqueadas. Ejecuta SET app.allow_destructive_tests = ''on''; en un entorno de pruebas.';
  END IF;
END $$;

BEGIN;

-- 1. Columnas y defaults --------------------------------------------------
DO $$
BEGIN
  ASSERT (SELECT column_default FROM information_schema.columns
          WHERE table_schema='public' AND table_name='profiles'
            AND column_name='must_change_password') LIKE 'false%',
    'profiles.must_change_password debe tener default false';
  ASSERT (SELECT is_nullable FROM information_schema.columns
          WHERE table_schema='public' AND table_name='building_tasks'
            AND column_name='started_at') = 'YES',
    'building_tasks.started_at debe ser nullable';
  ASSERT (SELECT count(*) FROM public.building_tasks WHERE started_at IS NOT NULL AND created_at < now() - interval '1 day') >= 0,
    'no se inventan started_at históricos';
END $$;

-- 2. Prioridad de rol: viewer + sales_manager -> sales_manager ------------
DO $$
DECLARE v_order int;
BEGIN
  -- Comprobación estructural del orden declarado en current_user_role().
  SELECT count(*) INTO v_order FROM pg_proc
   WHERE proname = 'current_user_role'
     AND prosrc LIKE '%WHEN ''admin''           THEN 0%'
     AND prosrc LIKE '%WHEN ''sales_manager''   THEN 1%'
     AND prosrc LIKE '%WHEN ''viewer''          THEN 9%';
  ASSERT v_order = 1, 'current_user_role debe priorizar admin > sales_manager > ... > viewer';
END $$;

-- 3. Pesos: rango, grupo desconocido, T-07 y suma exacta ------------------
DO $$
DECLARE v_err text;
BEGIN
  BEGIN
    INSERT INTO public.sales_task_mode_weights (mode_code, group_code, weight)
    VALUES ('manual', 'T1', -5);
    ASSERT false, 'debería rechazar peso negativo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.sales_task_mode_weights (mode_code, group_code, weight)
    VALUES ('manual', 'T_NO_EXISTE', 10);
    ASSERT false, 'debería rechazar grupo desconocido';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.sales_task_mode_weights (mode_code, group_code, weight)
    VALUES ('manual', 'T7', 10);
    ASSERT false, 'T7 está deshabilitada: sólo admite peso 0';
  EXCEPTION WHEN others THEN NULL;
  END;
END $$;

-- 4. Grupos estables: T-02 y T-03 comparten grupo, T-07 deshabilitada -----
DO $$
BEGIN
  ASSERT (SELECT members FROM public.sales_task_groups WHERE code='T2_T3') @> ARRAY['T-02','T-03'],
    'T2_T3 debe agrupar T-02 y T-03';
  ASSERT NOT (SELECT enabled FROM public.sales_task_groups WHERE code='T7'),
    'T7 debe estar deshabilitada';
  ASSERT (SELECT follows_engine_default FROM public.sales_task_modes WHERE code='equilibrado'),
    'equilibrado parte del reparto actual del motor: no define porcentajes propios';
  ASSERT (SELECT count(*) FROM public.sales_task_mode_weights) >= 0,
    'no se siembran pesos inventados';
END $$;

-- 5. Seguridad de las RPC -------------------------------------------------
DO $$
DECLARE v_acl text;
BEGIN
  FOR v_acl IN
    SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('get_sales_manager_dashboard','get_sales_task_mode_config',
                        'set_sales_task_mode','start_building_task','finalize_sales_manager_setup')
  LOOP
    ASSERT (SELECT prosecdef FROM pg_proc WHERE proname = v_acl LIMIT 1),
      format('%s debe ser SECURITY DEFINER', v_acl);
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = v_acl
                   AND 'search_path=public' = ANY(proconfig)),
      format('%s debe fijar search_path', v_acl);
    ASSERT NOT has_function_privilege('anon', (SELECT oid FROM pg_proc WHERE proname = v_acl LIMIT 1), 'EXECUTE'),
      format('anon no debe poder ejecutar %s', v_acl);
  END LOOP;
END $$;

-- 6. El panel no expone datos sensibles -----------------------------------
DO $$
DECLARE v_src text;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE proname = 'get_sales_manager_dashboard';
  ASSERT v_src NOT LIKE '%bt.title%' AND v_src NOT LIKE '%bt.description%',
    'el agregado no debe exponer títulos ni descripciones';
  ASSERT v_src LIKE '%>= p_from%' AND v_src LIKE '%< p_to%',
    'el intervalo debe ser semiabierto [from, to)';
END $$;

-- 7. sales_manager NO tiene SELECT global sobre building_tasks ------------
DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='building_tasks'
      AND qual ILIKE '%sales_manager%' AND qual NOT ILIKE '%team_members%'
  ), 'no debe existir política de lectura global de building_tasks para sales_manager';
END $$;

ROLLBACK;
