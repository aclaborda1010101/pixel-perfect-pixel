
CREATE OR REPLACE VIEW public.v_building_score AS
WITH agg AS (
  SELECT b.id, b.direccion, b.ciudad, b.division_horizontal,
         b.metadatos AS md, b.numero_propietarios,
         NULLIF(b.metadatos->>'metros_cuadrados__exactos_','')::numeric AS m2_exactos,
         NULLIF(b.metadatos->>'metros_cuadrados__rango_','') AS m2_rango,
         COALESCE(
           NULLIF(b.metadatos->>'viviendas__unidades___clonada_','')::integer,
           NULLIF(b.metadatos->>'viviendas__unidades_','')::integer,
           NULLIF(b.metadatos->>'num_viviendas','')::integer
         ) AS viviendas_unidades,
         (SELECT count(*) FROM building_owners bo WHERE bo.building_id = b.id)::integer AS owners_count
  FROM buildings b
), scored AS (
  SELECT agg.*,
         agg.m2_exactos AS m2_total,
         agg.viviendas_unidades AS num_viviendas,
         LEAST(1.0, COALESCE(agg.viviendas_unidades,0)::numeric/40.0) AS s_viviendas,
         LEAST(1.0, COALESCE(agg.m2_exactos,0)/4000.0) AS s_m2,
         CASE WHEN agg.viviendas_unidades > 0 AND agg.m2_exactos IS NOT NULL
              THEN GREATEST(0, 1.0 - LEAST(1.0, agg.m2_exactos / NULLIF(agg.viviendas_unidades,0)::numeric / 150.0))
              ELSE 0 END AS s_ratio,
         LEAST(1.0, agg.owners_count::numeric/30.0) AS s_owners,
         CASE WHEN agg.division_horizontal IS FALSE THEN 1.0 ELSE 0 END AS s_no_dh,
         NULLIF(agg.md->>'metros_cuadrados_comercio','')::numeric AS m2_comercio_x,
         COALESCE(NULLIF(agg.md->>'metros_cuadrados_oficina',''), NULLIF(agg.md->>'metros_cuadrado_oficina',''))::numeric AS m2_oficina_x,
         NULLIF(agg.md->>'metros_cuadrados_almacen','')::numeric AS m2_almacen_x,
         NULLIF(agg.md->>'metros_cuadrados_industrial','')::numeric AS m2_industrial_x
  FROM agg
), ai AS (
  SELECT s.*,
         ba.id IS NOT NULL AS has_ai_analysis,
         ba.ventanas_fachada_total,
         ba.esquina, ba.segundas_escaleras, ba.protegido_historicamente,
         ba.plantas_levantables, ba.patios_detectados, ba.confidence,
         CASE WHEN ba.metricas_extra ? 'intencion_venta'
              THEN NULLIF(ba.metricas_extra->>'intencion_venta','')::boolean
              ELSE NULL END AS intencion_venta
  FROM scored s
  LEFT JOIN building_analysis ba ON ba.building_id = s.id
), calc AS (
  SELECT ai.*,
         -- BASE: pesos suman 60
         round((18*s_viviendas + 12*s_m2 + 12*s_ratio + 12*s_owners + 6*s_no_dh)::numeric, 1) AS score_base,
         -- IA: pesos positivos suman 40 (ventanas 6 + esquina 5 + escaleras 6 + levantables 12 + terciario 4 + venta 7).
         -- Penalizaciones: protegido -4, m2<300 -4.
         CASE WHEN ai.has_ai_analysis THEN
              LEAST(6.0, COALESCE(ventanas_fachada_total,0)::numeric * 0.4)
            + CASE WHEN esquina THEN 5 ELSE 0 END
            + CASE WHEN segundas_escaleras THEN 6 ELSE 0 END
            + LEAST(12, COALESCE(plantas_levantables,0) * 4)
            + CASE WHEN COALESCE(m2_total,0) > 0
                AND ((COALESCE(m2_comercio_x,0)+COALESCE(m2_oficina_x,0)+COALESCE(m2_almacen_x,0)+COALESCE(m2_industrial_x,0)) / m2_total) > 0.66
                THEN 4 ELSE 0 END
            + CASE WHEN intencion_venta IS TRUE THEN 7 ELSE 0 END
            + CASE WHEN protegido_historicamente THEN -4 ELSE 0 END
            + CASE WHEN COALESCE(m2_total,0) > 0 AND m2_total < 300 THEN -4 ELSE 0 END
         ELSE 0 END AS score_ai_raw
  FROM ai
)
SELECT id, direccion, ciudad, division_horizontal, m2_total, num_viviendas, owners_count,
       s_viviendas, s_m2, s_ratio, s_owners, s_no_dh, has_ai_analysis,
       score_base,
       GREATEST(0, score_ai_raw)::numeric AS score_ai,
       LEAST(100, GREATEST(0, score_base + score_ai_raw))::numeric AS score,
       jsonb_build_array(
         jsonb_build_object('key','viviendas','label','Nº viviendas','valor_raw',num_viviendas,'peso',18,'contribucion',round(s_viviendas*18,1)),
         jsonb_build_object('key','m2','label','m² totales','valor_raw',m2_total,'peso',12,'contribucion',round(s_m2*12,1)),
         jsonb_build_object('key','ratio','label','Ratio m²/vivienda','valor_raw',
            CASE WHEN num_viviendas>0 AND m2_total IS NOT NULL THEN round(m2_total/num_viviendas,1) ELSE NULL END,
            'peso',12,'contribucion',round(s_ratio*12,1)),
         jsonb_build_object('key','owners','label','Nº propietarios','valor_raw',owners_count,'peso',12,'contribucion',round(s_owners*12,1)),
         jsonb_build_object('key','no_dh','label','Sin división horizontal','valor_raw',NOT division_horizontal,'peso',6,'contribucion',round(s_no_dh*6,1))
       ) ||
       CASE WHEN has_ai_analysis THEN jsonb_build_array(
         jsonb_build_object('key','ventanas','label','Ventanas fachada','valor_raw',ventanas_fachada_total,'peso',6,'contribucion',LEAST(6.0,COALESCE(ventanas_fachada_total,0)*0.4)),
         jsonb_build_object('key','esquina','label','Edificio en esquina','valor_raw',esquina,'peso',5,'contribucion',CASE WHEN esquina THEN 5 ELSE 0 END),
         jsonb_build_object('key','escaleras','label','2ª escalera','valor_raw',segundas_escaleras,'peso',6,'contribucion',CASE WHEN segundas_escaleras THEN 6 ELSE 0 END),
         jsonb_build_object('key','levantables','label','Plantas levantables','valor_raw',plantas_levantables,'peso',12,'contribucion',LEAST(12,COALESCE(plantas_levantables,0)*4)),
         jsonb_build_object('key','terciario','label','Terciario >66%','valor_raw',
            CASE WHEN COALESCE(m2_total,0)>0 THEN round((COALESCE(m2_comercio_x,0)+COALESCE(m2_oficina_x,0)+COALESCE(m2_almacen_x,0)+COALESCE(m2_industrial_x,0))/m2_total*100,1) ELSE NULL END,
            'peso',4,'contribucion',CASE WHEN COALESCE(m2_total,0)>0 AND ((COALESCE(m2_comercio_x,0)+COALESCE(m2_oficina_x,0)+COALESCE(m2_almacen_x,0)+COALESCE(m2_industrial_x,0))/m2_total)>0.66 THEN 4 ELSE 0 END),
         jsonb_build_object('key','intencion_venta','label','Intención de venta','valor_raw',intencion_venta,'peso',7,'contribucion',CASE WHEN intencion_venta IS TRUE THEN 7 ELSE 0 END),
         jsonb_build_object('key','protegido','label','Protección histórica (penaliza)','valor_raw',protegido_historicamente,'peso',-4,'contribucion',CASE WHEN protegido_historicamente THEN -4 ELSE 0 END),
         jsonb_build_object('key','pequenio','label','m² < 300 (penaliza)','valor_raw',m2_total,'peso',-4,'contribucion',CASE WHEN COALESCE(m2_total,0)>0 AND m2_total<300 THEN -4 ELSE 0 END)
       ) ELSE '[]'::jsonb END AS score_breakdown,
       NULLIF(md->>'barrios_completos__clonada_','') AS barrio,
       NULLIF(md->>'distrito_zona__clonada_','') AS distrito,
       m2_rango,
       NULLIF(md->>'tipo_de_oportunidad__clonada_','') AS tipo_oportunidad,
       NULLIF(md->>'tipo_de_activo___inmueble__clonada_','') AS tipo_activo,
       NULLIF(md->>'dividido','') AS dividido_texto,
       COALESCE(NULLIF(md->>'metros_cuadrados_viviendas___clonada_',''), NULLIF(md->>'metros_cuadrados_viviendas',''))::numeric AS m2_viviendas,
       NULLIF(md->>'comercio__unidades_','')::integer AS comercio_unidades,
       m2_comercio_x AS m2_comercio,
       NULLIF(md->>'oficina__unidades_','')::integer AS oficina_unidades,
       m2_oficina_x AS m2_oficina,
       NULLIF(md->>'almacen__unidades_','')::integer AS almacen_unidades,
       m2_almacen_x AS m2_almacen,
       NULLIF(md->>'aparcamiento__unidades_','')::integer AS aparcamiento_unidades,
       NULLIF(md->>'elementos_comunes__unidades_','')::integer AS elementos_comunes_unidades,
       NULLIF(md->>'metros_cuadrados_elementos_comunes','')::numeric AS m2_elementos_comunes,
       NULLIF(md->>'ocio_hostel__unidades_','')::integer AS ocio_hostel_unidades,
       NULLIF(md->>'metros_cuadrados_ocio_hostel','')::numeric AS m2_ocio_hostel,
       NULLIF(md->>'industrial__unidades_','')::integer AS industrial_unidades,
       m2_industrial_x AS m2_industrial,
       COALESCE(NULLIF(md->>'valoracion_viviendas___clonada_',''), NULLIF(md->>'valoracion_viviendas',''))::numeric AS valoracion_viviendas,
       NULLIF(md->>'valoracion_locales','')::numeric AS valoracion_locales,
       COALESCE(NULLIF(md->>'metros_cuadrados__exactos____clonada_',''), NULLIF(md->>'metros_cuadrados__exactos_',''))::numeric AS m2_totales_exactos
FROM calc;
