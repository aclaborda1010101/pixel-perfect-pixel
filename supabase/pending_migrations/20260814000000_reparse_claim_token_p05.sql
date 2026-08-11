-- =====================================================================
-- REPARSEO P0.5 · Claim TOKEN opaco (uuid) + liberación CAS + permisos
-- MIGRACIÓN PENDIENTE — NO APLICADA. Sin datos, sin cron, sin deploy.
-- ---------------------------------------------------------------------
-- Cierra el NO-GO e31adf3a:
--  1) El claim deja de ser `claimed_at` serializado a texto. Se añade
--     claim_token uuid + claim_expires_at timestamptz. El token lo genera
--     SIEMPRE el servidor (reparse_claim_batch) y jamás el worker.
--  2) apply_nota_reparse_plan recibe el token TIPADO (uuid): bloquea por
--     id + claim_token + no expirado. Nunca compara timestamptz::text con
--     una cadena ISO de JavaScript.
--  3) release_nota_reparse_claim / reparse_fail_nota liberan por CAS
--     (id + token). Un worker viejo NO pisa el claim de uno nuevo.
--  4) notas_reparse_state deja de tener GRANT directo alguno: ni PUBLIC,
--     ni anon, ni authenticated, ni service_role. Sólo se toca por las
--     RPC SECURITY DEFINER, con search_path fijo y sin SQL dinámico.
-- =====================================================================

-- --- 1. Columnas de claim opaco ---------------------------------------
ALTER TABLE public.notas_simples
  ADD COLUMN IF NOT EXISTS claim_token      uuid,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_notas_simples_claim_token
  ON public.notas_simples(claim_token) WHERE claim_token IS NOT NULL;

-- --- 2. Reclamo de lote: el TOKEN lo asigna el servidor ----------------
CREATE OR REPLACE FUNCTION public.reparse_claim_batch(
  p_limit integer DEFAULT 12,
  p_lock_minutes integer DEFAULT 10
)
RETURNS SETOF public.notas_simples
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min integer := greatest(1, least(coalesce(p_lock_minutes, 10), 120));
  v_lim integer := greatest(1, least(coalesce(p_limit, 12), 50));
BEGIN
  RETURN QUERY
  UPDATE public.notas_simples n
     SET claimed_at       = now(),
         claim_token      = gen_random_uuid(),
         claim_expires_at = now() + make_interval(mins => v_min)
   WHERE n.id IN (
     SELECT c.id FROM public.notas_simples c
      WHERE c.status = 'listo'
        AND c.dead_letter = false
        AND (c.building_id IS NULL OR c.structured_json->>'needs_extract' = '1')
        AND coalesce(c.structured_json->>'reparse_done','') <> '1'
        AND (c.next_retry_at IS NULL OR c.next_retry_at <= now())
        -- Sólo libres o con claim CADUCADO (comparación de timestamptz, no de texto).
        AND (c.claim_token IS NULL OR c.claim_expires_at IS NULL OR c.claim_expires_at <= now())
      ORDER BY c.attempt_count ASC, c.created_at ASC
      LIMIT v_lim
      FOR UPDATE SKIP LOCKED
   )
  RETURNING n.*;
END $$;

-- --- 3. Liberación CAS: sólo el dueño del token libera -----------------
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
  RETURNING n.id INTO v_id;

  RETURN v_id;  -- NULL => el claim ya no era nuestro: no se pisa nada.
END $$;

-- --- 4. Cierre de intento fallido (retry) dentro del claim -------------
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
     AND n.claim_token = p_expected_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END $$;

-- --- 5. Aplicación transaccional con token UUID tipado -----------------
-- Firma nueva: (uuid, uuid, jsonb). La antigua (jsonb) se retira: comparaba
-- claimed_at::text con una cadena ISO generada en JS.
DROP FUNCTION IF EXISTS public.apply_nota_reparse_plan(jsonb);

