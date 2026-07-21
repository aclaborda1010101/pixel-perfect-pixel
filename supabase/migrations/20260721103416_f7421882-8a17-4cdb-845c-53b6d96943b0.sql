
CREATE OR REPLACE VIEW public.v_calls_feed
WITH (security_invoker=on) AS
WITH owner_contacts AS (
  SELECT entity_id AS owner_id, provider_id AS hs_contact_id
  FROM external_ids
  WHERE entity_type='owner' AND provider='hubspot' AND provider_object_type='contact'
),
building_deals AS (
  SELECT entity_id AS building_id, provider_id AS hs_deal_id
  FROM external_ids
  WHERE entity_type='building' AND provider='hubspot' AND provider_object_type='deal'
),
owner_deals AS (
  SELECT DISTINCT bo.owner_id, bd.building_id, bd.hs_deal_id
  FROM building_owners bo
  JOIN building_deals bd ON bd.building_id = bo.building_id
),
attribution AS (
  -- Via existing call_sessions (highest priority: user-confirmed link)
  SELECT cs.hubspot_call_id AS hs_id, cs.owner_id, cs.building_id, 1 AS prio
  FROM call_sessions cs
  WHERE cs.hubspot_call_id IS NOT NULL AND cs.owner_id IS NOT NULL
  UNION ALL
  -- Via associated contact
  SELECT hc.hs_id, oc.owner_id, NULL::uuid AS building_id, 2 AS prio
  FROM hubspot_calls hc
  JOIN owner_contacts oc ON oc.hs_contact_id = ANY (hc.associated_contact_ids)
  UNION ALL
  -- Via deal + phone
  SELECT hc.hs_id, od.owner_id, od.building_id, 3 AS prio
  FROM hubspot_calls hc
  JOIN owner_deals od ON od.hs_deal_id = ANY (hc.associated_deal_ids)
  JOIN owners o ON o.id = od.owner_id
  WHERE public.norm_phone(o.telefono) IS NOT NULL
    AND (public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_to_number)
         OR public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_from_number))
),
best AS (
  SELECT DISTINCT ON (hs_id) hs_id, owner_id, building_id
  FROM attribution
  ORDER BY hs_id, prio ASC
)
SELECT
  hc.hs_id,
  hc.hs_timestamp AS fecha,
  CASE WHEN COALESCE(hc.hs_call_duration,0) > 14400
       THEN ROUND(hc.hs_call_duration::numeric / 1000)::int
       ELSE hc.hs_call_duration END AS duracion_seg,
  LOWER(COALESCE(hc.hs_call_direction,'')) AS direccion,
  hc.hs_call_status AS resultado,
  hc.hs_call_disposition,
  COALESCE(NULLIF(public.strip_html_to_text(hc.hs_call_body),''), hc.hs_call_summary) AS resumen,
  hc.hs_call_transcription,
  (hc.hs_call_recording_url IS NOT NULL AND hc.hs_call_recording_url <> '') AS tiene_grabacion,
  (hc.hs_call_transcription IS NOT NULL AND hc.hs_call_transcription <> '') AS tiene_transcripcion,
  hc.hs_call_status = 'COMPLETED' AS conectada,
  b.owner_id,
  o.nombre AS owner_nombre,
  b.building_id,
  cs.id AS session_id,
  cs.puntuacion,
  cs.estado AS session_estado,
  cs.retroactiva
FROM hubspot_calls hc
LEFT JOIN best b ON b.hs_id = hc.hs_id
LEFT JOIN owners o ON o.id = b.owner_id
LEFT JOIN LATERAL (
  SELECT id, puntuacion, estado, retroactiva
  FROM call_sessions
  WHERE hubspot_call_id = hc.hs_id
  ORDER BY finalizada_at DESC NULLS LAST, created_at DESC
  LIMIT 1
) cs ON true;

GRANT SELECT ON public.v_calls_feed TO authenticated, anon, service_role;

-- Fix Matilde's call attribution (no associated_contact_ids in HubSpot payload)
UPDATE hubspot_calls
SET associated_contact_ids = ARRAY['233105619456']
WHERE hs_id = '112999871408'
  AND (associated_contact_ids IS NULL OR NOT ('233105619456' = ANY(associated_contact_ids)));
