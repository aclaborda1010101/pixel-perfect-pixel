-- =====================================================================
-- REPARSEO P0.6 · LEASE VIGENTE EN TODA MUTACIÓN + REAPER SERVER-SIDE
-- MIGRACIÓN PENDIENTE — NO APLICADA. Sin datos, sin cron, sin deploy.
-- ---------------------------------------------------------------------
-- Cierra el NO-GO db7c82ce:
--  1) reparse_fail_nota y release_nota_reparse_claim exigen id + token Y
--     lease VIGENTE (claim_expires_at > now()). Un token caducado no marca
--     retry ni libera nada: el worker viejo deja de tener autoridad.
--     apply_nota_reparse_plan ya lo exigía (P0.5) y se conserva.
--  2) La limpieza de claims caducados NO la hace el worker: existe una
--     rutina de reaper server-side, reparse_reap_expired_claims(), que sólo
--     toca filas con claim_expires_at <= now().
--  3) Permisos: sólo service_role ejecuta; ni PUBLIC, ni anon, ni
--     authenticated. search_path fijo, sin SQL dinámico.
-- =====================================================================

-- --- 0. Preflight: P0.5 debe estar aplicada ---------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.apply_nota_reparse_plan(uuid, uuid, jsonb)') IS NULL
     OR to_regprocedure('public.release_nota_reparse_claim(uuid, uuid)') IS NULL
     OR to_regprocedure('public.reparse_fail_nota(uuid, uuid, text, integer, timestamptz, boolean)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT P0.6: falta la migración de claim token P0.5';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.notas_simples'::regclass
       AND attname = 'claim_expires_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT P0.6: falta notas_simples.claim_expires_at';
  END IF;
END
$pre$;

-- --- 1. Liberación CAS: id + token + LEASE VIGENTE --------------------
CREATE OR REPLACE FUNCTION public.release_nota_reparse_claim(
  p_id uuid,
  p_expected_token uuid
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_id IS NULL OR p_expected_token IS NULL THEN
    RAISE EXCEPTION 'release_nota_reparse_claim: id/token requeridos';
  END IF;

  UPDATE public.notas_simples n
     SET claim_token      = NULL,
         claim_expires_at = NULL,
         claimed_at       = NULL
   WHERE n.id = p_id
     AND n.claim_token = p_expected_token
     AND n.claim_expires_at IS NOT NULL
     AND n.claim_expires_at > now()   -- lease caducado => sin autoridad
  RETURNING n.id INTO v_id;

  RETURN v_id;  -- NULL => el claim ya no era nuestro o ya expiró.
END $$;

-- --- 2. Cierre de intento fallido: sólo dentro del lease --------------
CREATE OR REPLACE FUNCTION public.reparse_fail_nota(
  p_id uuid,
  p_expected_token uuid,
  p_last_error text,
  p_attempt integer,
  p_next_retry_at timestamptz,
  p_dead boolean
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_id IS NULL OR p_expected_token IS NULL THEN
    RAISE EXCEPTION 'reparse_fail_nota: id/token requeridos';
  END IF;

  UPDATE public.notas_simples n
     SET attempt_count    = greatest(0, coalesce(p_attempt, n.attempt_count)),
         last_error       = left(coalesce(p_last_error, 'desconocido'), 500),
         next_retry_at    = CASE WHEN coalesce(p_dead, false) THEN NULL ELSE p_next_retry_at END,
         dead_letter      = coalesce(p_dead, false),
         claimed_at       = NULL,
         claim_token      = NULL,
         claim_expires_at = NULL
   WHERE n.id = p_id
     AND n.claim_token = p_expected_token
     AND n.claim_expires_at IS NOT NULL
     AND n.claim_expires_at > now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END $$;

-- --- 3. Reaper: ÚNICA vía de limpieza de leases caducados -------------
-- No procesa nada ni genera trabajo: sólo devuelve al pool las filas cuyo
-- lease ya expiró. Es server-side y no depende de ningún worker vivo.
CREATE OR REPLACE FUNCTION public.reparse_reap_expired_claims()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  UPDATE public.notas_simples n
     SET claim_token      = NULL,
         claim_expires_at = NULL,
         claimed_at       = NULL
   WHERE n.claim_token IS NOT NULL
     AND n.claim_expires_at IS NOT NULL
     AND n.claim_expires_at <= now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END $$;

-- --- 4. Permisos ------------------------------------------------------
REVOKE ALL ON FUNCTION public.release_nota_reparse_claim(uuid, uuid)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reparse_fail_nota(uuid, uuid, text, integer, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reparse_reap_expired_claims()                                      FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.release_nota_reparse_claim(uuid, uuid)                             TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_fail_nota(uuid, uuid, text, integer, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_reap_expired_claims()                                      TO service_role;

-- --- 5. Verificación por DEFINICIÓN, no por existencia -----------------
DO $verify$
DECLARE v_src text;
BEGIN
  FOR v_src IN
    SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('release_nota_reparse_claim','reparse_fail_nota','apply_nota_reparse_plan')
  LOOP
    IF v_src NOT LIKE '%claim_expires_at > now()%' THEN
      RAISE EXCEPTION 'P0.6: una RPC de mutación no exige lease vigente: %', left(v_src, 120);
    END IF;
    IF v_src NOT LIKE '%SET search_path%' THEN
      RAISE EXCEPTION 'P0.6: RPC sin search_path fijo: %', left(v_src, 120);
    END IF;
  END LOOP;

  IF has_function_privilege('anon','public.reparse_reap_expired_claims()','EXECUTE')
     OR has_function_privilege('authenticated','public.reparse_reap_expired_claims()','EXECUTE') THEN
    RAISE EXCEPTION 'P0.6: el reaper es ejecutable por roles de cliente';
  END IF;
  IF NOT has_function_privilege('service_role','public.reparse_reap_expired_claims()','EXECUTE') THEN
    RAISE EXCEPTION 'P0.6: service_role no puede ejecutar el reaper';
  END IF;
END
$verify$;
