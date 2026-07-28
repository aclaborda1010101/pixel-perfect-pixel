-- ==================================================================
-- FASE 1 · Defunciones, envejecimiento y herencia
-- ==================================================================

-- 1. Helper: limpia marcas de defunción del nombre
CREATE OR REPLACE FUNCTION public.clean_owner_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        coalesce(p_name, ''),
        -- quita cualquier "(...fallecid... / difunt... / e.p.d. / q.e.p.d ...)" con o sin paréntesis
        '\s*[\(\[]?\s*(probable\s+)?(fallecid[oa]s?|difunt[oa]s?|e\.?\s*p\.?\s*d\.?|q\.?\s*e\.?\s*p\.?\s*d\.?)\s*[\)\]]?\s*',
        ' ',
        'gi'
      ),
      '\s{2,}', ' ', 'g'
    ),
    ''
  );
$$;

-- 2. Detector de estado vital desde el texto del nombre
CREATE OR REPLACE FUNCTION public.detect_estado_vital_from_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    WHEN p_name ~* '\yprobable\y[^a-z]{0,10}(fallecid|difunt)' THEN 'probable_fallecido'
    WHEN p_name ~* '(fallecid[oa]s?|difunt[oa]s?|\ye\.?\s*p\.?\s*d\.?\y|\yq\.?\s*e\.?\s*p\.?\s*d\.?\y)' THEN 'fallecido'
    ELSE NULL
  END;
$$;

-- 3. Columna nombre_display + trigger
ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS nombre_display text;

CREATE OR REPLACE FUNCTION public.owners_maintain_display_and_estado()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_detected text;
BEGIN
  -- Nombre limpio para pintar
  NEW.nombre_display := coalesce(public.clean_owner_name(NEW.nombre), NEW.nombre);

  -- Estado vital derivado del nombre (solo si no lo han fijado ya a fallecido/probable manualmente y el detector encuentra algo)
  v_detected := public.detect_estado_vital_from_name(NEW.nombre);
  IF v_detected IS NOT NULL AND coalesce(NEW.estado_vital, 'activo') = 'activo' THEN
    NEW.estado_vital := v_detected;
    NEW.estado_vital_fuente := coalesce(NEW.estado_vital_fuente, 'marca_manual_nombre_hubspot');
    NEW.estado_vital_fecha := coalesce(NEW.estado_vital_fecha, now());
    NEW.estado_vital_evidencia := coalesce(NEW.estado_vital_evidencia, 'Marca en el nombre original: ' || NEW.nombre);
  END IF;

  -- edad_anios derivada de fecha_nacimiento
  IF NEW.fecha_nacimiento IS NOT NULL THEN
    NEW.edad_anios := extract(year from age(NEW.fecha_nacimiento))::int;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_owners_maintain_display ON public.owners;
CREATE TRIGGER trg_owners_maintain_display
BEFORE INSERT OR UPDATE OF nombre, fecha_nacimiento, estado_vital ON public.owners
FOR EACH ROW EXECUTE FUNCTION public.owners_maintain_display_and_estado();

-- 4. Backfill: recalcula nombre_display + estado_vital en filas existentes
UPDATE public.owners
   SET nombre = nombre;  -- fuerza trigger

