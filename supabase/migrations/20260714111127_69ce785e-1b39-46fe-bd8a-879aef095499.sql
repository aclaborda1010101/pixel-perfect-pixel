
CREATE OR REPLACE FUNCTION public.norm_phone(t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(regexp_replace(COALESCE(t,''), '\D','','g'), '^34',''), '');
$$;

CREATE TABLE IF NOT EXISTS public.owner_call_building_assignment (
  hs_id text NOT NULL,
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  assigned_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hs_id, owner_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_call_building_assignment TO authenticated;
GRANT ALL ON public.owner_call_building_assignment TO service_role;
ALTER TABLE public.owner_call_building_assignment ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ocba_read" ON public.owner_call_building_assignment;
DROP POLICY IF EXISTS "ocba_write" ON public.owner_call_building_assignment;
CREATE POLICY "ocba_read" ON public.owner_call_building_assignment FOR SELECT TO authenticated USING (true);
CREATE POLICY "ocba_write" ON public.owner_call_building_assignment FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP VIEW IF EXISTS public.v_owner_call_stats;
DROP VIEW IF EXISTS public.v_owner_calls_enriched;
DROP VIEW IF EXISTS public.v_building_calls;

CREATE VIEW public.v_owner_calls_enriched AS
WITH
owner_contacts AS (
  SELECT entity_id AS owner_id, provider_id AS hs_contact_id
  FROM public.external_ids
  WHERE entity_type='owner' AND provider='hubspot' AND provider_object_type='contact'
),
building_deals AS (
  SELECT entity_id AS building_id, provider_id AS hs_deal_id
  FROM public.external_ids
  WHERE entity_type='building' AND provider='hubspot' AND provider_object_type='deal'
),
owner_deals AS (
  SELECT DISTINCT bo.owner_id, bd.building_id, bd.hs_deal_id
  FROM public.building_owners bo
  JOIN building_deals bd ON bd.building_id = bo.building_id
),
via_contact AS (
  SELECT DISTINCT oc.owner_id, hc.hs_id
  FROM public.hubspot_calls hc
  JOIN owner_contacts oc ON oc.hs_contact_id = ANY(hc.associated_contact_ids)
),
via_deal_phone AS (
  SELECT DISTINCT od.owner_id, hc.hs_id
  FROM public.hubspot_calls hc
  JOIN owner_deals od ON od.hs_deal_id = ANY(hc.associated_deal_ids)
  JOIN public.owners o ON o.id = od.owner_id
  WHERE public.norm_phone(o.telefono) IS NOT NULL
    AND (
      public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_to_number)
      OR public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_from_number)
    )
    AND NOT EXISTS (
      SELECT 1 FROM via_contact vc WHERE vc.hs_id = hc.hs_id AND vc.owner_id = od.owner_id
    )
),
owner_calls AS (
  SELECT owner_id, hs_id FROM via_contact
  UNION
  SELECT owner_id, hs_id FROM via_deal_phone
),
owner_bldg_agg AS (
  SELECT owner_id,
         COUNT(DISTINCT building_id) AS n_bldgs,
         (ARRAY_AGG(DISTINCT building_id))[1] AS solo_building_id
  FROM public.building_owners
  GROUP BY owner_id
),
attrib AS (
  SELECT
    oc.owner_id,
    oc.hs_id,
    COALESCE(
      (SELECT ov.building_id FROM public.owner_call_building_assignment ov
        WHERE ov.hs_id = oc.hs_id AND ov.owner_id = oc.owner_id LIMIT 1),
      (SELECT od.building_id
        FROM owner_deals od
        JOIN public.hubspot_calls hc2 ON hc2.hs_id = oc.hs_id
        WHERE od.owner_id = oc.owner_id
          AND od.hs_deal_id = ANY(hc2.associated_deal_ids)
        LIMIT 1),
      (SELECT obc.solo_building_id FROM owner_bldg_agg obc
        WHERE obc.owner_id = oc.owner_id AND obc.n_bldgs = 1)
    ) AS building_id
  FROM owner_calls oc
)
SELECT
  a.owner_id,
  hc.hs_id,
  hc.hs_timestamp,
  hc.hs_call_direction AS direccion,
  CASE hc.hs_call_disposition
    WHEN 'f240bbac-87c9-4f6e-bf70-924b57d47db7' THEN 'Conectado'
    WHEN '55428849-9fbc-4038-92d6-7c4f2b850974' THEN 'Conectado seguimiento'
    WHEN '371c7887-c871-4c38-b0e7-77bafc4de124' THEN 'Conectado'
    WHEN 'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7' THEN 'Conectado'
    WHEN '73a0d17f-1163-4015-bdd5-ec830791da20' THEN 'Sin respuesta'
    WHEN '17b47fee-58de-441e-a44c-c6300d46f273' THEN 'Número equivocado'
    WHEN '9d9162e7-6cf3-4944-bf63-4dff82258764' THEN 'Ocupado'
    WHEN 'b2cf5968-551e-4856-9783-52b3da59a7d0' THEN 'Buzón de voz'
    WHEN 'a4c4c377-d246-4b32-a13b-75a56a4cd0ff' THEN 'Mensaje en vivo'
    ELSE 'Sin resultado'
  END AS resultado,
  ROUND(COALESCE(hc.hs_call_duration, 0)::numeric / 1000.0)::integer AS duracion_seg,
  hc.hs_call_body AS nota,
  (COALESCE(hc.hs_call_recording_url, '') <> '') AS tiene_grabacion,
  a.building_id,
  (a.building_id IS NULL) AS sin_edificio,
  (
    hc.hs_call_disposition IN (
      'f240bbac-87c9-4f6e-bf70-924b57d47db7',
      '55428849-9fbc-4038-92d6-7c4f2b850974',
      '371c7887-c871-4c38-b0e7-77bafc4de124',
      'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'
    ) AND COALESCE(hc.hs_call_duration, 0) >= 30000
  ) AS conectada
