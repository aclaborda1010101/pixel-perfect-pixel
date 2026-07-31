DROP VIEW IF EXISTS public.v_retro_audit_progress;
DROP VIEW IF EXISTS public.v_retro_audit_queue;

CREATE VIEW public.v_retro_audit_queue AS
SELECT hc.hs_id,
       hc.hs_timestamp,
       hc.hs_call_duration,
       hc.hs_owner_id,
       hc.hs_call_disposition,
       hc.associated_contact_ids,
       EXISTS (
         SELECT 1 FROM public.external_ids e
         JOIN public.building_owners bo ON bo.owner_id = e.entity_id
         WHERE e.entity_type = 'owner' AND e.provider = 'hubspot'
           AND e.provider_id = ANY (hc.associated_contact_ids)
       ) AS tiene_edificio
FROM public.hubspot_calls hc
WHERE hc.hs_call_transcription IS NOT NULL
  AND hc.hs_call_transcription <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.call_sessions cs WHERE cs.hubspot_call_id = hc.hs_id
  );

GRANT SELECT ON public.v_retro_audit_queue TO authenticated, service_role;

CREATE VIEW public.v_retro_audit_progress AS
WITH universe AS (
  SELECT count(*)::int AS total FROM public.hubspot_calls hc
  WHERE hc.hs_call_transcription IS NOT NULL AND hc.hs_call_transcription <> ''
), audited AS (
  SELECT count(*)::int AS n FROM public.call_sessions
  WHERE voss_post IS NOT NULL AND hubspot_call_id IS NOT NULL
), pending AS (
  SELECT count(*)::int AS n, count(*) FILTER (WHERE tiene_edificio)::int AS n_con_edificio
  FROM public.v_retro_audit_queue
)
SELECT (SELECT total FROM universe) AS total_universo,
       (SELECT n FROM audited) AS auditadas,
       (SELECT n FROM pending) AS pendientes,
       (SELECT n_con_edificio FROM pending) AS pendientes_con_edificio,
       CASE WHEN (SELECT total FROM universe) > 0
            THEN round(100.0 * (SELECT n FROM audited)::numeric / (SELECT total FROM universe)::numeric, 1)
            ELSE 0 END AS pct;

GRANT SELECT ON public.v_retro_audit_progress TO authenticated, service_role;