-- =====================================================================
-- SALES_MANAGER P0.3 — Cierre de public.has_role(uuid, app_role)
-- ---------------------------------------------------------------------
-- Porta TODOS los consumidores históricos y luego revoca has_role a
-- PUBLIC/anon/authenticated. Es forward: no reescribe migraciones ya
-- aplicadas; reescribe en caliente los objetos que aquéllas crearon.
--
-- Semántica de cada llamada:
--   * has_role(auth.uid(), X) en POLÍTICAS  -> comprobación del PROPIO
--     usuario -> public.current_user_has_role(X)  (sin user_id).
--   * has_role(<otro uuid>, X) dentro de funciones SECURITY DEFINER ->
--     public.internal_member_has_role(uuid, X), revocada a
--     PUBLIC/anon/authenticated: sólo la invocan funciones internas.
--
-- Si al final del preflight queda UN solo consumidor, la migración aborta
-- (NO-GO) y no revoca nada: es fail-closed.
-- =====================================================================

-- --- 0. Requisitos: los dos sustitutos deben existir -------------------
DO $$
BEGIN
  IF to_regprocedure('public.current_user_has_role(public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'falta public.current_user_has_role(app_role): aplica antes sales_manager_phase_b';
  END IF;
  IF to_regprocedure('public.internal_member_has_role(uuid, public.app_role)') IS NULL THEN
    RAISE EXCEPTION 'falta public.internal_member_has_role(uuid, app_role): aplica antes sales_manager_phase_b';
  END IF;
END $$;

-- --- 1. Políticas RLS: has_role(auth.uid(), X) -> current_user_has_role(X)
DO $port$
DECLARE
  r        record;
  v_using  text;
  v_check  text;
  v_sql    text;
  v_rx     constant text :=
    '(?:public\.)?has_role\(\s*auth\.uid\(\)\s*,\s*(''[a-z_]+''(?:::(?:public\.)?app_role)?)\s*\)';
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname,
           pg_get_expr(pol.polqual,      pol.polrelid) AS qual,
           pg_get_expr(pol.polwithcheck, pol.polrelid) AS withcheck
    FROM pg_policies pp
    JOIN pg_policy pol ON pol.polname = pp.policyname
     AND pol.polrelid = (quote_ident(pp.schemaname) || '.' || quote_ident(pp.tablename))::regclass
    WHERE COALESCE(pp.qual, '') || COALESCE(pp.with_check, '') LIKE '%has_role(%'
  LOOP
    v_using := regexp_replace(r.qual,      v_rx, 'public.current_user_has_role(\1)', 'g');
    v_check := regexp_replace(r.withcheck, v_rx, 'public.current_user_has_role(\1)', 'g');

    IF v_using IS NOT NULL AND v_using ~ 'has_role\(\s*auth\.uid' THEN
      RAISE EXCEPTION 'política % en %.%: expresión USING no portable', r.policyname, r.schemaname, r.tablename;
    END IF;

    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF v_using IS NOT NULL THEN v_sql := v_sql || format(' USING (%s)', v_using); END IF;
    IF v_check IS NOT NULL THEN v_sql := v_sql || format(' WITH CHECK (%s)', v_check); END IF;
    EXECUTE v_sql;
  END LOOP;
END $port$;

-- --- 2. Funciones/RPC: has_role(<uuid>, X) -> internal_member_has_role ---
DO $fn$
DECLARE
  r     record;
  v_def text;
  v_rx  constant text :=
    '(?:public\.)?has_role\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*,\s*(''[a-z_]+''(?:::(?:public\.)?app_role)?)\s*\)';
BEGIN
  FOR r IN
    SELECT p.oid, n.nspname, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc LIKE '%has_role(%'
      AND p.proname NOT IN ('has_role', 'current_user_has_role', 'internal_member_has_role')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_def := regexp_replace(v_def, '(?:public\.)?has_role\(\s*auth\.uid\(\)\s*,\s*(''[a-z_]+''(?:::(?:public\.)?app_role)?)\s*\)',
                            'public.current_user_has_role(\1)', 'g');
    v_def := regexp_replace(v_def, v_rx, 'public.internal_member_has_role(\1, \2)', 'g');
    IF v_def ~ '[^_]has_role\(' THEN
      RAISE EXCEPTION 'función %.% mantiene llamadas a has_role no portables', r.nspname, r.proname;
    END IF;
    EXECUTE v_def;
  END LOOP;
END $fn$;

-- --- 3. Vistas y triggers: preflight de dependencias restantes ----------
DO $chk$
DECLARE
  v_pol int;
  v_fn  int;
  v_dep int;
BEGIN
  SELECT count(*) INTO v_pol FROM pg_policies
   WHERE (COALESCE(qual,'') || COALESCE(with_check,'')) ~ '[^_]has_role\(';

  SELECT count(*) INTO v_fn FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ~ '[^_]has_role\('
     AND p.proname NOT IN ('has_role','current_user_has_role','internal_member_has_role');

  SELECT count(*) INTO v_dep
    FROM pg_depend d
   WHERE d.refobjid = to_regprocedure('public.has_role(uuid, public.app_role)')::oid
     AND d.deptype <> 'i'
     AND d.classid <> 'pg_namespace'::regclass;

  IF v_pol > 0 OR v_fn > 0 OR v_dep > 0 THEN
    RAISE EXCEPTION
      'NO-GO: quedan consumidores de has_role (políticas=%, funciones=%, pg_depend=%). No se revoca nada.',
      v_pol, v_fn, v_dep;
  END IF;
END $chk$;

-- --- 4. Cierre efectivo -------------------------------------------------
-- authenticated ya NO puede preguntar por el rol de un UUID ajeno.
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;

-- Reafirma el reparto de los sustitutos (idempotente).
REVOKE ALL ON FUNCTION public.current_user_has_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.internal_member_has_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_member_has_role(uuid, public.app_role) TO service_role;

-- --- 5. Verificación final: ningún rol de cliente conserva EXECUTE ------
DO $ver$
BEGIN
  IF has_function_privilege('authenticated', 'public.has_role(uuid, public.app_role)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.has_role(uuid, public.app_role)', 'EXECUTE') THEN
    RAISE EXCEPTION 'has_role sigue siendo ejecutable por un rol de cliente';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.current_user_has_role(public.app_role)', 'EXECUTE') THEN
    RAISE EXCEPTION 'current_user_has_role debe ser ejecutable por authenticated';
  END IF;
END $ver$;
