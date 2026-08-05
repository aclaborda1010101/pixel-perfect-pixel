DO $$
DECLARE v text; v2 text;
BEGIN
  v := pg_get_viewdef('public.v_building_score'::regclass, true);
  v2 := replace(v, 'COALESCE(b_score_total, score_raw) AS score', 'score_raw AS score');
  IF v2 = v THEN
    RAISE EXCEPTION 'No se encontró la expresión COALESCE(b_score_total, score_raw) AS score en v_building_score';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_building_score AS ' || v2;
END $$;

CREATE OR REPLACE FUNCTION public.compute_score(p_building_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row record;
  v_avisos jsonb := '[]'::jsonb;
  v_an public.building_analysis%ROWTYPE;
  v_has_ai boolean;
  v_activo numeric;
BEGIN
  SELECT * INTO v_row FROM public.v_building_score WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Score del activo: SIEMPRE desde score_raw (nunca desde el total ya ponderado).
  v_activo := v_row.score_raw;

  SELECT * INTO v_an FROM public.building_analysis WHERE building_id = p_building_id;
  v_has_ai := FOUND;

  IF v_has_ai THEN
    IF COALESCE(v_an.plantas_levantables,0) >= 2 THEN
      v_avisos := v_avisos || jsonb_build_object('key','elevable','label','Potencial de elevación','severity','high');
    END IF;
    IF v_an.esquina THEN
      v_avisos := v_avisos || jsonb_build_object('key','esquina','label','Edificio en esquina','severity','medium');
    END IF;
    IF v_an.segundas_escaleras THEN
      v_avisos := v_avisos || jsonb_build_object('key','doble_escalera','label','Dos escaleras detectadas','severity','medium');
    END IF;
    IF v_an.protegido_historicamente THEN
      v_avisos := v_avisos || jsonb_build_object('key','protegido','label','Protección histórica','severity','warn');
    END IF;
  ELSE
    v_avisos := v_avisos || jsonb_build_object('key','ai_pendiente','label','Análisis IA pendiente','severity','info');
  END IF;

  UPDATE public.buildings
  SET score_activo = v_activo,
      score_breakdown = v_row.score_breakdown,
      avisos_inteligentes = v_avisos,
      score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_activo;
END;
$function$;

CREATE OR REPLACE FUNCTION public.compute_score_total(p_building_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_activo numeric; v_owner_score numeric; v_owner_result jsonb; v_total numeric;
BEGIN
  BEGIN v_activo := public.compute_score(p_building_id);
  EXCEPTION WHEN OTHERS THEN
    SELECT score_activo INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END;
  IF v_activo IS NULL THEN
    SELECT score_activo INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END IF;

  v_owner_result := public.compute_owner_score(p_building_id);
  v_owner_score := (v_owner_result->>'score')::numeric;
  v_total := round(0.60 * coalesce(v_activo,0) + 0.40 * coalesce(v_owner_score,50), 1);

  UPDATE public.buildings
     SET score_activo = coalesce(v_activo, score_activo),
         score_propietarios = v_owner_score,
         score_propietarios_breakdown = v_owner_result->'breakdown',
         score_total = v_total,
         score = v_total,
         score_propietarios_updated_at = now()
   WHERE id = p_building_id;
  RETURN v_total;
END $function$;