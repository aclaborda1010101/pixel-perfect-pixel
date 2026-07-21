
CREATE OR REPLACE FUNCTION public.compute_score_total(p_building_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_activo numeric; v_owner_score numeric; v_owner_result jsonb; v_total numeric;
BEGIN
  BEGIN v_activo := public.compute_score(p_building_id);
  EXCEPTION WHEN OTHERS THEN
    SELECT score INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END;
  IF v_activo IS NULL THEN
    SELECT score INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END IF;

  v_owner_result := public.compute_owner_score(p_building_id);
  v_owner_score := (v_owner_result->>'score')::numeric;
  -- Media ponderada 60% activo + 40% propietarios (permite que propietarios calientes suban el total sobre el activo)
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
END $$;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.buildings LOOP
    BEGIN PERFORM public.compute_score_total(r.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