-- 5. Vista v_building_sucesion
DROP VIEW IF EXISTS public.v_building_sucesion CASCADE;
CREATE VIEW public.v_building_sucesion
WITH (security_invoker=true)
AS
WITH per_owner AS (
  SELECT
    bo.building_id,
    o.id AS owner_id,
    o.estado_vital,
    o.edad_anios,
    o.fecha_nacimiento
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id
  WHERE o.merged_into IS NULL
),
agg AS (
  SELECT
    building_id,
    count(*)::int AS n_propietarios,
    count(*) FILTER (WHERE estado_vital = 'fallecido')::int AS n_fallecidos,
    count(*) FILTER (WHERE estado_vital = 'probable_fallecido')::int AS n_probables,
    count(*) FILTER (WHERE fecha_nacimiento IS NOT NULL)::int AS n_con_fecha,
    count(*) FILTER (WHERE edad_anios >= 85)::int AS n_mayores_85,
    count(*) FILTER (WHERE edad_anios >= 90)::int AS n_mayores_90,
    round(avg(edad_anios) FILTER (WHERE edad_anios IS NOT NULL)::numeric, 1) AS edad_media
  FROM per_owner
  GROUP BY building_id
)
SELECT
  a.building_id,
  a.n_propietarios,
  a.n_fallecidos,
  a.n_probables,
  a.n_mayores_85,
  a.n_mayores_90,
  a.edad_media,
  CASE WHEN a.n_propietarios > 0
       THEN round(100.0 * a.n_con_fecha / a.n_propietarios, 0)::int
       ELSE 0 END AS pct_con_fecha,
  CASE
    WHEN a.n_fallecidos >= 1 THEN 'herencia_abierta'
    WHEN a.n_probables >= 1 THEN 'sospecha'
    WHEN a.n_con_fecha >= 1
         AND (a.n_mayores_85::numeric / GREATEST(a.n_con_fecha,1)) >= 0.30
      THEN 'envejecimiento_alto'
    ELSE 'sin_senales'
  END AS estado_sucesion
FROM agg a;

GRANT SELECT ON public.v_building_sucesion TO authenticated;
GRANT SELECT ON public.v_building_sucesion TO service_role;

-- 6. Compute owner score: añade señales de herencia / envejecimiento
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
  v_suc record;
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

  -- === NUEVO: señales de sucesión/envejecimiento ===
  SELECT * INTO v_suc FROM public.v_building_sucesion WHERE building_id = p_building_id;
  IF v_suc.building_id IS NOT NULL THEN
    IF v_suc.estado_sucesion = 'herencia_abierta' THEN
      -- fuerte: herederos = no eligieron estar ahí = vía de entrada
      v_delta := CASE
        WHEN v_suc.n_fallecidos >= v_suc.n_propietarios THEN 18   -- todos fallecidos
        WHEN v_suc.n_fallecidos::numeric / v_suc.n_propietarios >= 0.5 THEN 14
        ELSE 10
      END;
      v_score := v_score + v_delta;
      v_signals := v_signals || jsonb_build_object(
        'signal','herencia_abierta','delta',v_delta,
        'evidence', jsonb_build_object('n_fallecidos',v_suc.n_fallecidos,'n_propietarios',v_suc.n_propietarios),
        'nota','herederos localizables · nunca penaliza si aún no hay contacto');
    ELSIF v_suc.estado_sucesion = 'sospecha' THEN
      v_score := v_score + 5;
      v_signals := v_signals || jsonb_build_object(
        'signal','sospecha_fallecimiento','delta',5,
        'evidence', jsonb_build_object('n_probables',v_suc.n_probables),
        'nota','marcado como probable fallecido · verificar y localizar herederos');
    ELSIF v_suc.estado_sucesion = 'envejecimiento_alto' THEN
      v_score := v_score + 5;
      v_signals := v_signals || jsonb_build_object(
        'signal','envejecimiento_alto','delta',5,
        'evidence', jsonb_build_object('n_mayores_85',v_suc.n_mayores_85,'n_mayores_90',v_suc.n_mayores_90,'edad_media',v_suc.edad_media),
        'nota','concentración de mayores de 85 · herencias previsibles a medio plazo');
    END IF;
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
      'sucesion', CASE WHEN v_suc.building_id IS NULL THEN NULL ELSE jsonb_build_object(
        'estado', v_suc.estado_sucesion,
        'n_fallecidos', v_suc.n_fallecidos,
        'n_probables', v_suc.n_probables,
        'n_mayores_85', v_suc.n_mayores_85,
        'n_mayores_90', v_suc.n_mayores_90,
        'edad_media', v_suc.edad_media,
        'pct_con_fecha', v_suc.pct_con_fecha
      ) END,
      'signals', v_signals,
      'formula', 'base 45 + escala propietarios + intención (mayoría, oferta, impulsor) - bloqueos suaves - cobertura suave + sucesión/envejecimiento (nunca penaliza) · clamp 0-100'
    )
  );
END $function$;