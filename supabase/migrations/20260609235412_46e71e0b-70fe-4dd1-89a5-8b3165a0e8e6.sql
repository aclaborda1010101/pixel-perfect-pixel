CREATE OR REPLACE VIEW public.v_call_queue_daily AS
WITH owner_signal AS (
  SELECT
    bo.building_id,
    bo.owner_id,
    o.nombre,
    o.telefono,
    bo.cuota,
    COALESCE(vbs.score, 0) AS score_edificio,
    COALESCE(vos.score, 0) AS score_owner,
    COALESCE(vos.contactos_previos, 0) AS contactos_previos,
    vos.last_call_at,
    CASE
      WHEN vos.last_call_at IS NULL THEN 'cold'
      WHEN vos.last_call_at > now() - interval '60 days' THEN 'hot'
      ELSE 'cold'
    END AS temperatura,
    GREATEST(0, EXTRACT(epoch FROM (now() - COALESCE(vos.last_call_at, now() - interval '365 days'))) / 86400 - 30) AS dias_cadencia_vencida
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id
  LEFT JOIN public.v_building_score vbs ON vbs.id = bo.building_id
  LEFT JOIN public.v_owner_score vos ON vos.owner_id = bo.owner_id
  WHERE o.telefono IS NOT NULL AND o.telefono <> ''
)
SELECT
  *,
  ROUND((GREATEST(score_edificio, 10) * GREATEST(score_owner, 1) * (1 + dias_cadencia_vencida / 30.0))::numeric, 2) AS prioridad
FROM owner_signal
ORDER BY prioridad DESC;

GRANT SELECT ON public.v_call_queue_daily TO authenticated;