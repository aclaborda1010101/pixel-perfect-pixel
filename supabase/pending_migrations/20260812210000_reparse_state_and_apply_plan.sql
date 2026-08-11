-- =====================================================================
-- REPARSEO P0.4 · Estado singleton de matching + aplicación transaccional
-- MIGRACIÓN PENDIENTE — NO APLICADA. Sin datos, sin cron, sin deploy.
-- =====================================================================
-- 1) public.notas_reparse_state: singleton (id='singleton') con
--    match_pending boolean y generation bigint. Es la ÚNICA fuente de
--    verdad del pendiente de emparejado. El log es auditoría.
-- 2) reparse_mark_match_pending()  -> incrementa generation y deja
--    pending=true; devuelve el token (generation).
-- 3) reparse_clear_match_pending(expected) -> CAS: sólo limpia si la
--    generación coincide. Una limpieza obsoleta no borra un pendiente
--    nuevo.
-- 4) apply_nota_reparse_plan(payload) -> transacción única: bloquea la
--    nota por id + claim_token vigente, aplica updates/inserts de
--    titulares de ESA nota comprobando counts y finaliza. Cualquier
--    fallo => excepción => rollback total.
-- Todo service-only: RLS activa sin políticas y EXECUTE revocado a
-- PUBLIC/anon/authenticated.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.notas_reparse_state (
  id            text PRIMARY KEY DEFAULT 'singleton' CHECK (id = 'singleton'),
  match_pending boolean     NOT NULL DEFAULT false,
  generation    bigint      NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.notas_reparse_state FROM PUBLIC;
GRANT ALL ON public.notas_reparse_state TO service_role;
-- Sin GRANT a anon/authenticated: estado interno del worker.

ALTER TABLE public.notas_reparse_state ENABLE ROW LEVEL SECURITY;
-- Sin políticas: sólo service_role (bypass RLS) puede tocarla.

INSERT INTO public.notas_reparse_state (id) VALUES ('singleton')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- Lectura atómica del estado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reparse_match_state_read()
RETURNS TABLE (match_pending boolean, generation bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.match_pending, s.generation
  FROM public.notas_reparse_state s
  WHERE s.id = 'singleton'
$$;

-- ---------------------------------------------------------------------
-- Marcar pendiente ANTES de tocar ninguna nota. Devuelve el token.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reparse_mark_match_pending()
RETURNS bigint
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gen bigint;
BEGIN
  INSERT INTO public.notas_reparse_state (id, match_pending, generation)
  VALUES ('singleton', true, 1)
  ON CONFLICT (id) DO UPDATE
    SET match_pending = true,
        generation    = public.notas_reparse_state.generation + 1,
        updated_at    = now()
  RETURNING generation INTO v_gen;

  IF v_gen IS NULL THEN
    RAISE EXCEPTION 'reparse_mark_match_pending: sin generación';
  END IF;
  RETURN v_gen;
END;
$$;

-- ---------------------------------------------------------------------
-- Limpiar SOLO con CAS sobre la generación esperada.
-- Devuelve true si limpió; false si otra ejecución avanzó la generación
-- (el pendiente nuevo se conserva).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reparse_clear_match_pending(p_expected_generation bigint)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows int;
BEGIN
  IF p_expected_generation IS NULL OR p_expected_generation < 0 THEN
    RAISE EXCEPTION 'reparse_clear_match_pending: generación inválida';
  END IF;

  UPDATE public.notas_reparse_state
     SET match_pending = false,
         updated_at    = now()
   WHERE id = 'singleton'
     AND generation = p_expected_generation;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END;
$$;

-- ---------------------------------------------------------------------
-- Aplicación transaccional del plan de una nota (claim-scoped)
-- payload:
--   { nota_id uuid, claim_token text,
--     updates: [ { id uuid, patch: { rol, rol_literal, evidencia } } ],
--     inserts: [ { nombre_extraido, cif_dni, porcentaje, rol,
--                  rol_literal, evidencia } ],
--     structured jsonb, raw_pdf_text text, attempt_count int }
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_nota_reparse_plan(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nota_id     uuid;
  v_claim       text;
  v_locked      uuid;
  v_upd         jsonb;
  v_ins         jsonb;
  v_patch       jsonb;
  v_rows        int;
  v_updated     int := 0;
  v_inserted    int := 0;
  v_attempt     int;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: payload inválido';
  END IF;

  v_nota_id := nullif(p_payload->>'nota_id','')::uuid;
  v_claim   := nullif(p_payload->>'claim_token','');
  IF v_nota_id IS NULL OR v_claim IS NULL THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: nota_id/claim_token requeridos';
  END IF;
  IF jsonb_typeof(coalesce(p_payload->'structured','null')) <> 'object' THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: structured requerido';
  END IF;
  IF jsonb_typeof(coalesce(p_payload->'updates','[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'inserts','[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'apply_nota_reparse_plan: updates/inserts deben ser arrays';
  END IF;

  -- 1) Bloqueo de la nota por id + claim vigente: exactamente una fila.
  SELECT n.id INTO v_locked
    FROM public.notas_simples n
   WHERE n.id = v_nota_id
     AND n.claimed_at IS NOT NULL
     AND n.claimed_at::text = v_claim
   FOR UPDATE;

  IF v_locked IS NULL THEN
    RAISE EXCEPTION 'claim_lost: nota % sin claim vigente', v_nota_id
      USING ERRCODE = 'P0001';
  END IF;

  -- 2) UPDATES de titulares, sólo de esta nota, exactamente 1 fila cada uno.
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
       AND t.nota_simple_id = v_nota_id;

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
      v_nota_id,
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

  -- 4) Finalización de la nota, todavía dentro del claim.
  v_attempt := coalesce(nullif(p_payload->>'attempt_count','')::int, 0);

  UPDATE public.notas_simples n
     SET raw_pdf_text    = nullif(p_payload->>'raw_pdf_text',''),
         structured_json = p_payload->'structured',
         attempt_count   = v_attempt,
         last_error      = NULL,
         next_retry_at   = NULL,
         claimed_at      = NULL
   WHERE n.id = v_nota_id
     AND n.claimed_at IS NOT NULL
     AND n.claimed_at::text = v_claim;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'finalize_fail: % filas para nota %', v_rows, v_nota_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'nota_id', v_nota_id,
    'updated', v_updated,
    'inserted', v_inserted,
    'finalized', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reparse_match_state_read()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reparse_mark_match_pending()             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reparse_clear_match_pending(bigint)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_nota_reparse_plan(jsonb)           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reparse_match_state_read()          TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_mark_match_pending()        TO service_role;
GRANT EXECUTE ON FUNCTION public.reparse_clear_match_pending(bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_nota_reparse_plan(jsonb)      TO service_role;
