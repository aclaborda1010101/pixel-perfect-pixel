-- =====================================================================
-- REPARSEO P0.8 — PRECISIÓN EXACTA, COMPLETITUD FAIL-CLOSED Y CAST ENUM
-- =====================================================================
-- Migración FORWARD (pendiente de aprobación; NO se aplica desde aquí).
--
-- Cierra tres agujeros reales del canario P0.7:
--
--  1) CAST ENUM. El hotfix aplicado en vivo queda codificado: `rol` es
--     public.nota_titular_rol y el payload llega como texto JSON. Todos los
--     accesos usan cast EXPLÍCITO a public.nota_titular_rol; sin él la RPC
--     abortaba con "column rol is of type nota_titular_rol but expression is
--     of type text".
--
--  2) PRECISIÓN. `porcentaje` es numeric sin escala: se persiste el valor de
--     la FUENTE con al menos 6 decimales. La RPC rechaza cualquier porcentaje
--     fuera de [0,100] y permite además actualizar porcentajes ya escritos con
--     redondeo (las 29 filas del canario) para reconciliar sin duplicar.
--
--  3) COMPLETITUD. reparse_done='1' / schema v2 SÓLO si el JSON de
--     completitud viene y dice ok=true con expected=materialized>0. En caso
--     contrario la transacción entera aborta: ni titulares, ni finalize.
--
-- Todo ocurre dentro de UNA transacción: si falla el derecho 66, no queda
-- estado final ni filas huérfanas.

BEGIN;

CREATE OR REPLACE FUNCTION public.apply_nota_reparse_plan(
  p_nota_id     uuid,
  p_claim_token uuid,
  p_payload     jsonb
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_locked   uuid;
  v_upd      jsonb;
  v_ins      jsonb;
  v_patch    jsonb;
  v_rows     int;
  v_updated  int := 0;
  v_inserted int := 0;
  v_attempt  int;
  v_pct      numeric;
  v_comp     jsonb;
  v_expected int;
  v_material int;
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

  -- 0) COMPLETITUD FAIL-CLOSED: sin evidencia de 1:1 no se escribe nada.
  v_comp := p_payload->'structured'->'completeness';
  IF jsonb_typeof(coalesce(v_comp,'null')) <> 'object' THEN
    RAISE EXCEPTION 'completeness_ausente: la nota % no puede finalizar sin inventario', p_nota_id
      USING ERRCODE = 'P0001';
  END IF;
  v_expected := coalesce(nullif(v_comp->>'expected','')::int, -1);
  v_material := coalesce(nullif(v_comp->>'materialized','')::int, -1);
  IF coalesce(v_comp->>'ok','false') <> 'true'
     OR v_expected <= 0
     OR v_expected <> v_material THEN
    RAISE EXCEPTION 'completeness_fail: expected=% materialized=% motivo=%',
      v_expected, v_material, coalesce(v_comp->>'motivo','desconocido')
      USING ERRCODE = 'P0001';
  END IF;

  -- 1) Bloqueo por id + TOKEN + lease vigente.
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

  -- 2) UPDATES: cast explícito de rol y porcentaje EXACTO (sin redondeo).
  FOR v_upd IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'updates','[]'::jsonb))
  LOOP
    IF nullif(v_upd->>'id','') IS NULL THEN
      RAISE EXCEPTION 'apply_nota_reparse_plan: update sin id';
    END IF;
    v_patch := coalesce(v_upd->'patch','{}'::jsonb);

    IF v_patch ? 'porcentaje' AND nullif(v_patch->>'porcentaje','') IS NOT NULL THEN
      v_pct := (v_patch->>'porcentaje')::numeric;
      IF v_pct < 0 OR v_pct > 100 THEN
        RAISE EXCEPTION 'porcentaje_fuera_de_rango: % (titular %)', v_pct, v_upd->>'id';
      END IF;
    END IF;

    UPDATE public.nota_simple_titulares t
       SET rol         = COALESCE(
                           nullif(v_patch->>'rol','')::public.nota_titular_rol,
                           t.rol),
           rol_literal = CASE WHEN v_patch ? 'rol_literal'
                              THEN nullif(v_patch->>'rol_literal','')
                              ELSE t.rol_literal END,
           porcentaje  = CASE WHEN v_patch ? 'porcentaje'
                              THEN nullif(v_patch->>'porcentaje','')::numeric
                              ELSE t.porcentaje END,
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

  -- 3) INSERTS: cast explícito de rol; porcentaje exacto validado.
  FOR v_ins IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'inserts','[]'::jsonb))
  LOOP
    IF nullif(v_ins->>'nombre_extraido','') IS NULL THEN
      RAISE EXCEPTION 'apply_nota_reparse_plan: insert sin nombre_extraido';
    END IF;

    v_pct := CASE WHEN nullif(v_ins->>'porcentaje','') IS NULL THEN NULL
                  ELSE (v_ins->>'porcentaje')::numeric END;
    IF v_pct IS NOT NULL AND (v_pct < 0 OR v_pct > 100) THEN
      RAISE EXCEPTION 'porcentaje_fuera_de_rango: % (%)', v_pct, v_ins->>'nombre_extraido';
    END IF;

    INSERT INTO public.nota_simple_titulares
      (nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, evidencia)
    VALUES (
      p_nota_id,
      v_ins->>'nombre_extraido',
      nullif(v_ins->>'cif_dni',''),
      v_pct,
      coalesce(nullif(v_ins->>'rol',''), 'otro')::public.nota_titular_rol,
      nullif(v_ins->>'rol_literal',''),
      v_ins->'evidencia'
    );

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION 'titular_insert_fail: % filas', v_rows;
    END IF;
    v_inserted := v_inserted + 1;
  END LOOP;

  -- 3.b) Invariante final: la nota debe quedar con EXACTAMENTE los hechos
  --      esperados. Cualquier residuo (las 29 filas parciales del canario,
  --      duplicados, sobrantes) aborta la transacción entera.
  SELECT count(*) INTO v_rows
    FROM public.nota_simple_titulares t
   WHERE t.nota_simple_id = p_nota_id;
  IF v_rows <> v_expected THEN
    RAISE EXCEPTION 'completeness_post_apply: % filas en la nota, esperadas %', v_rows, v_expected
      USING ERRCODE = 'P0001';
  END IF;

  -- 4) Finalización en la misma transacción y sólo con nuestro token.
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
    'finalized', true,
    'expected', v_expected
  );
END $fn$;

REVOKE ALL ON FUNCTION public.apply_nota_reparse_plan(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_nota_reparse_plan(uuid, uuid, jsonb) TO service_role;

-- Verificación fail-closed del contrato de esta migración.
DO $v$
DECLARE v_src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'apply_nota_reparse_plan';
  IF v_src IS NULL OR position('::public.nota_titular_rol' in v_src) = 0 THEN
    RAISE EXCEPTION 'P0.8: falta el cast explícito a public.nota_titular_rol';
  END IF;
  IF position('completeness_fail' in v_src) = 0 THEN
    RAISE EXCEPTION 'P0.8: falta la puerta de completitud';
  END IF;
  IF has_function_privilege('anon','public.apply_nota_reparse_plan(uuid, uuid, jsonb)','EXECUTE')
     OR has_function_privilege('authenticated','public.apply_nota_reparse_plan(uuid, uuid, jsonb)','EXECUTE') THEN
    RAISE EXCEPTION 'P0.8: la RPC es ejecutable por roles de cliente';
  END IF;
END $v$;

COMMIT;
