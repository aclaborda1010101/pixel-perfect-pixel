
-- Rehacemos vistas: CANTIDAD vs CALIDAD separadas, hitos como métrica principal,
-- duración solo como dato diagnóstico.

DROP VIEW IF EXISTS public.v_productividad_comercial;
DROP VIEW IF EXISTS public.v_productividad_global;
DROP VIEW IF EXISTS public.v_productividad_comercial_semana;

CREATE OR REPLACE VIEW public.v_productividad_comercial AS
WITH base AS (
  SELECT
    COALESCE(NULLIF(c.comercial_email,''),'(sin_comercial)') AS comercial,
    c.metadatos->'post_call_scoring' AS s,
    c.metadatos->>'duration_bucket'  AS db
  FROM public.calls c
)
SELECT
  comercial,
  -- CANTIDAD
  COUNT(*)                                                         AS llamadas_total,
  COUNT(*) FILTER (WHERE s IS NOT NULL)                            AS llamadas_scoreadas,
  -- CALIDAD (sobre las scoreadas)
  ROUND(AVG( (s->>'hits_total')::numeric ) FILTER (WHERE s IS NOT NULL), 2) AS hitos_medios,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'tipologia'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1)      AS pct_tipologia,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'que_le_mueve'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1)      AS pct_que_le_mueve,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'info_edificio'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1)      AS pct_info_edificio,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'canal_abierto'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1)      AS pct_canal_abierto,
  ROUND(AVG( NULLIF((s->>'score_post_call')::numeric, NULL) ), 1)  AS score_post_call_medio,
  -- DURACIÓN (diagnóstico, NO scoreada)
  COUNT(*) FILTER (WHERE db='lt_30')        AS dur_lt_30,
  COUNT(*) FILTER (WHERE db='30_60')        AS dur_30_60,
  COUNT(*) FILTER (WHERE db='60_90')        AS dur_60_90,
  COUNT(*) FILTER (WHERE db='gt_90')        AS dur_gt_90,
  COUNT(*) FILTER (WHERE db='desconocida')  AS dur_desconocida
FROM base
GROUP BY comercial;

GRANT SELECT ON public.v_productividad_comercial TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_productividad_comercial_semana AS
WITH base AS (
  SELECT
    COALESCE(NULLIF(c.comercial_email,''),'(sin_comercial)') AS comercial,
    date_trunc('week', c.fecha)::date AS semana,
    c.metadatos->'post_call_scoring' AS s,
    c.metadatos->>'duration_bucket'  AS db
  FROM public.calls c
)
SELECT
  comercial, semana,
  COUNT(*) AS llamadas_total,
  COUNT(*) FILTER (WHERE s IS NOT NULL) AS llamadas_scoreadas,
  ROUND(AVG( (s->>'hits_total')::numeric ) FILTER (WHERE s IS NOT NULL), 2) AS hitos_medios,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'tipologia'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1) AS pct_tipologia,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'que_le_mueve'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1) AS pct_que_le_mueve,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'info_edificio'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1) AS pct_info_edificio,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (s->'canal_abierto'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE s IS NOT NULL),0), 1) AS pct_canal_abierto,
  COUNT(*) FILTER (WHERE db='lt_30')  AS dur_lt_30,
  COUNT(*) FILTER (WHERE db='30_60')  AS dur_30_60,
  COUNT(*) FILTER (WHERE db='60_90')  AS dur_60_90,
  COUNT(*) FILTER (WHERE db='gt_90')  AS dur_gt_90
FROM base
GROUP BY comercial, semana;

GRANT SELECT ON public.v_productividad_comercial_semana TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_productividad_global AS
SELECT
  COUNT(*) AS llamadas_total,
  COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring') AS llamadas_scoreadas,
  ROUND(AVG( (c.metadatos->'post_call_scoring'->>'hits_total')::numeric )
        FILTER (WHERE c.metadatos ? 'post_call_scoring'), 2) AS hitos_medios,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'tipologia'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_tipologia,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'que_le_mueve'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_que_le_mueve,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'info_edificio'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_info_edificio,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'canal_abierto'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_canal_abierto,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='lt_30')  AS dur_lt_30,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='30_60')  AS dur_30_60,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='60_90')  AS dur_60_90,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='gt_90')  AS dur_gt_90
FROM public.calls c;

GRANT SELECT ON public.v_productividad_global TO authenticated, service_role;
