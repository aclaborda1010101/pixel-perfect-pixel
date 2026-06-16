-- 1) Vista de auditoría
CREATE OR REPLACE VIEW public.v_cohort77_pct_audit
WITH (security_invoker=on) AS
WITH cohort AS (
  SELECT building_id FROM public.building_analysis WHERE metricas_extra ? 'reprocess_frozen_v1'
  UNION SELECT building_id FROM public.qa_ground_truth
)
SELECT
  b.id AS building_id,
  b.direccion,
  COUNT(*) AS n_owners,
  COUNT(vo.pct_propiedad) AS con_pct,
  COUNT(*) FILTER (WHERE vo.pct_invalido) AS invalidos,
  ROUND(SUM(COALESCE(vo.pct_propiedad,0))::numeric, 2) AS sum_pct,
  CASE
    WHEN COUNT(vo.pct_propiedad) = 0 THEN 'sin_pct'
    WHEN SUM(COALESCE(vo.pct_propiedad,0)) > 105 THEN 'sobre_105'
    WHEN SUM(COALESCE(vo.pct_propiedad,0)) < 95 THEN 'bajo_95'
    ELSE 'ok'
  END AS estado
FROM public.buildings b
JOIN public.v_owner_score vo ON vo.building_id = b.id
WHERE b.id IN (SELECT building_id FROM cohort)
GROUP BY b.id, b.direccion;

GRANT SELECT ON public.v_cohort77_pct_audit TO authenticated, service_role;

-- 2) Marcar los fuera de rango (no se tocan datos de owners, solo flag)
UPDATE public.building_analysis ba
SET metricas_extra = COALESCE(ba.metricas_extra, '{}'::jsonb) || jsonb_build_object(
  'pct_propiedad_needs_review', true,
  'pct_propiedad_sum', a.sum_pct,
  'pct_propiedad_estado', a.estado,
  'pct_propiedad_audited_at', to_jsonb(now())
)
FROM public.v_cohort77_pct_audit a
WHERE ba.building_id = a.building_id
  AND a.estado IN ('sobre_105','bajo_95');

-- 3) Limpiar el flag para los que ahora están OK
UPDATE public.building_analysis ba
SET metricas_extra = (COALESCE(ba.metricas_extra,'{}'::jsonb)
  - 'pct_propiedad_needs_review'
  - 'pct_propiedad_sum'
  - 'pct_propiedad_estado'
  - 'pct_propiedad_audited_at')
FROM public.v_cohort77_pct_audit a
WHERE ba.building_id = a.building_id
  AND a.estado IN ('ok','sin_pct');