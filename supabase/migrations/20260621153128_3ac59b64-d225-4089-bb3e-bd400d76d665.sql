-- 1. Backup de compute_cluster_score antes de extenderla.
INSERT INTO public._fn_backups(fn_name, definition, note)
SELECT 'compute_cluster_score', pg_get_functiondef(oid),
       'pre-visor-pg97 extension (' || to_char(now(),'YYYY-MM-DD HH24:MI') || ')'
FROM pg_proc WHERE proname='compute_cluster_score';

-- 2. Columnas nuevas en building_analysis para el dato del Visor PG97.
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS n_escaleras_visor integer,
  ADD COLUMN IF NOT EXISTS escaleras_visor_confianza numeric,
  ADD COLUMN IF NOT EXISTS escaleras_visor_catalogo text,
  ADD COLUMN IF NOT EXISTS escaleras_visor_grado text,
  ADD COLUMN IF NOT EXISTS escaleras_visor_source text DEFAULT 'pg97_analisis_edificacion',
  ADD COLUMN IF NOT EXISTS escaleras_visor_at timestamptz,
  ADD COLUMN IF NOT EXISTS escaleras_visor_raw jsonb;

-- 3. compute_cluster_score extendida: SOLO se cambia el bloque P0 para incorporar
-- la senal del Visor PG97 (n_escaleras_visor con confianza >= 0.6). El resto es
-- IDENTICO a la version respaldada arriba.
CREATE OR REPLACE FUNCTION public.compute_cluster_score(p_building_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b record; ba public.building_analysis%ROWTYPE; md jsonb;
  v_barrio_norm text; v_calle_norm text; v_calle_subzona text; v_calle_override text;
  v_calle_num integer;
  v_cluster text; v_cluster_secundario text;
  v_m2 numeric; v_m2_raw numeric; v_m2_fuente text;
  v_viv integer; v_viv_md integer; v_viv_auth integer; v_owners integer; v_owners_raw integer; v_ratio numeric;
  v_mg integer; v_score numeric:=0; v_breakdown jsonb:='[]'::jsonb; v_avisos jsonb:='[]'::jsonb;
  v_motivo text:=''; v_calle_tipo text; v_pen numeric:=0; v_bonus numeric:=0;
  v_terciario_m2 numeric; v_terciario_pct numeric;
  v_n_escaleras integer; v_n_subparc integer;
  v_protegido boolean; v_aviso_cambio_uso boolean:=false;
  v_2esc_confirmada boolean:=false; v_2esc_posible boolean:=false;
  v_visor_resuelve_uno boolean:=false;
  v_terciario_m2_md numeric;
  v_sl_count integer;
  s_tamano numeric:=0; w_tamano numeric:=0; rango_tamano text;
  s_ratio numeric:=0; w_ratio numeric:=0; rango_ratio text;
  s_viv numeric:=0; w_viv numeric:=0; s_own numeric:=0; w_own numeric:=0;
  s_mg numeric:=0; w_mg numeric:=0; s_local numeric:=0; w_local numeric:=0;
BEGIN
  SELECT * INTO b FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  md := COALESCE(b.metadatos,'{}'::jsonb);
  SELECT * INTO ba FROM public.building_analysis WHERE building_id = p_building_id;

  v_barrio_norm := normalize_barrio(md->>'barrios_completos__clonada_');
  v_calle_norm := normalize_barrio(b.direccion);
  v_calle_num := public._safe_int_from_dir(b.direccion);

  SELECT sub_zona, cluster_override INTO v_calle_subzona, v_calle_override
  FROM public.madrid_calles_subzona
  WHERE v_calle_norm LIKE '%' || calle_norm || '%'
    AND (
      numero_desde IS NULL OR numero_hasta IS NULL
      OR (v_calle_num IS NOT NULL AND v_calle_num BETWEEN numero_desde AND numero_hasta)
    )
  ORDER BY
    CASE WHEN numero_desde IS NOT NULL THEN 0 ELSE 1 END,
    especificidad DESC,
    length(calle_norm) DESC
  LIMIT 1;

  IF v_calle_override IS NOT NULL THEN
    v_cluster := v_calle_override;
    v_motivo := 'subzona ' || v_calle_subzona || ' → ' || v_cluster;
  ELSE
    SELECT cluster, cluster_secundario INTO v_cluster, v_cluster_secundario
    FROM public.madrid_barrio_clusters WHERE barrio_norm = v_barrio_norm;
    IF v_cluster IS NULL THEN
      v_cluster := 'baja_prioridad'; v_motivo := 'barrio no clasificado → baja_prioridad';
    ELSE
      v_motivo := 'barrio ' || coalesce(md->>'barrios_completos__clonada_','?') || ' → ' || v_cluster;
    END IF;
  END IF;

  v_m2_raw := NULLIF(md->>'metros_cuadrados__exactos_','')::numeric;

  v_viv_md := COALESCE(NULLIF(md->>'viviendas__unidades___clonada_','')::integer,
              NULLIF(md->>'viviendas__unidades_','')::integer,
              NULLIF(md->>'num_viviendas','')::integer);
  SELECT viviendas_total INTO v_viv_auth
    FROM public.catastro_authority_cache
   WHERE refcatastral_14 = substring(b.refcatastral, 1, 14);

  IF v_viv_md IS NULL AND v_viv_auth IS NOT NULL THEN
    v_viv := v_viv_auth;
    v_avisos := v_avisos || jsonb_build_object('key','viviendas_autoridad','label','Viviendas desde Catastro','severity','info',
      'detail','Sin viviendas en metadata. Autoridad Catastro: ' || v_viv_auth::text || '.');
  ELSIF v_viv_md IS NOT NULL AND v_viv_auth IS NOT NULL
        AND v_m2_raw IS NOT NULL AND v_viv_md > 0
        AND (v_m2_raw / v_viv_md) > 500
        AND v_viv_auth <> v_viv_md THEN
    v_avisos := v_avisos || jsonb_build_object('key','viviendas_corregidas','label','Viviendas corregidas (autoridad)','severity','medium',
      'detail','HubSpot reporta ' || v_viv_md::text || ' viviendas con ratio ' || round(v_m2_raw / v_viv_md,0)::text ||
              ' m²/viv (>500). Sustituido por autoridad Catastro: ' || v_viv_auth::text || '.');
    v_viv := v_viv_auth;
  ELSE
    v_viv := v_viv_md;
  END IF;

  v_m2 := v_m2_raw;
  v_m2_fuente := 'metadata';
  IF v_m2 IS NOT NULL AND v_viv IS NOT NULL AND v_viv >= 4 AND v_m2 < v_viv * 25 THEN
    v_avisos := v_avisos || jsonb_build_object('key','m2_corruptos','label','m² aparentemente corruptos','severity','medium',
      'detail','HubSpot reporta ' || v_m2::text || ' m² para ' || v_viv::text || ' viviendas. Sustituido por ' || (v_viv*80)::text || ' m² estimados.');
    v_m2 := v_viv * 80; v_m2_fuente := 'estimado_viv';
  ELSIF v_m2 IS NULL AND v_viv IS NOT NULL THEN
    v_m2 := v_viv * 80; v_m2_fuente := 'estimado_viv';
    v_avisos := v_avisos || jsonb_build_object('key','m2_estimados','label','m² estimados desde viviendas','severity','info',
      'detail','Sin m². Estimación ' || v_m2::text || ' m².');
  END IF;

  v_owners_raw := (SELECT count(*)::integer FROM building_owners bo WHERE bo.building_id = p_building_id);
  v_owners := public.count_distinct_owners(p_building_id);
  v_sl_count := (SELECT count(DISTINCT company_id)::integer FROM building_companies WHERE building_id = p_building_id);
  v_ratio := CASE WHEN v_viv>0 AND v_m2 IS NOT NULL THEN v_m2/v_viv ELSE NULL END;
  v_mg := COALESCE(ba.mala_gestion_score, 0);
  v_protegido := COALESCE(ba.protegido_historicamente, false);

  SELECT n_subparcelas_residenciales INTO v_n_subparc
    FROM public.catastro_authority_cache
   WHERE refcatastral_14 = substring(b.refcatastral, 1, 14);

  v_n_escaleras := GREATEST(
    COALESCE(ba.n_escaleras_visor, 0),
    COALESCE(ba.n_escaleras_en_piso01, 0),
    COALESCE(ba.n_escaleras_en_planta_baja, 0),
    CASE WHEN COALESCE(ba.segundas_escaleras,false) THEN 2 ELSE 0 END,
    COALESCE(NULLIF(md->>'num_escaleras','')::integer, 0),
    COALESCE(v_n_subparc, 0),
    1
  );

  v_terciario_m2_md := COALESCE(NULLIF(md->>'metros_cuadrado_oficina','')::numeric,0)
                     + COALESCE(NULLIF(md->>'metros_cuadrados_comercio','')::numeric,0)
                     + COALESCE(NULLIF(md->>'metros_cuadrados_ocio_hostel','')::numeric,0)
                     + COALESCE(NULLIF(md->>'metros_cuadrados_industrial','')::numeric,0);
  v_terciario_m2 := COALESCE(v_terciario_m2_md, 0);
  v_terciario_pct := CASE WHEN COALESCE(v_m2,0) > 0 THEN v_terciario_m2 / v_m2 ELSE 0 END;
  IF v_terciario_pct < 0.34 AND COALESCE(ba.n_locales_planta_baja,0) >= 1 THEN
    v_terciario_pct := GREATEST(v_terciario_pct, 0.34);
  END IF;

  IF v_cluster = 'ultra_prime' AND COALESCE(v_m2,0) < 1000 THEN
    v_avisos := v_avisos || jsonb_build_object('key','ultra_prime_no_aplica','label','Ultra Prime degradado','severity','medium',
      'detail','Reclasificado prime_value_add por tamaño insuficiente.');
    v_cluster := 'prime_value_add'; v_motivo := v_motivo || ' · degradado';
  END IF;

  -- P0 (precision-first) + EXTENSION VISOR PG97:
  --   * 2a escalera CONFIRMADA dispara cambio de uso. Se confirma por:
  --       (a) Visor PG97 (Analisis de la Edificacion) >=2 con confianza >=0.6  [PREFERIDO]
  --       (b) VLM plano planta 1 (n_escaleras_en_piso01>=2 o segundas_escaleras=true)
  --   * Si el Visor resuelve a 1 escalera con confianza >=0.6, NO mostramos el aviso
  --     'cambio_uso_por_verificar' (queda resuelto por la fuente autoritativa).
  --   * Las senales ruidosas (subparcelas DNPRC, planta baja) NO inflan: solo marcan para verificar.
  v_visor_resuelve_uno := COALESCE(ba.n_escaleras_visor,0) = 1
                          AND COALESCE(ba.escaleras_visor_confianza,0) >= 0.6;

  v_2esc_confirmada :=
       (COALESCE(ba.n_escaleras_visor,0) >= 2 AND COALESCE(ba.escaleras_visor_confianza,0) >= 0.6)
    OR COALESCE(ba.segundas_escaleras,false)
    OR COALESCE(ba.n_escaleras_en_piso01,0) >= 2;

  v_2esc_posible := (NOT v_2esc_confirmada)
    AND (NOT v_visor_resuelve_uno)
    AND GREATEST(COALESCE(ba.n_escaleras_en_planta_baja,0),
                 COALESCE(NULLIF(md->>'num_escaleras','')::integer,0),
                 COALESCE(v_n_subparc,0)) >= 2;

  IF v_protegido AND v_2esc_confirmada THEN
    v_aviso_cambio_uso := true;
    v_avisos := v_avisos || jsonb_build_object('key','cambio_uso_hospedaje','label','Apto cambio de uso a hospedaje','severity','high',
      'detail', CASE
        WHEN COALESCE(ba.n_escaleras_visor,0) >= 2 AND COALESCE(ba.escaleras_visor_confianza,0) >= 0.6
          THEN 'Protegido + 2a escalera CONFIRMADA por Visor PG97 (Analisis de la Edificacion). PGOU Madrid.'
        ELSE 'Protegido + 2a escalera confirmada en plano (planta 1). PGOU Madrid.'
      END);
    IF COALESCE(v_terciario_pct,0) >= 0.66 THEN
      v_avisos := v_avisos || jsonb_build_object('key','ultra_prime_cambio_uso','label','Ultra Prime · cambio de uso terciario','severity','high',
        'detail','Terciario ' || round(v_terciario_pct*100,0)::text || '% + protegido + 2a escalera confirmada.');
      v_cluster := 'ultra_prime'; v_motivo := v_motivo || ' · upgrade ultra_prime';
    END IF;
  ELSIF v_protegido AND v_2esc_posible THEN
    v_avisos := v_avisos || jsonb_build_object('key','cambio_uso_por_verificar','label','Posible cambio de uso — verificar escaleras','severity','medium',
      'detail','Protegido y el Catastro (subparcelas/planta baja) sugiere >=2 escaleras, pero el plano no lo confirma. Verificar en Visor Urbanistico (PG97) antes de valorar como hospedaje.');
  ELSIF v_protegido AND v_visor_resuelve_uno THEN
    v_avisos := v_avisos || jsonb_build_object('key','escaleras_resuelto_visor','label','1 escalera (Visor PG97)','severity','info',
      'detail','Protegido pero el Visor PG97 (Analisis de la Edificacion) resuelve 1 unica caja de escalera. No apto cambio de uso por doble via.');
  END IF;

  IF v_cluster = 'ultra_prime' THEN
    w_tamano:=20; w_ratio:=20; w_own:=20; w_mg:=25; w_viv:=0; w_local:=15;
    s_tamano := CASE WHEN v_m2 BETWEEN 1500 AND 4000 THEN 1.0 WHEN v_m2 BETWEEN 1000 AND 1500 OR v_m2 BETWEEN 4000 AND 5000 THEN 0.5 ELSE 0 END;
    rango_tamano := '1500-4000';
    s_ratio := CASE WHEN v_ratio BETWEEN 90 AND 160 THEN 1.0 WHEN v_ratio BETWEEN 50 AND 90 THEN 0.5 WHEN v_ratio < 50 THEN 0.2 ELSE 0.3 END;
    rango_ratio := '90-160';
  ELSIF v_cluster = 'prime_value_add' THEN
    w_tamano:=20; w_ratio:=25; w_viv:=15; w_own:=25; w_mg:=15; w_local:=0;
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 WHEN v_m2 BETWEEN 500 AND 800 OR v_m2 BETWEEN 1800 AND 2500 THEN 0.5 ELSE 0 END;
    rango_tamano := '800-1800';
    s_ratio := CASE WHEN v_ratio BETWEEN 60 AND 110 THEN 1.0 WHEN v_ratio BETWEEN 40 AND 60 OR v_ratio BETWEEN 110 AND 140 THEN 0.5 ELSE 0.2 END;
    rango_ratio := '60-110';
  ELSIF v_cluster = 'flex_living_core' THEN
    w_tamano:=0; w_ratio:=30; w_viv:=20; w_own:=25; w_mg:=15; w_local:=10;
    s_ratio := CASE WHEN v_ratio BETWEEN 35 AND 70 THEN 1.0 WHEN v_ratio BETWEEN 70 AND 100 THEN 0.5 WHEN v_ratio < 35 THEN 0.4 ELSE 0.2 END;
    rango_ratio := '35-70';
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 ELSE 0.5 END;
    rango_tamano := '800-1800';
  ELSIF v_cluster IN ('outer_distressed','outer_distressed_selectivo') THEN
    w_tamano:=20; w_ratio:=25; w_own:=25; w_mg:=20; w_local:=10; w_viv:=0;
    s_tamano := CASE WHEN v_m2 BETWEEN 300 AND 1000 THEN 1.0 WHEN v_m2 BETWEEN 200 AND 300 OR v_m2 BETWEEN 1000 AND 1500 THEN 0.5 ELSE 0.2 END;
    rango_tamano := '300-1000';
    s_ratio := CASE WHEN v_ratio BETWEEN 40 AND 80 THEN 1.0 WHEN v_ratio BETWEEN 30 AND 40 OR v_ratio BETWEEN 80 AND 110 THEN 0.5 ELSE 0.2 END;
    rango_ratio := '40-80';
  ELSE
    w_tamano:=10; w_ratio:=10; w_viv:=10; w_own:=10; w_mg:=10; w_local:=5;
    s_tamano := CASE WHEN v_m2 IS NOT NULL THEN 0.5 ELSE 0 END;
    s_ratio := 0.4; rango_tamano := 'n/a'; rango_ratio := 'n/a';
  END IF;

  s_viv := LEAST(1.0, COALESCE(v_viv,0)::numeric / 25.0);

  IF v_owners <= 1 THEN s_own := 0;
  ELSIF v_owners <= 4 THEN s_own := 0.4;
  ELSIF v_owners <= 9 THEN s_own := 0.8;
    v_avisos := v_avisos || jsonb_build_object('key','proindiviso_grande','label', v_owners::text || ' propietarios','severity','medium',
      'detail','Proindiviso ' || v_owners::text || ' (raw: ' || v_owners_raw::text || CASE WHEN v_sl_count>0 THEN '; ' || v_sl_count::text || ' SL' ELSE '' END || ').');
  ELSIF v_owners <= 19 THEN s_own := 1.0;
    v_avisos := v_avisos || jsonb_build_object('key','proindiviso_grande','label', v_owners::text || ' propietarios','severity','medium',
      'detail','Proindiviso ' || v_owners::text || ' (raw: ' || v_owners_raw::text || ').');
  ELSE s_own := 1.0; v_bonus := v_bonus + 5;
    v_avisos := v_avisos || jsonb_build_object('key','proindiviso_critico','label', v_owners::text || ' propietarios (crítico)','severity','high',
      'detail','Proindiviso ' || v_owners::text || ' (raw: ' || v_owners_raw::text || '). Bonus +5.');
  END IF;

  s_mg := COALESCE(v_mg,0)::numeric / 10.0;

  IF ba.local_pb_m2 IS NOT NULL OR ba.local_pb_fachada_m IS NOT NULL THEN
    s_local := LEAST(1.0,
        CASE WHEN COALESCE(ba.local_pb_fachada_m,0) > 6 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_m2,0) >= 80 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_esquina,false) THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_viviendas_potenciales,0) >= 2 THEN 0.25 ELSE 0 END);
  END IF;
  SELECT tipo INTO v_calle_tipo FROM public.madrid_calles_comerciales WHERE normalize_barrio(b.direccion) LIKE '%' || calle_norm || '%' LIMIT 1;
  IF v_calle_tipo IS NOT NULL THEN s_local := LEAST(1.0, s_local + 0.3); END IF;

  IF v_aviso_cambio_uso THEN v_bonus := v_bonus + 10;
  ELSIF v_protegido THEN v_pen := v_pen + 5; END IF;
  IF COALESCE(ba.edificio_reformado,false) THEN v_pen := v_pen + 25; END IF;
  IF COALESCE(ba.gestion_profesional,false) THEN v_pen := v_pen + 15; END IF;

  IF COALESCE(v_terciario_pct,0) >= 0.66 AND NOT v_aviso_cambio_uso THEN
    v_avisos := v_avisos || jsonb_build_object('key','terciario_alto','label','Terciario ' || round(v_terciario_pct*100,0)::text || '%','severity','medium',
      'detail','Más del 66% terciario.');
  END IF;

  IF v_cluster = 'flex_living_core' AND v_ratio BETWEEN 60 AND 90 THEN
    v_avisos := v_avisos || jsonb_build_object('key','apto_reposicionamiento_2a_mano','label','Apto reposicionamiento 2ª mano','severity','medium',
      'detail','Ratio ' || round(v_ratio,0)::text || ' m²/viv óptimo para reposicionar.');
  END IF;

  v_score := round(s_tamano*w_tamano + s_ratio*w_ratio + s_viv*w_viv + s_own*w_own + s_mg*w_mg + s_local*w_local + v_bonus - v_pen, 1);
  v_score := GREATEST(0, LEAST(100, v_score));

  v_breakdown := jsonb_build_array(
    jsonb_build_object('key','tamano','label','Tamaño (óptimo ' || rango_tamano || ')','valor_raw', v_m2, 'peso', w_tamano, 'contribucion', round(s_tamano*w_tamano,1),'fuente', v_m2_fuente),
    jsonb_build_object('key','ratio','label','Ratio m²/vivienda (óptimo ' || rango_ratio || ')','valor_raw', round(coalesce(v_ratio,0),1), 'peso', w_ratio, 'contribucion', round(s_ratio*w_ratio,1)),
    jsonb_build_object('key','viviendas','label','Nº viviendas','valor_raw', v_viv, 'peso', w_viv, 'contribucion', round(s_viv*w_viv,1)),
    jsonb_build_object('key','propietarios','label','Nº propietarios (deduped · raw ' || v_owners_raw::text || CASE WHEN v_sl_count>0 THEN '; ' || v_sl_count::text || ' SL' ELSE '' END || ')','valor_raw', v_owners, 'peso', w_own, 'contribucion', round(s_own*w_own,1)),
    jsonb_build_object('key','mala_gestion','label','Mala gestión','valor_raw', v_mg, 'peso', w_mg, 'contribucion', round(s_mg*w_mg,1)),
    jsonb_build_object('key','local','label','Local PB','valor_raw', v_calle_tipo, 'peso', w_local, 'contribucion', round(s_local*w_local,1)));
  IF v_bonus > 0 THEN v_breakdown := v_breakdown || jsonb_build_object('key','bonus','label','Bonus','valor_raw',null,'peso',v_bonus,'contribucion',v_bonus); END IF;
  IF v_pen > 0 THEN v_breakdown := v_breakdown || jsonb_build_object('key','penalizacion','label','Penalizaciones','valor_raw',null,'peso',-1,'contribucion',-v_pen); END IF;

  UPDATE public.buildings
  SET cluster_asignado = v_cluster, cluster_score = v_score, cluster_breakdown = v_breakdown,
      cluster_motivo = v_motivo, avisos_inteligentes = v_avisos, numero_propietarios = v_owners,
      score = v_score, score_breakdown = v_breakdown, score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_score;
END;
$function$;