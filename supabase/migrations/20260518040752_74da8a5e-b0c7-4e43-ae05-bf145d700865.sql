CREATE OR REPLACE VIEW public.v_building_score AS
WITH agg AS (
  SELECT b.id,
         b.direccion,
         b.ciudad,
         b.division_horizontal,
         b.metadatos,
         b.numero_propietarios,
         NULLIF(b.metadatos->>'metros_cuadrados__exactos_', '')::numeric AS m2_total_meta,
         NULLIF(b.metadatos->>'m2_total', '')::numeric AS m2_total_alt,
         NULLIF(b.metadatos->>'num_viviendas', '')::integer AS num_viv_meta,
         NULLIF(b.metadatos->>'barrios_completos__clonada_', '') AS barrio,
         NULLIF(b.metadatos->>'distrito_zona__clonada_', '') AS distrito,
         (SELECT count(*) FROM building_owners bo WHERE bo.building_id = b.id)::integer AS owners_count
  FROM buildings b
), base AS (
  SELECT id, direccion, ciudad, division_horizontal, barrio, distrito, owners_count,
         COALESCE(m2_total_meta, m2_total_alt) AS m2_total,
         COALESCE(num_viv_meta, NULLIF(numero_propietarios,0), NULLIF(owners_count,0)) AS num_viviendas
  FROM agg
)
SELECT id, direccion, ciudad, division_horizontal,
       m2_total, num_viviendas, owners_count,
       LEAST(1.0, COALESCE(num_viviendas,0)::numeric / 40.0) AS s_viviendas,
       LEAST(1.0, COALESCE(m2_total,0)::numeric / 4000.0) AS s_m2,
       CASE WHEN num_viviendas > 0 AND m2_total IS NOT NULL
            THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, m2_total / NULLIF(num_viviendas,0)::numeric / 150.0))
            ELSE 0::numeric END AS s_ratio,
       LEAST(1.0, owners_count::numeric / 30.0) AS s_owners,
       CASE WHEN division_horizontal IS FALSE THEN 1.0 ELSE 0::numeric END AS s_no_dh,
       round((0.30 * LEAST(1.0, COALESCE(num_viviendas,0)::numeric / 40.0)
            + 0.20 * LEAST(1.0, COALESCE(m2_total,0)::numeric / 4000.0)
            + 0.20 * CASE WHEN num_viviendas > 0 AND m2_total IS NOT NULL
                          THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, m2_total / NULLIF(num_viviendas,0)::numeric / 150.0))
                          ELSE 0::numeric END
            + 0.20 * LEAST(1.0, owners_count::numeric / 30.0)
            + 0.10 * CASE WHEN division_horizontal IS FALSE THEN 1.0 ELSE 0::numeric END
            ) * 100::numeric, 1) AS score,
       barrio,
       distrito
FROM base;