CREATE OR REPLACE FUNCTION public.apply_nota_reparse_plan(
  p_nota_id uuid,
  p_claim_token uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_locked   uuid;
  v_upd      jsonb;
  v_ins      jsonb;
  v_patch    jsonb;
  v_rows     int;
  v_updated  int := 0;
  v_inserted int := 0;
  v_attempt  int;
BEGIN
  IF p_nota_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: nota_id/claim_token requeridos';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: payload inválido';
  END IF;
  IF jsonb_typeof(coalesce(p_payload->'structured','null')) <> 'object' THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: structured requerido';
  END IF;
  IF jsonb_typeof(coalesce(p_payload->'updates','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'inserts','[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: updates/inserts deben ser arrays';
  END IF;

  -- 1) Bloqueo por id + TOKEN + no expirado (todo tipado).
  SELECT n.id INTO v_locked
    FROM public.notas_simples n
   WHERE n.id = p_nota_id
     AND n.claim_token = p_claim_token
     AND n.claim_expires_at IS NOT NULL
     AND n.claim_expires_at > now()
   FOR UPDATE;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'claim_lost: nota % sin claim vigente', p_nota_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 2) UPDATES de titulares de ESTA nota: exactamente una fila cada uno.
  FOR v_upd IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'updates','[]'::jsonb))
  LOOP
    IF nullif(v_upd->>'id','') IS NULL THEN
      RAISE EXCEPTION 'apply_nota_reparse_plan: update sin id';
    END IF;
    v_patch := coalesce(v_upd->'patch','{}'::jsonb);

    UPDATE public.nota_simple_titulares t
       SET rol         = COALESCE(nullif(v_patch->>'rol',''), t.rol),
           rol_literal = CASE WHEN v_patch ? 'rol_literal'
                              THEN nullif(v_patch->>'rol_literal','')
                              ELSE t.rol_literal END,
           evidencia   = CASE WHEN v_patch ? 'evidencia'
                              THEN v_patch->'evidencia'
                              ELSE t.evidencia END
     WHERE t.id = (v_upd->>'id')::uuid
       AND t.nota_simple_id = p_nota_id;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'titular_update_fail: % filas para titular %', v_rows, v_upd->>'id';
    END IF;
    v_updated := v_updated + 1;
  END LOOP;

  -- 3) INSERTS de titulares de esta nota.
  FOR v_ins IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'inserts','[]'::jsonb))
  LOOP
    IF nullif(v_ins->>'nombre_extraido','') IS NULL THEN
      RAISE EXCEPTION 'apply_nota_reparse_plan: insert sin nombre_extraido';
    END IF;

    INSERT INTO public.nota_simple_titulares
      (nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, evidencia)
    VALUES (
      p_nota_id,
      v_ins->>'nombre_extraido',
      nullif(v_ins->>'cif_dni',''),
      CASE WHEN nullif(v_ins->>'porcentaje','') IS NULL THEN NULL
           ELSE (v_ins->>'porcentaje')::numeric END,
      coalesce(nullif(v_ins->>'rol',''), 'otro'),
      nullif(v_ins->>'rol_literal',''),
      v_ins->'evidencia'
    );

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'titular_insert_fail: % filas', v_rows;
    END IF;
    v_inserted := v_inserted + 1;
  END LOOP;

  -- 4) Finalización: misma transacción y sólo si el token sigue siendo el nuestro.
  v_attempt := coalesce(nullif(p_payload->>'attempt_count','')::int, 0);

  UPDATE public.notas_simples n
     SET raw_pdf_text     = nullif(p_payload->>'raw_pdf_text',''),
         structured_json  = p_payload->'structured',
         attempt_count    = v_attempt,
         last_error       = NULL,
         next_retry_at    = NULL,
         claimed_at       = NULL,
         claim_token      = NULL,
         claim_expires_at = NULL
   WHERE n.id = p_nota_id
     AND n.claim_token = p_claim_token;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'finalize_fail: % filas para nota %', v_rows, p_nota_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'nota_id', p_nota_id,
    'updated', v_updated,
    'inserted', v_inserted,
    'finalized', true
  );
END $$;

-- --- 6. Permisos: la tabla de estado no es modificable directamente ----
REVOKE ALL ON public.notas_reparse_state FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.reparse_claim_batch(integer, integer)                       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_nota_reparse_claim(uuid, uuid)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reparse_fail_nota(uuid, uuid, text, integer, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_nota_reparse_plan(uuid, uuid, jsonb)                  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reparse_claim_batch(integer, integer)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.release_nota_reparse_claim(uuid, uuid)                      TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_fail_nota(uuid, uuid, text, integer, timestamptz, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_nota_reparse_plan(uuid, uuid, jsonb)                  TO service_role;

-- --- 7. Verificación fail-closed ---------------------------------------
DO $$
BEGIN
  IF has_table_privilege('service_role', 'public.notas_reparse_state', 'INSERT')
     OR has_table_privilege('service_role', 'public.notas_reparse_state', 'UPDATE')
     OR has_table_privilege('service_role', 'public.notas_reparse_state', 'SELECT')
     OR has_table_privilege('authenticated', 'public.notas_reparse_state', 'SELECT')
     OR has_table_privilege('anon', 'public.notas_reparse_state', 'SELECT') THEN
    RAISE EXCEPTION 'notas_reparse_state sigue siendo accesible directamente';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.apply_nota_reparse_plan(uuid, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role no puede ejecutar apply_nota_reparse_plan';
  END IF;
END $$;
