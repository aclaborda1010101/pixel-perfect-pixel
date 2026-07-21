
CREATE OR REPLACE FUNCTION public.compute_owner_score(p_building_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score numeric := 45;
  v_signals jsonb := '[]'::jsonb;
  v_owner record;
  v_n_owners int := 0;
  v_n_contacted int := 0;
  v_n_positive int := 0;
  v_n_blocked int := 0;
  v_n_impulsor int := 0;
  v_delta numeric;
  v_txt_owner text;
  v_txt_bld text := '';
  v_txt_bld_sessions text := '';
  v_txt_bld_hs text := '';
  v_oferta boolean := false;
  v_mayoria boolean := false;
  v_impulsor_bld boolean := false;
  v_owner_positive boolean;
  v_owner_blocked boolean;
  v_owner_impulsor boolean;
  v_cvg numeric;
  v_last_call_at timestamptz;
  v_last_call_hs text;
  v_deal_id text;
  v_hs_ids text[];
BEGIN
  SELECT hs_deal_id INTO v_deal_id FROM public.buildings WHERE id = p_building_id;

  SELECT array_agg(o.hubspot_id) FILTER (WHERE o.hubspot_id IS NOT NULL)
    INTO v_hs_ids
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id
   WHERE bo.building_id = p_building_id AND o.merged_into IS NULL;

  -- Texto edificio: sesiones VOSS
  SELECT string_agg(lower(coalesce(cs.voss_post->>'resumen_ejecutivo','') || ' ' ||
                         coalesce((SELECT string_agg(x->>'dato',' ')
                                     FROM jsonb_array_elements(cs.voss_post->'inteligencia_extraida') x),'')),
                    ' | ')
    INTO v_txt_bld_sessions
    FROM public.call_sessions cs
   WHERE (cs.building_id = p_building_id
          OR cs.owner_id IN (SELECT owner_id FROM public.building_owners WHERE building_id = p_building_id))
     AND cs.voss_post IS NOT NULL;

  -- Texto edificio: resúmenes HubSpot
  SELECT string_agg(lower(coalesce(hc.hs_call_summary,'')), ' | ')
    INTO v_txt_bld_hs
    FROM public.hubspot_calls hc
   WHERE hc.hs_call_summary IS NOT NULL
     AND (
       (v_deal_id IS NOT NULL AND v_deal_id = ANY(hc.associated_deal_ids))
       OR (v_hs_ids IS NOT NULL AND hc.associated_contact_ids && v_hs_ids)
     );

  v_txt_bld := coalesce(v_txt_bld_sessions,'') || ' || ' || coalesce(v_txt_bld_hs,'');

  SELECT max(iniciada_at), max(hubspot_call_id)
    INTO v_last_call_at, v_last_call_hs
    FROM public.call_sessions
   WHERE (building_id = p_building_id
          OR owner_id IN (SELECT owner_id FROM public.building_owners WHERE building_id = p_building_id))
     AND voss_post IS NOT NULL;

  -- Señales edificio
  v_oferta := v_txt_bld ~ '(oferta.{0,60}(previa|discutid|comentad|sobre la mesa|encima de la mesa|mano)|\d{1,3}\s?m[€e]|\d{1,3}\s?millon)';
  v_mayoria := v_txt_bld ~ '(mayor[ií]a.{0,40}vender|mayor[ií]a\s+(aplastante|de propietarios)|dispuest[oa]s?\s+a\s+vender|quieren\s+vender)';
  v_impulsor_bld := v_txt_bld ~ '(impulsor|lidera|liderazgo|puente\s+clave|asumido el liderazgo)';

  FOR v_owner IN
    SELECT bo.owner_id, bo.cuota, o.hubspot_id
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id
     WHERE bo.building_id = p_building_id AND o.merged_into IS NULL
  LOOP
    v_n_owners := v_n_owners + 1;

    SELECT lower(coalesce(string_agg(
              coalesce(cs.voss_post->>'resumen_ejecutivo','') || ' ' ||
              coalesce((SELECT string_agg(x->>'dato',' ') FROM jsonb_array_elements(cs.voss_post->'inteligencia_extraida') x),''),
            ' '), '') || ' ' ||
           coalesce((SELECT lower(kpis_json::text) FROM public.owner_call_prep_cache WHERE owner_id = v_owner.owner_id LIMIT 1),''))
      INTO v_txt_owner
      FROM public.call_sessions cs
     WHERE cs.owner_id = v_owner.owner_id AND cs.voss_post IS NOT NULL;
    v_txt_owner := coalesce(v_txt_owner,'');

    IF v_txt_owner <> '' AND (position('vend' in v_txt_owner) > 0
                              OR EXISTS (SELECT 1 FROM public.owner_call_prep_cache WHERE owner_id = v_owner.owner_id)
                              OR EXISTS (SELECT 1 FROM public.call_sessions WHERE owner_id = v_owner.owner_id AND voss_post IS NOT NULL)) THEN
      v_n_contacted := v_n_contacted + 1;
    END IF;

    v_owner_positive := v_txt_owner ~ '(quiere\s+vender|dispuest[oa]s?\s+a\s+vender|acepta\s+vender|necesita\s+vender|urge\s+vender|salir\s+del?\s+edificio|predisposici[oó]n.{0,20}(alta|positiv|si))';
    v_owner_blocked  := v_txt_owner ~ '(no\s+quiere\s+vender|se\s+niega|bloquea|bloqueador[a]?|nunca\s+(voy a\s+)?vender|no\s+piensa\s+vender|cerrad[oa]\s+a\s+vender)';
    v_owner_impulsor := v_txt_owner ~ '(impulsor|lidera|liderazgo|puente\s+clave|asumido el liderazgo)';

    IF v_owner_positive AND NOT v_owner_blocked THEN
      v_n_positive := v_n_positive + 1;
      v_score := v_score + 8;
      v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','predisposicion_positiva','delta',8);
    ELSIF v_owner_blocked AND NOT v_owner_positive THEN
      v_n_blocked := v_n_blocked + 1;
    END IF;

    IF v_owner_impulsor THEN
      v_n_impulsor := v_n_impulsor + 1;
    END IF;
  END LOOP;

  IF v_n_owners = 0 THEN
    RETURN jsonb_build_object('score',50,
      'breakdown',jsonb_build_object('n_owners',0,'signals','[]'::jsonb,'notes','Sin propietarios registrados'));
  END IF;

  -- Escala nº propietarios
  IF v_n_owners >= 20 THEN v_delta := 12;
  ELSIF v_n_owners >= 10 THEN v_delta := 8;
  ELSIF v_n_owners >= 4 THEN v_delta := 6;
  ELSIF v_n_owners >= 2 THEN v_delta := 2;
  ELSE v_delta := -4; END IF;
  v_score := v_score + v_delta;
  v_signals := v_signals || jsonb_build_object('signal','n_propietarios','delta',v_delta,'evidence',v_n_owners);

  -- Impulsor
  IF v_n_impulsor > 0 OR v_impulsor_bld THEN
    v_score := v_score + 8;
    v_signals := v_signals || jsonb_build_object('signal','impulsor_identificado','delta',8,'evidence',greatest(v_n_impulsor,1));
  END IF;

  -- Mayoría vendedora
  IF v_mayoria OR v_n_positive >= greatest(2, ceil(v_n_contacted::numeric/2)) THEN
    v_score := v_score + 12;
    v_signals := v_signals || jsonb_build_object('signal','mayoria_vendedora','delta',12,'evidence',v_n_positive);
  END IF;

  -- Oferta previa
  IF v_oferta THEN
    v_score := v_score + 10;
    v_signals := v_signals || jsonb_build_object('signal','oferta_previa_discutida','delta',10);
  END IF;

  -- Bloqueadores: suave, salvo mayoría cerrada
  IF v_n_blocked > 0 THEN
    IF v_n_positive = 0 AND v_n_contacted > 0 AND v_n_blocked = v_n_contacted THEN
      v_score := least(v_score, 25);
      v_signals := v_signals || jsonb_build_object('signal','todos_cerrados','delta','cap<=25','evidence',v_n_blocked);
    ELSIF v_n_blocked >= greatest(3, ceil(v_n_contacted::numeric/2)) THEN
      v_score := v_score - 20;
      v_signals := v_signals || jsonb_build_object('signal','mayoria_bloqueada','delta',-20,'evidence',v_n_blocked);
    ELSE
      v_delta := greatest(-3 * v_n_blocked, -9);
      v_score := v_score + v_delta;
      v_signals := v_signals || jsonb_build_object('signal','bloqueador_identificado','delta',v_delta,'evidence',v_n_blocked,
        'nota','bloqueador aislado con mayoría positiva: penaliza suave, es palanca de negociación');
    END IF;
  END IF;

  -- Cobertura: sub-señal informativa (soft)
  v_cvg := v_n_contacted::numeric / v_n_owners;
  v_delta := -round(4 * (1 - v_cvg));
  IF v_delta < 0 THEN
    v_score := v_score + v_delta;
    v_signals := v_signals || jsonb_build_object('signal','cobertura_baja','delta',v_delta,
      'evidence', jsonb_build_object('contactados', v_n_contacted, 'total', v_n_owners),
      'nota','sub-señal informativa · trabajo pendiente, no calidad del activo');
  END IF;

  v_score := greatest(0, least(100, v_score));

  RETURN jsonb_build_object(
    'score', round(v_score, 1),
    'breakdown', jsonb_build_object(
      'n_owners', v_n_owners,
      'n_contactados', v_n_contacted,
      'n_positivos', v_n_positive,
      'n_bloqueados', v_n_blocked,
      'n_impulsor', v_n_impulsor,
      'oferta_previa_edificio', v_oferta,
      'mayoria_vendedora', v_mayoria,
      'impulsor_edificio', v_impulsor_bld,
      'last_call_at', v_last_call_at,
      'last_call_hs_id', v_last_call_hs,
      'cobertura_pct', round(100 * v_cvg, 0),
      'signals', v_signals,
      'formula', 'base 45 + escala propietarios + intención (mayoría, oferta, impulsor) - bloqueos suaves - cobertura suave · clamp 0-100'
    )
  );
END $$;

-- Recomputar todos los edificios con la nueva fórmula
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.buildings LOOP
    BEGIN PERFORM public.compute_score_total(r.id);
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;
END $$;
