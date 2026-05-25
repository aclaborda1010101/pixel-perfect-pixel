
DELETE FROM public.app_settings WHERE key = 'scoring_v2_enabled';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='score_v2')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='score') THEN
    ALTER TABLE public.buildings RENAME COLUMN score_v2 TO score;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='score_v2_breakdown')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='score_breakdown') THEN
    ALTER TABLE public.buildings RENAME COLUMN score_v2_breakdown TO score_breakdown;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='score_v2_updated_at')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='score_updated_at') THEN
    ALTER TABLE public.buildings RENAME COLUMN score_v2_updated_at TO score_updated_at;
  END IF;
END $$;

DROP INDEX IF EXISTS public.buildings_score_v2_idx;
CREATE INDEX IF NOT EXISTS buildings_score_idx ON public.buildings(score DESC NULLS LAST);

DROP TRIGGER IF EXISTS analysis_recompute_score ON public.building_analysis;
DROP FUNCTION IF EXISTS public.trg_recompute_score_v2();
DROP FUNCTION IF EXISTS public.compute_score_v2(uuid);

DROP VIEW IF EXISTS public.v_building_score CASCADE;

CREATE VIEW public.v_building_score AS
WITH agg AS (
  SELECT
    b.id,
    b.direccion,
    b.ciudad,
    b.division_horizontal,
    b.metadatos AS md,
    b.numero_propietarios,
    NULLIF(b.metadatos->>'metros_cuadrados__exactos_','')::numeric AS m2_exactos,
    NULLIF(b.metadatos->>'metros_cuadrados__rango_','') AS m2_rango,
    COALESCE(
      NULLIF(b.metadatos->>'viviendas__unidades___clonada_','')::int,
      NULLIF(b.metadatos->>'viviendas__unidades_','')::int,
      NULLIF(b.metadatos->>'num_viviendas','')::int
    ) AS viviendas_unidades,
    (SELECT count(*) FROM public.building_owners bo WHERE bo.building_id = b.id)::int AS owners_count
  FROM public.buildings b
),
scored AS (
  SELECT
    agg.id, agg.direccion, agg.ciudad, agg.division_horizontal,
    agg.owners_count, agg.md, agg.m2_rango,
    agg.m2_exactos AS m2_total,
    agg.viviendas_unidades AS num_viviendas,
    LEAST(1.0, COALESCE(agg.viviendas_unidades,0)::numeric/40.0) AS s_viviendas,
    LEAST(1.0, COALESCE(agg.m2_exactos,0)/4000.0) AS s_m2,
    CASE WHEN agg.viviendas_unidades>0 AND agg.m2_exactos IS NOT NULL
         THEN GREATEST(0, 1.0 - LEAST(1.0, agg.m2_exactos/NULLIF(agg.viviendas_unidades,0)::numeric/150.0))
         ELSE 0 END AS s_ratio,
    LEAST(1.0, agg.owners_count::numeric/30.0) AS s_owners,
    CASE WHEN agg.division_horizontal IS FALSE THEN 1.0 ELSE 0 END AS s_no_dh,
    NULLIF(agg.md->>'metros_cuadrados_comercio','')::numeric AS m2_comercio_x,
    COALESCE(NULLIF(agg.md->>'metros_cuadrados_oficina',''),NULLIF(agg.md->>'metros_cuadrado_oficina',''))::numeric AS m2_oficina_x,
    NULLIF(agg.md->>'metros_cuadrados_almacen','')::numeric AS m2_almacen_x,
    NULLIF(agg.md->>'metros_cuadrados_industrial','')::numeric AS m2_industrial_x
  FROM agg
),
ai AS (
  SELECT
    scored.*,
    (ba.id IS NOT NULL) AS has_ai_analysis,
    ba.ventanas_fachada_total,
    ba.esquina, ba.segundas_escaleras,
    ba.protegido_historicamente,
    ba.plantas_levantables,
    ba.patios_detectados,
    ba.confidence,
    CASE WHEN ba.metricas_extra ? 'intencion_venta'
         THEN NULLIF(ba.metricas_extra->>'intencion_venta','')::boolean END AS intencion_venta
  FROM scored
  LEFT JOIN public.building_analysis ba ON ba.building_id = scored.id
),
calc AS (
  SELECT
    ai.*,
    round((0.30*s_viviendas + 0.20*s_m2 + 0.20*s_ratio + 0.20*s_owners + 0.10*s_no_dh)*100, 1) AS score_base,
    CASE WHEN has_ai_analysis THEN
      LEAST(30, COALESCE(ventanas_fachada_total,0)*1.5)
      + CASE WHEN esquina THEN 25 ELSE 0 END
      + CASE WHEN segundas_escaleras THEN 30 ELSE 0 END
      + LEAST(45, COALESCE(plantas_levantables,0)*15)
      + CASE WHEN protegido_historicamente THEN 15 ELSE 0 END
      + CASE WHEN COALESCE(m2_total,0) > 0
                  AND ((COALESCE(m2_comercio_x,0)+COALESCE(m2_oficina_x,0)+COALESCE(m2_almacen_x,0)+COALESCE(m2_industrial_x,0))/m2_total) > 0.66
             THEN 25 ELSE 0 END
      + CASE WHEN intencion_venta IS TRUE THEN 35 ELSE 0 END
      + CASE WHEN COALESCE(m2_total,0) > 0 AND m2_total < 300 THEN -25 ELSE 0 END
    ELSE 0 END AS score_ai_raw
  FROM ai
)
SELECT
  id, direccion, ciudad, division_horizontal,
  m2_total, num_viviendas, owners_count,
  s_viviendas, s_m2, s_ratio, s_owners, s_no_dh,
  has_ai_analysis,
  score_base,
  GREATEST(0, score_ai_raw) AS score_ai,
  LEAST(100, GREATEST(0, score_base + score_ai_raw)) AS score,
  (
    jsonb_build_array(
      jsonb_build_object('key','viviendas','label','Nº viviendas','valor_raw', num_viviendas, 'peso',30,'contribucion', round(s_viviendas*30,1)),
      jsonb_build_object('key','m2','label','m² totales','valor_raw', m2_total, 'peso',20,'contribucion', round(s_m2*20,1)),
      jsonb_build_object('key','ratio','label','Ratio m²/vivienda','valor_raw',
        CASE WHEN num_viviendas>0 AND m2_total IS NOT NULL THEN round(m2_total/num_viviendas,1) ELSE NULL END,
        'peso',20,'contribucion', round(s_ratio*20,1)),
      jsonb_build_object('key','owners','label','Nº propietarios','valor_raw', owners_count, 'peso',20,'contribucion', round(s_owners*20,1)),
      jsonb_build_object('key','no_dh','label','Sin división horizontal','valor_raw', NOT division_horizontal, 'peso',10,'contribucion', round(s_no_dh*10,1))
    )
    || CASE WHEN has_ai_analysis THEN jsonb_build_array(
        jsonb_build_object('key','ventanas','label','Ventanas fachada','valor_raw', ventanas_fachada_total,'peso',30,'contribucion', LEAST(30, COALESCE(ventanas_fachada_total,0)*1.5)),
        jsonb_build_object('key','esquina','label','Edificio en esquina','valor_raw', esquina,'peso',25,'contribucion', CASE WHEN esquina THEN 25 ELSE 0 END),
        jsonb_build_object('key','escaleras','label','2ª escalera','valor_raw', segundas_escaleras,'peso',30,'contribucion', CASE WHEN segundas_escaleras THEN 30 ELSE 0 END),
        jsonb_build_object('key','levantables','label','Plantas levantables','valor_raw', plantas_levantables,'peso',45,'contribucion', LEAST(45, COALESCE(plantas_levantables,0)*15)),
        jsonb_build_object('key','protegido','label','Protección histórica','valor_raw', protegido_historicamente,'peso',15,'contribucion', CASE WHEN protegido_historicamente THEN 15 ELSE 0 END),
        jsonb_build_object('key','terciario','label','Terciario >66%','valor_raw',
          CASE WHEN COALESCE(m2_total,0)>0 THEN round(((COALESCE(m2_comercio_x,0)+COALESCE(m2_oficina_x,0)+COALESCE(m2_almacen_x,0)+COALESCE(m2_industrial_x,0))/m2_total)*100,1) ELSE NULL END,
          'peso',25,
          'contribucion', CASE WHEN COALESCE(m2_total,0)>0 AND ((COALESCE(m2_comercio_x,0)+COALESCE(m2_oficina_x,0)+COALESCE(m2_almacen_x,0)+COALESCE(m2_industrial_x,0))/m2_total) > 0.66 THEN 25 ELSE 0 END),
        jsonb_build_object('key','intencion_venta','label','Intención de venta','valor_raw', intencion_venta,'peso',35,'contribucion', CASE WHEN intencion_venta IS TRUE THEN 35 ELSE 0 END),
        jsonb_build_object('key','pequenio','label','m² < 300 (penalización)','valor_raw', m2_total,'peso',-25,'contribucion', CASE WHEN COALESCE(m2_total,0)>0 AND m2_total<300 THEN -25 ELSE 0 END)
      ) ELSE '[]'::jsonb END
  ) AS score_breakdown,
  NULLIF(md->>'barrios_completos__clonada_','') AS barrio,
  NULLIF(md->>'distrito_zona__clonada_','') AS distrito,
  m2_rango,
  NULLIF(md->>'tipo_de_oportunidad__clonada_','') AS tipo_oportunidad,
  NULLIF(md->>'tipo_de_activo___inmueble__clonada_','') AS tipo_activo,
  NULLIF(md->>'dividido','') AS dividido_texto,
  COALESCE(NULLIF(md->>'metros_cuadrados_viviendas___clonada_',''),NULLIF(md->>'metros_cuadrados_viviendas',''))::numeric AS m2_viviendas,
  NULLIF(md->>'comercio__unidades_','')::int AS comercio_unidades,
  m2_comercio_x AS m2_comercio,
  NULLIF(md->>'oficina__unidades_','')::int AS oficina_unidades,
  m2_oficina_x AS m2_oficina,
  NULLIF(md->>'almacen__unidades_','')::int AS almacen_unidades,
  m2_almacen_x AS m2_almacen,
  NULLIF(md->>'aparcamiento__unidades_','')::int AS aparcamiento_unidades,
  NULLIF(md->>'elementos_comunes__unidades_','')::int AS elementos_comunes_unidades,
  NULLIF(md->>'metros_cuadrados_elementos_comunes','')::numeric AS m2_elementos_comunes,
  NULLIF(md->>'ocio_hostel__unidades_','')::int AS ocio_hostel_unidades,
  NULLIF(md->>'metros_cuadrados_ocio_hostel','')::numeric AS m2_ocio_hostel,
  NULLIF(md->>'industrial__unidades_','')::int AS industrial_unidades,
  m2_industrial_x AS m2_industrial,
  COALESCE(NULLIF(md->>'valoracion_viviendas___clonada_',''),NULLIF(md->>'valoracion_viviendas',''))::numeric AS valoracion_viviendas,
  NULLIF(md->>'valoracion_locales','')::numeric AS valoracion_locales,
  COALESCE(NULLIF(md->>'metros_cuadrados__exactos____clonada_',''),NULLIF(md->>'metros_cuadrados__exactos_',''))::numeric AS m2_totales_exactos
FROM calc;

CREATE OR REPLACE FUNCTION public.compute_score(p_building_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_avisos jsonb := '[]'::jsonb;
  v_an public.building_analysis%ROWTYPE;
  v_has_ai boolean;
BEGIN
  SELECT * INTO v_row FROM public.v_building_score WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

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
  SET score = v_row.score,
      score_breakdown = v_row.score_breakdown,
      avisos_inteligentes = v_avisos,
      score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_row.score;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_recompute_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.compute_score(NEW.building_id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER analysis_recompute_score
AFTER INSERT OR UPDATE ON public.building_analysis
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_score();
