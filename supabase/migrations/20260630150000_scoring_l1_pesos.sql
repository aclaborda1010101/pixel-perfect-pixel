-- ============================================================================
-- Scoring "Layer 1" (edificio) — NUEVO esquema de PESOS por GRUPO DE BARRIO
-- ----------------------------------------------------------------------------
-- Reescritura de compute_cluster_score con la ponderación que pidió el cliente.
-- Cambios clave respecto a 20260630120000_scoring_reliability.sql (base):
--   1. Los PESOS dejan de venir del cluster (5 clusters) y pasan a venir del
--      GRUPO DE BARRIO:
--        GRUPO A "prime especiales" (Justicia, Jerónimos, Recoletos, Goya, Lista,
--          Castellana, Almagro, Trafalgar, El Viso):
--          w_own=30, w_viv=24, w_mg=20, w_esquina=14, w_ratio=12 (tamaño=0, local=0)
--        GRUPO B "resto":
--          w_viv=30, w_own=24, w_esquina=18, w_ratio=16, w_mg=12 (tamaño=0, local=0)
--      El CLUSTER (zona→cluster) se sigue calculando SOLO para: forma de banda del
--      sub-score ratio, gate de degradado <1000 m², upgrade de cambio de uso y display.
--   2. NUEVA variable s_esquina: 1.0 solo si esquina CONFIRMADA
--      (ba.esquina = true AND ba.esquina_needs_review = false). La detección es ~63%
--      fiable; las detectadas sin confirmar puntúan 0 y se marcan en v_faltantes.
--   3. Se ELIMINA el peso de tamaño (m² crudos) y de local PB en ambos grupos
--      (no están en la lista de variables del cliente). v_m2/v_ratio se siguen
--      calculando (el ratio los necesita) pero tamaño pesa 0.
--   4. Bonos: protegido + 2ª escalera CONFIRMADA -> +12 (antes +10);
--      terciario_pct >= 0.66 -> +8 (nuevo).
--   5. OPCIÓN ESTRELLA: protegido + 2ª escalera confirmada + terciario>=66% ->
--      es_estrella=true, suelo de score 95 (tras el clamp) y aviso de severidad alta.
--      es_estrella se expone en el meta `_confianza` del breakdown para que la UI
--      ordene las estrellas primero.
-- Se MANTIENE intacta toda la maquinaria de fiabilidad/confianza/datos_incompletos,
-- las penalizaciones (reformado +25, gestión profesional +15, protegido-sin-2esc +5),
-- el delta IEE, el degradado ultra_prime <1000 m², el upgrade de cambio de uso y las
-- mismas columnas escritas en el UPDATE.
-- ============================================================================

-- Columnas de esquina canónicas que usa el scoring L1 (la detección vive en
-- es_esquina_visor/esquina_visor_confianza; estas dos son la señal CONFIRMADA que
-- consume el score). Se crean idempotentes para que la función sea válida y, hasta
-- que un humano/detector las confirme, esquina puntúa 0 (confirmado-solo).
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS esquina boolean,
  ADD COLUMN IF NOT EXISTS esquina_needs_review boolean;

-- Backfill conservador: lo detectado por el visor entra como candidato pero queda
-- "needs_review" (puntúa 0) hasta confirmación humana. No imputa esquinas nuevas.
UPDATE public.building_analysis
SET esquina = COALESCE(esquina, es_esquina_visor),
    esquina_needs_review = COALESCE(esquina_needs_review,
                                    CASE WHEN COALESCE(es_esquina_visor,false) THEN true ELSE NULL END)
