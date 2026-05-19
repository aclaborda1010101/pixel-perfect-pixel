CREATE OR REPLACE VIEW public.v_building_score AS
 WITH agg AS (
   SELECT b.id,
     b.direccion,
     b.ciudad,
     b.division_horizontal,
     b.metadatos AS md,
     b.numero_propietarios,
     NULLIF(b.metadatos ->> 'metros_cuadrados__exactos_'::text, ''::text)::numeric AS m2_exactos,
     NULLIF(b.metadatos ->> 'metros_cuadrados__rango_'::text, ''::text) AS m2_rango,
     COALESCE(
       NULLIF(b.metadatos ->> 'viviendas__unidades___clonada_'::text, ''::text)::integer,
       NULLIF(b.metadatos ->> 'viviendas__unidades_'::text, ''::text)::integer,
       NULLIF(b.metadatos ->> 'num_viviendas'::text, ''::text)::integer
     ) AS viviendas_unidades,
     (( SELECT count(*) AS count
            FROM building_owners bo
           WHERE bo.building_id = b.id))::integer AS owners_count
    FROM buildings b
 ), base AS (
   SELECT agg.id,
     agg.direccion,
     agg.ciudad,
     agg.division_horizontal,
     agg.owners_count,
     agg.md,
     agg.m2_rango,
     agg.m2_exactos AS m2_total,
     agg.viviendas_unidades AS num_viviendas
    FROM agg
 )
 SELECT id,
   direccion,
   ciudad,
   division_horizontal,
   m2_total,
   num_viviendas,
   owners_count,
   LEAST(1.0, COALESCE(num_viviendas, 0)::numeric / 40.0) AS s_viviendas,
   LEAST(1.0, COALESCE(m2_total, 0::numeric) / 4000.0) AS s_m2,
   CASE
     WHEN num_viviendas > 0 AND m2_total IS NOT NULL THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, m2_total / NULLIF(num_viviendas, 0)::numeric / 150.0))
     ELSE 0::numeric
   END AS s_ratio,
   LEAST(1.0, owners_count::numeric / 30.0) AS s_owners,
   CASE
     WHEN division_horizontal IS FALSE THEN 1.0
     ELSE 0::numeric
   END AS s_no_dh,
   round((0.30 * LEAST(1.0, COALESCE(num_viviendas, 0)::numeric / 40.0) + 0.20 * LEAST(1.0, COALESCE(m2_total, 0::numeric) / 4000.0) + 0.20 *
     CASE
       WHEN num_viviendas > 0 AND m2_total IS NOT NULL THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, m2_total / NULLIF(num_viviendas, 0)::numeric / 150.0))
       ELSE 0::numeric
     END + 0.20 * LEAST(1.0, owners_count::numeric / 30.0) + 0.10 *
     CASE
       WHEN division_horizontal IS FALSE THEN 1.0
       ELSE 0::numeric
     END) * 100::numeric, 1) AS score,
   NULLIF(md ->> 'barrios_completos__clonada_'::text, ''::text) AS barrio,
   NULLIF(md ->> 'distrito_zona__clonada_'::text, ''::text) AS distrito,
   m2_rango,
   NULLIF(md ->> 'tipo_de_oportunidad__clonada_'::text, ''::text) AS tipo_oportunidad,
   NULLIF(md ->> 'tipo_de_activo___inmueble__clonada_'::text, ''::text) AS tipo_activo,
   NULLIF(md ->> 'dividido'::text, ''::text) AS dividido_texto,
   NULLIF(md ->> 'metros_cuadrados_viviendas'::text, ''::text)::numeric AS m2_viviendas,
   NULLIF(md ->> 'comercio__unidades_'::text, ''::text)::integer AS comercio_unidades,
   NULLIF(md ->> 'metros_cuadrados_comercio'::text, ''::text)::numeric AS m2_comercio,
   NULLIF(md ->> 'oficina__unidades_'::text, ''::text)::integer AS oficina_unidades,
   NULLIF(md ->> 'metros_cuadrado_oficina'::text, ''::text)::numeric AS m2_oficina,
   NULLIF(md ->> 'almacen__unidades_'::text, ''::text)::integer AS almacen_unidades,
   NULLIF(md ->> 'metros_cuadrados_almacen'::text, ''::text)::numeric AS m2_almacen,
   NULLIF(md ->> 'aparcamiento__unidades_'::text, ''::text)::integer AS aparcamiento_unidades,
   NULLIF(md ->> 'elementos_comunes__unidades_'::text, ''::text)::integer AS elementos_comunes_unidades,
   NULLIF(md ->> 'metros_cuadrados_elementos_comunes'::text, ''::text)::numeric AS m2_elementos_comunes,
   NULLIF(md ->> 'ocio_hostel__unidades_'::text, ''::text)::integer AS ocio_hostel_unidades,
   NULLIF(md ->> 'metros_cuadrados_ocio_hostel'::text, ''::text)::numeric AS m2_ocio_hostel,
   NULLIF(md ->> 'industrial__unidades_'::text, ''::text)::integer AS industrial_unidades,
   NULLIF(md ->> 'metros_cuadrados_industrial'::text, ''::text)::numeric AS m2_industrial,
   NULLIF(md ->> 'valoracion_viviendas'::text, ''::text)::numeric AS valoracion_viviendas,
   NULLIF(md ->> 'valoracion_locales'::text, ''::text)::numeric AS valoracion_locales
  FROM base;

GRANT SELECT ON public.v_building_score TO authenticated, anon;