-- REPARSEO P0.10 — exact-set 29→66, diagnóstico durable y superficie RPC cerrada.
-- Pendiente: NO aplicada por este cambio.
BEGIN;

DROP FUNCTION IF EXISTS public.apply_nota_reparse_plan(jsonb);

CREATE OR REPLACE FUNCTION public.apply_nota_reparse_plan(
  p_nota_id uuid, p_claim_token uuid, p_payload jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_locked uuid; v_obj jsonb; v_patch jsonb; v_id uuid; v_rows int;
  v_updated int := 0; v_inserted int := 0; v_deleted int := 0;
  v_expected int; v_actual int; v_pct numeric; v_comp jsonb;
  v_update_ids uuid[] := '{}'; v_delete_ids uuid[] := '{}';
BEGIN
  IF p_nota_id IS NULL OR p_claim_token IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p10_payload_invalido';
  END IF;
  IF jsonb_typeof(coalesce(p_payload->'updates','[]')) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'inserts','[]')) <> 'array'
     OR jsonb_typeof(coalesce(p_payload->'deletes','[]')) <> 'array' THEN
    RAISE EXCEPTION 'p10_arrays_invalidos';
  END IF;

  v_comp := p_payload->'structured'->'completeness';
  v_expected := coalesce(nullif(v_comp->>'expected','')::int, -1);
  v_actual := coalesce(nullif(v_comp->>'materialized','')::int, -1);
  IF jsonb_typeof(coalesce(v_comp,'null')) <> 'object'
     OR coalesce(v_comp->>'ok','false') <> 'true'
     OR v_expected <= 0 OR v_actual <> v_expected THEN
    RAISE EXCEPTION 'completeness_fail: expected=% actual=%', v_expected, v_actual;
  END IF;

  SELECT id INTO v_locked FROM public.notas_simples
   WHERE id=p_nota_id AND claim_token=p_claim_token
     AND claim_expires_at IS NOT NULL AND claim_expires_at > now()
   FOR UPDATE;
  IF v_locked IS NULL THEN RAISE EXCEPTION 'claim_lost'; END IF;

  FOR v_obj IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'updates','[]')) LOOP
    v_id := nullif(v_obj->>'id','')::uuid;
    IF v_id IS NULL OR v_id = ANY(v_update_ids) THEN RAISE EXCEPTION 'p10_update_id_invalido_o_duplicado'; END IF;
    v_update_ids := array_append(v_update_ids,v_id);
  END LOOP;
  FOR v_obj IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'deletes','[]')) LOOP
    v_id := nullif(CASE WHEN jsonb_typeof(v_obj)='string' THEN v_obj#>>'{}' ELSE v_obj->>'id' END,'')::uuid;
    IF v_id IS NULL OR v_id = ANY(v_delete_ids) OR v_id = ANY(v_update_ids) THEN RAISE EXCEPTION 'p10_delete_id_invalido_duplicado_o_solapado'; END IF;
    v_delete_ids := array_append(v_delete_ids,v_id);
  END LOOP;

  FOREACH v_id IN ARRAY v_delete_ids LOOP
    DELETE FROM public.nota_simple_titulares WHERE id=v_id AND nota_simple_id=p_nota_id;
    GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'titular_delete_fail:%',v_id; END IF;
    v_deleted:=v_deleted+1;
  END LOOP;

  FOR v_obj IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'updates','[]')) LOOP
    v_patch:=coalesce(v_obj->'patch','{}'); v_id:=(v_obj->>'id')::uuid;
    v_pct:=CASE WHEN v_patch?'porcentaje' THEN nullif(v_patch->>'porcentaje','')::numeric ELSE NULL END;
    IF v_pct IS NOT NULL AND (v_pct<0 OR v_pct>100) THEN RAISE EXCEPTION 'porcentaje_fuera_de_rango'; END IF;
    UPDATE public.nota_simple_titulares t SET
      rol=coalesce(nullif(v_patch->>'rol','')::public.nota_titular_rol,t.rol),
      rol_literal=CASE WHEN v_patch?'rol_literal' THEN nullif(v_patch->>'rol_literal','') ELSE t.rol_literal END,
      porcentaje=CASE WHEN v_patch?'porcentaje' THEN v_pct ELSE t.porcentaje END,
      evidencia=CASE WHEN v_patch?'evidencia' THEN v_patch->'evidencia' ELSE t.evidencia END
    WHERE t.id=v_id AND t.nota_simple_id=p_nota_id;
    GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'titular_update_fail:%',v_id; END IF;
    v_updated:=v_updated+1;
  END LOOP;

  FOR v_obj IN SELECT * FROM jsonb_array_elements(coalesce(p_payload->'inserts','[]')) LOOP
    IF nullif(v_obj->>'nombre_extraido','') IS NULL THEN RAISE EXCEPTION 'insert_sin_nombre'; END IF;
    v_pct:=nullif(v_obj->>'porcentaje','')::numeric;
    IF v_pct IS NULL OR v_pct<0 OR v_pct>100 THEN RAISE EXCEPTION 'porcentaje_invalido'; END IF;
    INSERT INTO public.nota_simple_titulares(nota_simple_id,nombre_extraido,cif_dni,porcentaje,rol,rol_literal,evidencia)
    VALUES(p_nota_id,v_obj->>'nombre_extraido',nullif(v_obj->>'cif_dni',''),v_pct,
      nullif(v_obj->>'rol','')::public.nota_titular_rol,nullif(v_obj->>'rol_literal',''),v_obj->'evidencia');
    v_inserted:=v_inserted+1;
  END LOOP;

  SELECT count(*) INTO v_rows FROM public.nota_simple_titulares WHERE nota_simple_id=p_nota_id;
  IF v_rows<>v_expected THEN RAISE EXCEPTION 'completeness_post_apply:%!=%',v_rows,v_expected; END IF;

  UPDATE public.notas_simples SET raw_pdf_text=nullif(p_payload->>'raw_pdf_text',''),
    structured_json=p_payload->'structured', attempt_count=coalesce(nullif(p_payload->>'attempt_count','')::int,0),
    last_error=NULL,next_retry_at=NULL,claimed_at=NULL,claim_token=NULL,claim_expires_at=NULL
  WHERE id=p_nota_id AND claim_token=p_claim_token;
  GET DIAGNOSTICS v_rows=ROW_COUNT; IF v_rows<>1 THEN RAISE EXCEPTION 'finalize_fail'; END IF;
  RETURN jsonb_build_object('ok',true,'updated',v_updated,'inserted',v_inserted,'deleted',v_deleted,'finalized',true,'expected',v_expected);
END $fn$;

REVOKE ALL ON FUNCTION public.apply_nota_reparse_plan(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_nota_reparse_plan(uuid,uuid,jsonb) TO service_role;

COMMIT;