WHERE es_esquina_visor IS NOT NULL;

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
  v_grupo text; v_es_prime_especial boolean := false;
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
  s_esquina numeric:=0; w_esquina numeric:=0;
  es_estrella boolean := false;
  v_iee_delta numeric:=0; v_iee_aviso jsonb; v_iee_label text; v_iee_estado text;
  -- Fiabilidad
  v_mg_known boolean := false; v_owners_known boolean := false;
  v_confianza numeric := 1.0; v_faltantes text[] := '{}';
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
      v_faltantes := v_faltantes || 'zona';
    ELSE
      v_motivo := 'barrio ' || coalesce(md->>'barrios_completos__clonada_','?') || ' → ' || v_cluster;
    END IF;
  END IF;

  -- ------------------------------------------------------------------
  -- GRUPO DE BARRIO (driver de los PESOS). El cluster NO decide pesos.
  -- normalize_barrio mayúsculas + sin acentos + sin no-alfanuméricos
  -- ("El Viso"->ELVISO, "Jerónimos"->JERONIMOS). Match robusto vía IN normalizado.
  -- ------------------------------------------------------------------
  v_es_prime_especial := v_barrio_norm IN (
    normalize_barrio('Justicia'),  normalize_barrio('Jerónimos'),
    normalize_barrio('Recoletos'), normalize_barrio('Goya'),
    normalize_barrio('Lista'),     normalize_barrio('Castellana'),
    normalize_barrio('Almagro'),   normalize_barrio('Trafalgar'),
    normalize_barrio('El Viso')
  );
  v_grupo := CASE WHEN v_es_prime_especial THEN 'prime' ELSE 'resto' END;

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
  IF v_m2_fuente <> 'metadata' THEN v_faltantes := v_faltantes || 'm2_estimado'; END IF;
  IF v_m2 IS NULL THEN v_faltantes := v_faltantes || 'm2'; END IF;

  v_owners_raw := (SELECT count(*)::integer FROM building_owners bo WHERE bo.building_id = p_building_id);
  v_owners := public.count_distinct_owners(p_building_id);
  v_owners_known := COALESCE(v_owners_raw,0) > 0;
  v_sl_count := (SELECT count(DISTINCT company_id)::integer FROM building_companies WHERE building_id = p_building_id);
  v_ratio := CASE WHEN v_viv>0 AND v_m2 IS NOT NULL THEN v_m2/v_viv ELSE NULL END;
  v_mg := COALESCE(ba.mala_gestion_score, 0);
  v_mg_known := ba.mala_gestion_score IS NOT NULL;
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

  v_2esc_confirmada := COALESCE(ba.second_staircase_confirmed, false);

  v_2esc_posible := (NOT v_2esc_confirmada)
    AND ( COALESCE(ba.n_escaleras_visor,0) >= 2
          OR COALESCE(ba.segundas_escaleras,false)
          OR COALESCE(ba.n_escaleras_en_piso01,0) >= 2
          OR GREATEST(COALESCE(ba.n_escaleras_en_planta_baja,0),
                      COALESCE(NULLIF(md->>'num_escaleras','')::integer,0),
                      COALESCE(v_n_subparc,0)) >= 2 );

  IF v_protegido AND v_2esc_confirmada THEN
    v_aviso_cambio_uso := true;
    v_avisos := v_avisos || jsonb_build_object('key','cambio_uso_hospedaje','label','Apto cambio de uso a hospedaje','severity','high',
      'detail','Protegido + 2a escalera CONFIRMADA (' || COALESCE(ba.second_staircase_confirmed_source,'confirmada') || '). PGOU Madrid.');
    IF COALESCE(v_terciario_pct,0) >= 0.66 THEN
      v_avisos := v_avisos || jsonb_build_object('key','ultra_prime_cambio_uso','label','Ultra Prime · cambio de uso terciario','severity','high',
        'detail','Terciario ' || round(v_terciario_pct*100,0)::text || '% + protegido + 2a escalera confirmada.');
      v_cluster := 'ultra_prime'; v_motivo := v_motivo || ' · upgrade ultra_prime';
      -- ESTRELLA: protegido + 2a escalera confirmada + terciario >= 66%
      es_estrella := true;
    END IF;
  ELSIF v_protegido AND v_2esc_posible THEN
    -- Severidad ALTA: es accionable (confirmar 2a escalera) y desbloquea ultra_prime/hospedaje.
    v_avisos := v_avisos || jsonb_build_object('key','cambio_uso_sugerido_revisar','label','Posible cambio de uso — CONFIRMAR 2a escalera','severity','high',
      'detail','El análisis sugiere >=2 escaleras (Visor: ' || COALESCE(ba.n_escaleras_visor::text,'-') || ', conf ' || COALESCE(ba.escaleras_visor_confianza::text,'-') || ') + protegido' ||
               CASE WHEN COALESCE(v_terciario_pct,0) >= 0.66 THEN ' + terciario ' || round(v_terciario_pct*100,0)::text || '%' ELSE '' END ||
               '. NO puntúa hasta confirmación humana: confírmala para activar el upgrade.');
    v_faltantes := v_faltantes || 'segunda_escalera_sin_confirmar';
  END IF;

  -- ------------------------------------------------------------------
  -- Bandas del sub-score RATIO (forma según CLUSTER) + s_tamano (peso 0).
  -- Los PESOS NO se asignan aquí; vienen del grupo de barrio más abajo.
  -- ------------------------------------------------------------------
  IF v_cluster = 'ultra_prime' THEN
    s_tamano := CASE WHEN v_m2 BETWEEN 1500 AND 4000 THEN 1.0 WHEN v_m2 BETWEEN 1000 AND 1500 OR v_m2 BETWEEN 4000 AND 5000 THEN 0.5 ELSE 0 END;
    rango_tamano := '1500-4000';
    s_ratio := CASE WHEN v_ratio BETWEEN 90 AND 160 THEN 1.0 WHEN v_ratio BETWEEN 50 AND 90 THEN 0.5 WHEN v_ratio < 50 THEN 0.2 ELSE 0.3 END;
    rango_ratio := '90-160';
  ELSIF v_cluster = 'prime_value_add' THEN
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 WHEN v_m2 BETWEEN 500 AND 800 OR v_m2 BETWEEN 1800 AND 2500 THEN 0.5 ELSE 0 END;
    rango_tamano := '800-1800';
    s_ratio := CASE WHEN v_ratio BETWEEN 60 AND 110 THEN 1.0 WHEN v_ratio BETWEEN 40 AND 60 OR v_ratio BETWEEN 110 AND 140 THEN 0.5 ELSE 0.2 END;
    rango_ratio := '60-110';
  ELSIF v_cluster = 'flex_living_core' THEN
    s_ratio := CASE WHEN v_ratio BETWEEN 35 AND 70 THEN 1.0 WHEN v_ratio BETWEEN 70 AND 100 THEN 0.5 WHEN v_ratio < 35 THEN 0.4 ELSE 0.2 END;
    rango_ratio := '35-70';
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 ELSE 0.5 END;
    rango_tamano := '800-1800';
  ELSIF v_cluster IN ('outer_distressed','outer_distressed_selectivo') THEN
    s_tamano := CASE WHEN v_m2 BETWEEN 300 AND 1000 THEN 1.0 WHEN v_m2 BETWEEN 200 AND 300 OR v_m2 BETWEEN 1000 AND 1500 THEN 0.5 ELSE 0.2 END;
    rango_tamano := '300-1000';
    s_ratio := CASE WHEN v_ratio BETWEEN 40 AND 80 THEN 1.0 WHEN v_ratio BETWEEN 30 AND 40 OR v_ratio BETWEEN 80 AND 110 THEN 0.5 ELSE 0.2 END;
    rango_ratio := '40-80';
  ELSE
    s_tamano := CASE WHEN v_m2 IS NOT NULL THEN 0.5 ELSE 0 END;
    s_ratio := 0.4; rango_tamano := 'n/a'; rango_ratio := 'n/a';
  END IF;

  -- ------------------------------------------------------------------
  -- PESOS por GRUPO DE BARRIO (suman 100). tamaño=0 y local=0 en ambos.
  -- ------------------------------------------------------------------
  IF v_es_prime_especial THEN
    w_own:=30; w_viv:=24; w_mg:=20; w_esquina:=14; w_ratio:=12; w_tamano:=0; w_local:=0;
  ELSE
    w_viv:=30; w_own:=24; w_esquina:=18; w_ratio:=16; w_mg:=12; w_tamano:=0; w_local:=0;
  END IF;

  s_viv := LEAST(1.0, COALESCE(v_viv,0)::numeric / 25.0);

  -- ESQUINA (NUEVA): 1.0 SOLO si esquina CONFIRMADA (detección ~63% fiable).
  -- Las detectadas sin confirmar puntúan 0 pero se marcan como faltante visible.
  IF COALESCE(ba.esquina,false) = true AND COALESCE(ba.esquina_needs_review,false) = false THEN
    s_esquina := 1.0;
  ELSE
    s_esquina := 0;
    IF COALESCE(ba.esquina,false) = true AND COALESCE(ba.esquina_needs_review,false) = true THEN
      v_faltantes := v_faltantes || 'esquina_sin_confirmar';
    END IF;
  END IF;

  -- Propietarios: si no hay dato (raw=0) se MARCA como dato incompleto (no cambia el
  -- número: s_own sigue el camino original). Visibilidad, no imputación.
  IF NOT v_owners_known THEN
    v_faltantes := v_faltantes || 'propietarios';
    v_avisos := v_avisos || jsonb_build_object('key','propietarios_sin_dato','label','Propietarios sin dato','severity','medium',
      'detail','Sin propietarios cargados para este edificio; el nº de copropietarios no ha podido valorarse. Score con confianza reducida.');
  END IF;
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

  -- Mala gestión: el número NO cambia (s_mg = score/10, 0 si NULL como en producción).
  -- Solo se MARCA como dato incompleto para bajar la confianza del score visible.
  s_mg := COALESCE(v_mg,0)::numeric / 10.0;
  IF NOT v_mg_known THEN
    v_faltantes := v_faltantes || 'mala_gestion';
    v_avisos := v_avisos || jsonb_build_object('key','mala_gestion_sin_dato','label','Mala gestión sin dato','severity','medium',
      'detail','Sin señales de gestión/conflicto extraídas del CRM. El score no penaliza por ello (sin dato); recalcular tras enriquecer HubSpot.');
  END IF;

  -- Local PB: se sigue COMPUTANDO para diagnóstico/breakdown, pero pesa 0 (w_local=0).
  IF ba.local_pb_m2 IS NOT NULL OR ba.local_pb_fachada_m IS NOT NULL THEN
    s_local := LEAST(1.0,
        CASE WHEN COALESCE(ba.local_pb_fachada_m,0) > 6 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_m2,0) >= 80 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_esquina,false) THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_viviendas_potenciales,0) >= 2 THEN 0.25 ELSE 0 END);
  END IF;
  SELECT tipo INTO v_calle_tipo FROM public.madrid_calles_comerciales WHERE normalize_barrio(b.direccion) LIKE '%' || calle_norm || '%' LIMIT 1;
  IF v_calle_tipo IS NOT NULL THEN s_local := LEAST(1.0, s_local + 0.3); END IF;

  -- Bonos/penalizaciones de cambio de uso y protegido.
  IF v_aviso_cambio_uso THEN v_bonus := v_bonus + 12;           -- antes +10
  ELSIF v_protegido THEN v_pen := v_pen + 5; END IF;            -- protegido sin 2esc
  IF COALESCE(ba.edificio_reformado,false) THEN v_pen := v_pen + 25; END IF;
  IF COALESCE(ba.gestion_profesional,false) THEN v_pen := v_pen + 15; END IF;

  -- Bono terciario (nuevo): >=66% terciario -> +8.
  IF COALESCE(v_terciario_pct,0) >= 0.66 THEN
    v_bonus := v_bonus + 8;
  END IF;

  IF COALESCE(v_terciario_pct,0) >= 0.66 AND NOT v_aviso_cambio_uso THEN
    v_avisos := v_avisos || jsonb_build_object('key','terciario_alto','label','Terciario ' || round(v_terciario_pct*100,0)::text || '%','severity','medium',
      'detail','Más del 66% terciario.');
  END IF;

  -- ESTRELLA: aviso de máxima prioridad cuando se cumplen las tres condiciones.
  IF es_estrella THEN
    v_avisos := v_avisos || jsonb_build_object('key','estrella','label','⭐ OPCIÓN ESTRELLA','severity','high',
      'detail','protegido + 2ª escalera confirmada + ≥66% terciario → máxima prioridad');
  END IF;

  IF v_cluster = 'flex_living_core' AND v_ratio BETWEEN 60 AND 90 THEN
    v_avisos := v_avisos || jsonb_build_object('key','apto_reposicionamiento_2a_mano','label','Apto reposicionamiento 2ª mano','severity','medium',
      'detail','Ratio ' || round(v_ratio,0)::text || ' m²/viv óptimo para reposicionar.');
  END IF;

  -- IEE / ITE
  SELECT delta, aviso, label, estado INTO v_iee_delta, v_iee_aviso, v_iee_label, v_iee_estado
    FROM public.iee_score_components(p_building_id);
  IF v_iee_aviso IS NOT NULL THEN
    v_avisos := v_avisos || v_iee_aviso;
  END IF;

  v_score := round(
      s_tamano*w_tamano + s_ratio*w_ratio + s_viv*w_viv + s_own*w_own
    + s_mg*w_mg + s_esquina*w_esquina + s_local*w_local
    + v_bonus + v_iee_delta - v_pen, 1);
  -- Clamp BASE [0,100] ANTES del suelo de estrella.
  v_score := GREATEST(0, LEAST(100, v_score));
  -- Suelo ESTRELLA: aplica DESPUÉS del clamp (la estrella siempre el top, 95-100).
  IF es_estrella THEN
    v_score := GREATEST(v_score, 95);
  END IF;

  -- Confianza: 1.0 menos 0.18 por cada input ausente/estimado (suelo 0.2).
  v_confianza := GREATEST(0.2, round(1.0 - 0.18 * COALESCE(array_length(v_faltantes,1),0), 2));
  IF COALESCE(array_length(v_faltantes,1),0) > 0 THEN
    v_avisos := v_avisos || jsonb_build_object(
      'key','datos_incompletos',
      'label','Datos incompletos (confianza ' || round(v_confianza*100,0)::text || '%)',
      'severity', CASE WHEN v_confianza < 0.6 THEN 'high' ELSE 'medium' END,
      'detail','Score con fiabilidad reducida. Faltan/estimados: ' || array_to_string(v_faltantes, ', ') || '.');
  END IF;

  v_breakdown := jsonb_build_array(
    jsonb_build_object('key','viviendas','label','Nº viviendas','valor_raw', v_viv, 'peso', w_viv, 'contribucion', round(s_viv*w_viv,1)),
    jsonb_build_object('key','propietarios','label','Nº propietarios (deduped · raw ' || v_owners_raw::text || CASE WHEN v_sl_count>0 THEN '; ' || v_sl_count::text || ' SL' ELSE '' END || ')','valor_raw', v_owners, 'peso', w_own, 'contribucion', round(s_own*w_own,1)),
    jsonb_build_object('key','mala_gestion','label','Mala gestión' || CASE WHEN NOT v_mg_known THEN ' (sin dato)' ELSE '' END,'valor_raw', CASE WHEN v_mg_known THEN v_mg ELSE NULL END, 'peso', w_mg, 'contribucion', round(s_mg*w_mg,1)),
    jsonb_build_object('key','esquina','label','Esquina confirmada','valor_raw', CASE WHEN COALESCE(ba.esquina,false) THEN (CASE WHEN COALESCE(ba.esquina_needs_review,false) THEN 'detectada (sin confirmar)' ELSE 'confirmada' END) ELSE 'no' END, 'peso', w_esquina, 'contribucion', round(s_esquina*w_esquina,1)),
    jsonb_build_object('key','ratio','label','Ratio m²/vivienda (óptimo ' || rango_ratio || ')','valor_raw', round(coalesce(v_ratio,0),1), 'peso', w_ratio, 'contribucion', round(s_ratio*w_ratio,1)),
    jsonb_build_object('key','tamano','label','Tamaño (óptimo ' || rango_tamano || ')','valor_raw', v_m2, 'peso', w_tamano, 'contribucion', round(s_tamano*w_tamano,1),'fuente', v_m2_fuente),
    jsonb_build_object('key','local','label','Local PB','valor_raw', v_calle_tipo, 'peso', w_local, 'contribucion', round(s_local*w_local,1)));
  IF v_iee_estado IS NOT NULL AND v_iee_estado <> 'desconocido' THEN
    v_breakdown := v_breakdown || jsonb_build_object('key','iee','label', coalesce(v_iee_label,'IEE'),'valor_raw', v_iee_estado,'peso', 0,'contribucion', round(v_iee_delta,1));
  END IF;
  IF v_bonus > 0 THEN v_breakdown := v_breakdown || jsonb_build_object('key','bonus','label','Bonus','valor_raw',null,'peso',v_bonus,'contribucion',v_bonus); END IF;
  IF v_pen > 0 THEN v_breakdown := v_breakdown || jsonb_build_object('key','penalizacion','label','Penalizaciones','valor_raw',null,'peso',-1,'contribucion',-v_pen); END IF;
  -- Meta de fiabilidad + grupo + estrella (el frontend usa _confianza; estrella para ordenar).
  v_breakdown := v_breakdown || jsonb_build_object('key','_confianza','label','Confianza del score','valor_raw', v_confianza, 'peso', 0, 'contribucion', 0,
    'datos_incompletos', to_jsonb(v_faltantes), 'grupo', v_grupo, 'es_estrella', es_estrella);

  UPDATE public.buildings
  SET cluster_asignado = v_cluster, cluster_score = v_score, cluster_breakdown = v_breakdown,
      cluster_motivo = v_motivo, avisos_inteligentes = v_avisos, numero_propietarios = v_owners,
      score = v_score, score_breakdown = v_breakdown, score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_score;
END;
$function$;
