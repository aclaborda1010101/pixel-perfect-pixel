
-- View: HubSpot calls que no se han promovido a public.calls
CREATE OR REPLACE VIEW public.v_hubspot_calls_huerfanas
WITH (security_invoker = on) AS
SELECT
  hc.hs_id,
  hc.hs_timestamp,
  hc.hs_call_direction,
  hc.hs_call_to_number,
  hc.hs_call_from_number,
  hc.associated_contact_ids,
  hc.associated_deal_ids,
  CASE
    WHEN COALESCE(array_length(hc.associated_contact_ids,1),0) = 0
     AND COALESCE(array_length(hc.associated_deal_ids,1),0) = 0
      THEN 'sin_asociaciones'
    WHEN COALESCE(array_length(hc.associated_contact_ids,1),0) > 0
      THEN 'contact_sin_external_id'
    ELSE 'deal_sin_building'
  END AS motivo
FROM public.hubspot_calls hc
LEFT JOIN public.calls c
  ON c.resumen LIKE '[hs:' || hc.hs_id || ']%'
WHERE c.id IS NULL;

GRANT SELECT ON public.v_hubspot_calls_huerfanas TO authenticated, service_role;

-- View: auditoría del cohort 77 (buildings que han pasado por procesamiento)
CREATE OR REPLACE VIEW public.v_cohort77_calls_audit
WITH (security_invoker = on) AS
WITH cohort AS (
  SELECT DISTINCT bps.building_id
  FROM public.building_processing_status bps
),
owners_x_building AS (
  SELECT bo.building_id, bo.owner_id
  FROM public.building_owners bo
  WHERE bo.building_id IN (SELECT building_id FROM cohort)
),
locales AS (
  SELECT ob.building_id,
         COUNT(c.id) AS calls_locales,
         MAX(c.fecha) AS ultima_call_local
  FROM owners_x_building ob
  LEFT JOIN public.calls c ON c.owner_id = ob.owner_id
  GROUP BY ob.building_id
),
hs_via_contact AS (
  SELECT ob.building_id, hc.hs_id, hc.hs_timestamp
  FROM owners_x_building ob
  JOIN public.external_ids ei
    ON ei.entity_type = 'owner' AND ei.provider = 'hubspot'
   AND ei.provider_object_type = 'contact' AND ei.entity_id = ob.owner_id
  JOIN public.hubspot_calls hc
    ON ei.provider_id = ANY(hc.associated_contact_ids)
),
hs_via_deal AS (
  SELECT ei.entity_id AS building_id, hc.hs_id, hc.hs_timestamp
  FROM public.external_ids ei
  JOIN public.hubspot_calls hc ON ei.provider_id = ANY(hc.associated_deal_ids)
  WHERE ei.entity_type = 'building' AND ei.provider = 'hubspot'
    AND ei.provider_object_type = 'deal'
    AND ei.entity_id IN (SELECT building_id FROM cohort)
),
hs_union AS (
  SELECT building_id, hs_id, hs_timestamp FROM hs_via_contact
  UNION
  SELECT building_id, hs_id, hs_timestamp FROM hs_via_deal
),
hs_agg AS (
  SELECT building_id,
         COUNT(DISTINCT hs_id) AS hs_calls_esperadas,
         MAX(hs_timestamp) AS ultima_call_hs
  FROM hs_union
  GROUP BY building_id
),
owners_stats AS (
  SELECT ob.building_id,
         COUNT(DISTINCT ob.owner_id) AS owners_total,
         COUNT(DISTINCT ob.owner_id) FILTER (
           WHERE EXISTS (
             SELECT 1 FROM public.external_ids ei
             WHERE ei.entity_type='owner' AND ei.provider='hubspot'
               AND ei.provider_object_type='contact' AND ei.entity_id=ob.owner_id
           )
         ) AS owners_con_hs
  FROM owners_x_building ob
  GROUP BY ob.building_id
)
SELECT
  c.building_id,
  b.direccion,
  COALESCE(os.owners_total, 0) AS owners_total,
  COALESCE(os.owners_con_hs, 0) AS owners_con_hs,
  COALESCE(l.calls_locales, 0) AS calls_locales,
  COALESCE(h.hs_calls_esperadas, 0) AS hs_calls_esperadas,
  COALESCE(h.hs_calls_esperadas, 0) - COALESCE(l.calls_locales, 0) AS gap,
  l.ultima_call_local,
  h.ultima_call_hs
FROM cohort c
LEFT JOIN public.buildings b ON b.id = c.building_id
LEFT JOIN owners_stats os ON os.building_id = c.building_id
LEFT JOIN locales l ON l.building_id = c.building_id
LEFT JOIN hs_agg h ON h.building_id = c.building_id;

GRANT SELECT ON public.v_cohort77_calls_audit TO authenticated, service_role;