FROM attrib a
JOIN public.hubspot_calls hc ON hc.hs_id = a.hs_id;

CREATE VIEW public.v_owner_call_stats AS
SELECT
  owner_id,
  COUNT(*)::int AS intentos_totales,
  COUNT(*) FILTER (WHERE conectada)::int AS veces_conectado,
  COUNT(*) FILTER (WHERE direccion = 'OUTBOUND')::int AS salientes,
  COUNT(*) FILTER (WHERE direccion = 'INBOUND')::int AS entrantes,
  MAX(hs_timestamp) AS ultima_llamada,
  MAX(hs_timestamp) FILTER (WHERE conectada) AS ultima_vez_conectado,
  (CURRENT_DATE - MAX(hs_timestamp)::date) AS dias_desde_ultima_llamada,
  COUNT(*) FILTER (WHERE sin_edificio)::int AS llamadas_sin_edificio
FROM public.v_owner_calls_enriched
GROUP BY owner_id;

CREATE VIEW public.v_building_calls AS
WITH
building_deals AS (
  SELECT entity_id AS building_id, provider_id AS hs_deal_id
  FROM public.external_ids
  WHERE entity_type='building' AND provider='hubspot' AND provider_object_type='deal'
),
owner_contacts AS (
  SELECT entity_id AS owner_id, provider_id AS hs_contact_id
  FROM public.external_ids
  WHERE entity_type='owner' AND provider='hubspot' AND provider_object_type='contact'
)
SELECT DISTINCT
  bd.building_id,
  hc.hs_id,
  hc.hs_timestamp,
  hc.hs_call_direction AS direccion,
  ROUND(COALESCE(hc.hs_call_duration, 0)::numeric / 1000.0)::integer AS duracion_seg,
  hc.hs_call_body AS nota,
  (COALESCE(hc.hs_call_recording_url, '') <> '') AS tiene_grabacion,
  COALESCE(
    (SELECT bo.owner_id
       FROM public.building_owners bo
       JOIN owner_contacts oc ON oc.owner_id = bo.owner_id
      WHERE bo.building_id = bd.building_id
        AND oc.hs_contact_id = ANY(hc.associated_contact_ids)
      LIMIT 1),
    (SELECT bo.owner_id
       FROM public.building_owners bo
       JOIN public.owners o ON o.id = bo.owner_id
      WHERE bo.building_id = bd.building_id
        AND public.norm_phone(o.telefono) IS NOT NULL
        AND (
          public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_to_number)
          OR public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_from_number)
        )
      LIMIT 1)
  ) AS owner_id
FROM public.hubspot_calls hc
JOIN building_deals bd ON bd.hs_deal_id = ANY(hc.associated_deal_ids);

GRANT SELECT ON public.v_owner_calls_enriched TO authenticated, anon;
GRANT SELECT ON public.v_owner_call_stats TO authenticated, anon;
GRANT SELECT ON public.v_building_calls TO authenticated, anon;
