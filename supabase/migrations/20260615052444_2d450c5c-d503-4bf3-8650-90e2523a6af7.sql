
CREATE OR REPLACE VIEW public.v_productividad_comercial AS
SELECT
  COALESCE(NULLIF(c.comercial_email,''),'(sin_comercial)') AS comercial,
  COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring') AS llamadas_scoreadas,
  COUNT(*) AS llamadas_total,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='lt_30')      AS dur_lt_30,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='30_60')      AS dur_30_60,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='60_90')      AS dur_60_90,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='gt_90')      AS dur_gt_90,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='desconocida') AS dur_desconocida,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'tipologia'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_tipologia,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'que_le_mueve'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_que_le_mueve,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'info_edificio'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_info_edificio,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'canal_abierto'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_canal_abierto,
  ROUND(AVG( NULLIF((c.metadatos->'post_call_scoring'->>'score_post_call')::numeric, NULL) ), 1) AS score_post_call_medio
FROM public.calls c
GROUP BY 1;

GRANT SELECT ON public.v_productividad_comercial TO authenticated;
GRANT SELECT ON public.v_productividad_comercial TO service_role;

CREATE OR REPLACE VIEW public.v_productividad_global AS
SELECT
  COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring') AS llamadas_scoreadas,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='lt_30')      AS dur_lt_30,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='30_60')      AS dur_30_60,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='60_90')      AS dur_60_90,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='gt_90')      AS dur_gt_90,
  COUNT(*) FILTER (WHERE c.metadatos->>'duration_bucket'='desconocida') AS dur_desconocida,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'tipologia'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_tipologia,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'que_le_mueve'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_que_le_mueve,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'info_edificio'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_info_edificio,
  ROUND(100.0 * COUNT(*) FILTER (WHERE (c.metadatos->'post_call_scoring'->'canal_abierto'->>'conseguido')='true')
        / NULLIF(COUNT(*) FILTER (WHERE c.metadatos ? 'post_call_scoring'),0), 1) AS pct_canal_abierto
FROM public.calls c;

GRANT SELECT ON public.v_productividad_global TO authenticated;
GRANT SELECT ON public.v_productividad_global TO service_role;
