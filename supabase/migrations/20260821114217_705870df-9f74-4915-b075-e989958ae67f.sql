CREATE OR REPLACE FUNCTION public.hs_disposition_conectada(p_disposition text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public AS $$
  SELECT COALESCE(p_disposition, '') = ANY (ARRAY[
    'f240bbac-87c9-4f6e-bf70-924b57d47db7',
    '55428849-9fbc-4038-92d6-7c4f2b850974',
    '371c7887-c871-4c38-b0e7-77bafc4de124',
    'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'
  ])
$$;
REVOKE ALL ON FUNCTION public.hs_disposition_conectada(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hs_disposition_conectada(text) TO authenticated, service_role;

CREATE OR REPLACE VIEW public.v_owner_calls_enriched AS
 WITH owner_contacts AS (
         SELECT external_ids.entity_id AS owner_id,
            external_ids.provider_id AS hs_contact_id
           FROM external_ids
          WHERE external_ids.entity_type = 'owner'::text AND external_ids.provider = 'hubspot'::text AND external_ids.provider_object_type = 'contact'::text
        ), building_deals AS (
         SELECT external_ids.entity_id AS building_id,
            external_ids.provider_id AS hs_deal_id
           FROM external_ids
          WHERE external_ids.entity_type = 'building'::text AND external_ids.provider = 'hubspot'::text AND external_ids.provider_object_type = 'deal'::text
        ), owner_deals AS (
         SELECT DISTINCT bo.owner_id,
            bd.building_id,
            bd.hs_deal_id
           FROM building_owners bo
             JOIN building_deals bd ON bd.building_id = bo.building_id
        ), via_contact AS (
         SELECT DISTINCT oc.owner_id,
            hc_1.hs_id
           FROM hubspot_calls hc_1
             JOIN owner_contacts oc ON oc.hs_contact_id = ANY (hc_1.associated_contact_ids)
        ), via_deal_phone AS (
         SELECT DISTINCT od.owner_id,
            hc_1.hs_id
           FROM hubspot_calls hc_1
             JOIN owner_deals od ON od.hs_deal_id = ANY (hc_1.associated_deal_ids)
             JOIN owners o ON o.id = od.owner_id
          WHERE norm_phone(o.telefono) IS NOT NULL AND (norm_phone(o.telefono) = norm_phone(hc_1.hs_call_to_number) OR norm_phone(o.telefono) = norm_phone(hc_1.hs_call_from_number)) AND NOT (EXISTS ( SELECT 1
                   FROM via_contact vc
                  WHERE vc.hs_id = hc_1.hs_id AND vc.owner_id = od.owner_id))
        ), owner_calls AS (
         SELECT via_contact.owner_id, via_contact.hs_id FROM via_contact
        UNION
         SELECT via_deal_phone.owner_id, via_deal_phone.hs_id FROM via_deal_phone
        ), owner_bldg_agg AS (
         SELECT building_owners.owner_id,
            count(DISTINCT building_owners.building_id) AS n_bldgs,
            (array_agg(DISTINCT building_owners.building_id))[1] AS solo_building_id
           FROM building_owners
          GROUP BY building_owners.owner_id
        ), attrib AS (
         SELECT oc.owner_id,
            oc.hs_id,
            COALESCE(( SELECT ov.building_id
                   FROM owner_call_building_assignment ov
                  WHERE ov.hs_id = oc.hs_id AND ov.owner_id = oc.owner_id
                 LIMIT 1), ( SELECT od.building_id
                   FROM owner_deals od
                     JOIN hubspot_calls hc2 ON hc2.hs_id = oc.hs_id
                  WHERE od.owner_id = oc.owner_id AND (od.hs_deal_id = ANY (hc2.associated_deal_ids))
                 LIMIT 1), ( SELECT obc.solo_building_id
                   FROM owner_bldg_agg obc
                  WHERE obc.owner_id = oc.owner_id AND obc.n_bldgs = 1)) AS building_id
           FROM owner_calls oc
        )
 SELECT a.owner_id,
    hc.hs_id,
    hc.hs_timestamp,
    hc.hs_call_direction AS direccion,
        CASE hc.hs_call_disposition
            WHEN 'f240bbac-87c9-4f6e-bf70-924b57d47db7'::text THEN 'Conectado'::text
            WHEN '55428849-9fbc-4038-92d6-7c4f2b850974'::text THEN 'Conectado seguimiento'::text
            WHEN '371c7887-c871-4c38-b0e7-77bafc4de124'::text THEN 'Conectado'::text
            WHEN 'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'::text THEN 'Conectado'::text
            WHEN '73a0d17f-1163-4015-bdd5-ec830791da20'::text THEN 'Sin respuesta'::text
            WHEN '17b47fee-58de-441e-a44c-c6300d46f273'::text THEN 'Número equivocado'::text
            WHEN '9d9162e7-6cf3-4944-bf63-4dff82258764'::text THEN 'Ocupado'::text
            WHEN 'b2cf5968-551e-4856-9783-52b3da59a7d0'::text THEN 'Buzón de voz'::text
            WHEN 'a4c4c377-d246-4b32-a13b-75a56a4cd0ff'::text THEN 'Mensaje en vivo'::text
            ELSE 'Sin resultado'::text
        END AS resultado,
    round(COALESCE(hc.hs_call_duration, 0)::numeric / 1000.0)::integer AS duracion_seg,
    strip_html_to_text(hc.hs_call_body) AS nota,
    strip_html_to_text(hc.hs_call_summary) AS resumen_ia,
    COALESCE(hc.hs_call_recording_url, ''::text) <> ''::text AS tiene_grabacion,
    a.building_id,
    a.building_id IS NULL AS sin_edificio,
    public.hs_disposition_conectada(hc.hs_call_disposition) AS conectada,
    public.hs_disposition_conectada(hc.hs_call_disposition) AND COALESCE(hc.hs_call_duration, 0) >= 30000 AS conversacion_sustancial
   FROM attrib a
     JOIN hubspot_calls hc ON hc.hs_id = a.hs_id;

CREATE OR REPLACE VIEW public.v_owner_call_stats AS
 SELECT owner_id,
    count(*)::integer AS intentos_totales,
    count(*) FILTER (WHERE conectada)::integer AS veces_conectado,
    count(*) FILTER (WHERE direccion = 'OUTBOUND'::text)::integer AS salientes,
    count(*) FILTER (WHERE direccion = 'INBOUND'::text)::integer AS entrantes,
    max(hs_timestamp) AS ultima_llamada,
    max(hs_timestamp) FILTER (WHERE conectada) AS ultima_vez_conectado,
    CURRENT_DATE - max(hs_timestamp)::date AS dias_desde_ultima_llamada,
    count(*) FILTER (WHERE sin_edificio)::integer AS llamadas_sin_edificio,
    count(*) FILTER (WHERE conversacion_sustancial)::integer AS conversaciones_sustanciales,
    max(hs_timestamp) FILTER (WHERE conversacion_sustancial) AS ultima_conversacion_sustancial
   FROM v_owner_calls_enriched
  GROUP BY owner_id;

CREATE OR REPLACE FUNCTION public.detect_guarda_1()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE n int := 0;
BEGIN
  WITH contactos AS (
    SELECT ei.provider_id AS hs_contact_id, o.id AS owner_id, o.nombre
    FROM public.external_ids ei
    JOIN public.owners o ON o.id = ei.entity_id
    WHERE ei.provider='hubspot' AND ei.entity_type='owner' AND ei.provider_object_type='contact'
      AND o.merged_into IS NULL
      AND (o.metadatos->>'hs_lead_status' IS NULL OR btrim(o.metadatos->>'hs_lead_status')='' OR o.metadatos->>'hs_lead_status'='No contactado')
  ), con_llamada AS (
    SELECT c.hs_contact_id, min(c.owner_id::text) AS owner_id, min(c.nombre) AS nombre,
           max(hc.hs_timestamp) AS ultima_llamada, count(*) AS n_llamadas
    FROM contactos c
    JOIN public.hubspot_calls hc ON c.hs_contact_id = ANY (hc.associated_contact_ids)
    WHERE public.hs_disposition_conectada(hc.hs_call_disposition)
       OR nullif(btrim(coalesce(hc.hs_call_body,'')),'') IS NOT NULL
    GROUP BY 1
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, titulo, detalle, propuesta)
  SELECT 1, 'hubspot_contact', cl.hs_contact_id,
         coalesce(cl.nombre, 'Contacto ' || cl.hs_contact_id) || ' · estado de ciclo desactualizado',
         format('%s llamada(s) real(es), última el %s. Estado actual sin contactar.',
                cl.n_llamadas, coalesce(to_char(cl.ultima_llamada,'DD/MM/YYYY'),'fecha desconocida')),
         jsonb_build_object('accion','patch_contact','campo','hs_lead_status','valor','Contactado',
                            'hs_contact_id', cl.hs_contact_id, 'owner_id', cl.owner_id)
  FROM con_llamada cl
  WHERE NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda=1 AND gp.entity_id = cl.hs_contact_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;