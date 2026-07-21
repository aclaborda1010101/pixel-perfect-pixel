
CREATE OR REPLACE FUNCTION public.compute_owner_score(p_building_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_txt_bld_kpis text := '';
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
  v_has_positive_signals boolean;
  v_owner_kpi_positive boolean;
  v_owner_kpi_blocked boolean;
  v_owner_kpi_oferta boolean;
  POS_RX text := '((quier[oaenás]{1,4}|quer(emos|éis|ían?|íamos))\s+vender|dispuest[oa]s?\s+a\s+vender|acepta\s+vender|necesita\s+vender|urge\s+vender|salir\s+del?\s+edificio|predisposici[oó]n.{0,20}(alta|positiv|si)|intenci[oó]n\s+de\s+vender|motivaci[oó]n.{0,20}(alta|urgen)|abiert[oa]s?\s+a\s+opciones)';
  NEG_RX text := '(no\s+quier[eo]n?\s+vender|se\s+niega|nunca\s+(voy\s+a\s+)?vender|no\s+piensa\s+vender|cerrad[oa]\s+a\s+vender)';
  IMP_RX text := '(impulsor|lidera|liderazgo|puente\s+clave|asumido\s+el\s+liderazgo|gestion(a|ando)\s+el\s+tema)';
  MAY_RX text := '(mayor[ií]a.{0,40}vender|mayor[ií]a\s+(aplastante|de propietarios)|dispuest[oa]s?\s+a\s+vender|todos?\s+quer(emos|éis|ían?)\s+vender|todos?\s+quier[eo]n?\s+vender)';
  OFR_RX text := '(oferta.{0,60}(previa|discutid|comentad|sobre la mesa|encima de la mesa|mano|hech|recibid)|otr[ao]s?\s+empresa.{0,30}(ha\s+)?oferta|le\s+han?\s+ofertad|\d{1,3}[\.,]?\d?\s?m[€e]\b|\d{1,3}[\.,]?\d?\s?millon)';
BEGIN
  SELECT hs_deal_id INTO v_deal_id FROM public.buildings WHERE id = p_building_id;

  SELECT array_agg(DISTINCT ei.provider_id) FILTER (WHERE ei.provider_id IS NOT NULL)
    INTO v_hs_ids
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id
    LEFT JOIN public.external_ids ei
      ON ei.entity_type = 'owner' AND ei.entity_id = o.id
     AND ei.provider = 'hubspot' AND ei.provider_object_type = 'contact'
   WHERE bo.building_id = p_building_id AND o.merged_into IS NULL;

  SELECT string_agg(lower(coalesce(cs.voss_post->>'resumen_ejecutivo','') || ' ' ||
                         coalesce((SELECT string_agg(x->>'dato',' ')
                                     FROM jsonb_array_elements(cs.voss_post->'inteligencia_extraida') x),'')),
                    ' | ')
    INTO v_txt_bld_sessions
    FROM public.call_sessions cs
   WHERE (cs.building_id = p_building_id
          OR cs.owner_id IN (SELECT owner_id FROM public.building_owners WHERE building_id = p_building_id))
     AND cs.voss_post IS NOT NULL;

  SELECT string_agg(lower(coalesce(hc.hs_call_summary,'')), ' | ')
    INTO v_txt_bld_hs
    FROM public.hubspot_calls hc
   WHERE hc.hs_call_summary IS NOT NULL
     AND (
       (v_deal_id IS NOT NULL AND v_deal_id = ANY(hc.associated_deal_ids))
       OR (v_hs_ids IS NOT NULL AND hc.associated_contact_ids && v_hs_ids)
     );

  SELECT string_agg(lower(coalesce(k->>'evidencia','')), ' | ')
    INTO v_txt_bld_kpis
    FROM public.owner_call_prep_cache c
    JOIN public.building_owners bo ON bo.owner_id = c.owner_id
    LEFT JOIN LATERAL jsonb_array_elements(c.kpis_json->'kpis') k ON true
   WHERE bo.building_id = p_building_id
     AND (k->>'estado') = 'tenemos';

  v_txt_bld := coalesce(v_txt_bld_sessions,'') || ' || ' ||
               coalesce(v_txt_bld_hs,'') || ' || ' ||
               coalesce(v_txt_bld_kpis,'');

  SELECT max(iniciada_at), max(hubspot_call_id)
    INTO v_last_call_at, v_last_call_hs
    FROM public.call_sessions
   WHERE (building_id = p_building_id
          OR owner_id IN (SELECT owner_id FROM public.building_owners WHERE building_id = p_building_id))
     AND voss_post IS NOT NULL;

  v_oferta := v_txt_bld ~ OFR_RX;
  v_mayoria := v_txt_bld ~ MAY_RX;
  v_impulsor_bld := v_txt_bld ~ IMP_RX;
  v_has_positive_signals := v_mayoria OR v_oferta OR v_impulsor_bld;

  FOR v_owner IN
    SELECT bo.owner_id
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

    IF EXISTS (SELECT 1 FROM public.owner_call_prep_cache WHERE owner_id = v_owner.owner_id)
       OR EXISTS (SELECT 1 FROM public.call_sessions WHERE owner_id = v_owner.owner_id AND voss_post IS NOT NULL) THEN
      v_n_contacted := v_n_contacted + 1;
    END IF;

    SELECT
      bool_or((k->>'clave') IN ('predisposicion','motivacion_urgencia','necesidad_liquidez')
              AND (k->>'estado')='tenemos'
              AND lower(coalesce(k->>'evidencia','')) ~ POS_RX
              AND lower(coalesce(k->>'evidencia','')) !~ ('^'||NEG_RX)),
      bool_or((k->>'clave') IN ('predisposicion','quien_bloquea')
              AND (k->>'estado')='tenemos'
              AND lower(coalesce(k->>'evidencia','')) ~ NEG_RX),
      bool_or((k->>'clave')='oferta_previa' AND (k->>'estado')='tenemos'
              AND length(coalesce(k->>'evidencia',''))>3)
    INTO v_owner_kpi_positive, v_owner_kpi_blocked, v_owner_kpi_oferta
    FROM public.owner_call_prep_cache c
    LEFT JOIN LATERAL jsonb_array_elements(c.kpis_json->'kpis') k ON true
    WHERE c.owner_id = v_owner.owner_id;

    v_owner_positive := coalesce(v_owner_kpi_positive,false) OR v_txt_owner ~ POS_RX;
    v_owner_blocked  := coalesce(v_owner_kpi_blocked,false) OR v_txt_owner ~ NEG_RX;
    v_owner_impulsor := v_txt_owner ~ IMP_RX;

    IF coalesce(v_owner_kpi_oferta,false) THEN v_oferta := true; END IF;

    IF v_owner_positive THEN
      v_n_positive := v_n_positive + 1;
      v_score := v_score + 8;
      v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','predisposicion_positiva','delta',8);
      IF v_owner_blocked THEN
        v_n_blocked := v_n_blocked + 1;
      END IF;
    ELSIF v_owner_blocked AND NOT v_owner_impulsor THEN
      v_n_blocked := v_n_blocked + 1;
    END IF;

    IF v_owner_impulsor THEN v_n_impulsor := v_n_impulsor + 1; END IF;
  END LOOP;

  IF v_n_owners = 0 THEN
    RETURN jsonb_build_object('score',50,
      'breakdown',jsonb_build_object('n_owners',0,'signals','[]'::jsonb,'notes','Sin propietarios registrados'));
  END IF;

  IF v_n_owners >= 20 THEN v_delta := 12;
  ELSIF v_n_owners >= 10 THEN v_delta := 8;
  ELSIF v_n_owners >= 4 THEN v_delta := 6;
  ELSIF v_n_owners >= 2 THEN v_delta := 2;
  ELSE v_delta := -4; END IF;
  v_score := v_score + v_delta;
  v_signals := v_signals || jsonb_build_object('signal','n_propietarios','delta',v_delta,'evidence',v_n_owners);

  IF v_n_impulsor > 0 OR v_impulsor_bld THEN
    v_score := v_score + 8;
    v_signals := v_signals || jsonb_build_object('signal','impulsor_identificado','delta',8,'evidence',greatest(v_n_impulsor,1));
  END IF;

  v_has_positive_signals := v_has_positive_signals OR v_n_positive > 0;

  IF v_mayoria OR v_n_positive >= greatest(2, ceil(v_n_contacted::numeric/2)) THEN
    v_score := v_score + 12;
    v_signals := v_signals || jsonb_build_object('signal','mayoria_vendedora','delta',12,'evidence',v_n_positive);
    v_mayoria := true;
  END IF;

  IF v_oferta THEN
    v_score := v_score + 10;
    v_signals := v_signals || jsonb_build_object('signal','oferta_previa_discutida','delta',10);
  END IF;

  IF v_n_blocked > 0 THEN
    IF v_has_positive_signals THEN
      v_score := v_score - 3;
      v_signals := v_signals || jsonb_build_object('signal','bloqueador_identificado','delta',-3,'evidence',v_n_blocked,
        'nota','bloqueador aislado con mayoría/oferta/impulsor: palanca de negociación, no rebaja');
    ELSIF v_n_positive = 0 AND v_n_contacted > 0 AND v_n_blocked = v_n_contacted THEN
      v_score := least(v_score, 25);
      v_signals := v_signals || jsonb_build_object('signal','todos_cerrados','delta','cap<=25','evidence',v_n_blocked);
    ELSIF v_n_blocked >= greatest(3, ceil(v_n_contacted::numeric/2)) THEN
      v_score := v_score - 20;
      v_signals := v_signals || jsonb_build_object('signal','mayoria_bloqueada','delta',-20,'evidence',v_n_blocked);
    ELSE
      v_delta := greatest(-3 * v_n_blocked, -9);
      v_score := v_score + v_delta;
      v_signals := v_signals || jsonb_build_object('signal','bloqueador_identificado','delta',v_delta,'evidence',v_n_blocked);
    END IF;
  END IF;

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
END $function$;

DO $$
DECLARE r record; res jsonb; new_total numeric;
BEGIN
  FOR r IN
    SELECT DISTINCT b.id, b.score_activo
      FROM public.buildings b
      LEFT JOIN public.building_owners bo ON bo.building_id = b.id
      LEFT JOIN public.owner_call_prep_cache c ON c.owner_id = bo.owner_id
      LEFT JOIN public.call_sessions cs ON cs.building_id = b.id AND cs.voss_post IS NOT NULL
     WHERE c.owner_id IS NOT NULL OR cs.id IS NOT NULL
  LOOP
    res := public.compute_owner_score(r.id);
    new_total := CASE WHEN r.score_activo IS NOT NULL AND (res->>'score') IS NOT NULL
                      THEN round(0.6 * r.score_activo + 0.4 * (res->>'score')::numeric, 1)
                      ELSE r.score_activo END;
    UPDATE public.buildings
       SET score_propietarios = (res->>'score')::numeric,
           score_propietarios_breakdown = res->'breakdown',
           score_total = new_total,
           score_propietarios_updated_at = now(),
           updated_at = now()
     WHERE id = r.id;
    UPDATE public.buildings SET score_summary = public.build_score_summary(r.id) WHERE id = r.id;
  END LOOP;
END $$;
