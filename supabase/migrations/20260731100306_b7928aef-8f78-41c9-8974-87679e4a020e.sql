CREATE INDEX IF NOT EXISTS hubspot_calls_contacts_gin ON public.hubspot_calls USING gin (associated_contact_ids);
CREATE INDEX IF NOT EXISTS hubspot_calls_deals_gin ON public.hubspot_calls USING gin (associated_deal_ids);
CREATE INDEX IF NOT EXISTS hubspot_tasks_contacts_gin ON public.hubspot_tasks USING gin (associated_contact_ids);
CREATE INDEX IF NOT EXISTS next_actions_owner_estado_idx ON public.next_actions (owner_id, estado);
CREATE INDEX IF NOT EXISTS next_actions_scope_estado_idx ON public.next_actions (scope_id, estado);
CREATE INDEX IF NOT EXISTS external_ids_owner_contact_idx ON public.external_ids (entity_id) WHERE provider = 'hubspot' AND entity_type = 'owner' AND provider_object_type = 'contact';

CREATE OR REPLACE FUNCTION public.detect_guarda_1()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    WHERE (coalesce(hc.hs_call_duration,0) >= 30000 OR nullif(btrim(coalesce(hc.hs_call_body,'')),'') IS NOT NULL)
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
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.detect_guarda_2()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0;
BEGIN
  WITH agg AS (
    SELECT bo.building_id, count(*) AS total, count(bo.cuota) AS con_cuota
    FROM public.building_owners bo GROUP BY 1
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 2, 'building', b.id::text, b.id,
         coalesce(b.direccion, 'Edificio ' || b.id::text) || ' · porcentajes sin cargar',
         format('%s de %s titulares con cuota. %s', a.con_cuota, a.total,
                CASE WHEN EXISTS (SELECT 1 FROM public.notas_simples ns WHERE ns.building_id = b.id)
                     THEN 'Hay nota simple atada: el dato existe pero no cuadra.'
                     ELSE 'Sin nota simple atada: conseguir nota.' END),
         jsonb_build_object('accion', CASE WHEN EXISTS (SELECT 1 FROM public.notas_simples ns WHERE ns.building_id = b.id)
                                           THEN 'revisar_nota' ELSE 'conseguir_nota' END,
                            'con_cuota', a.con_cuota, 'total', a.total)
  FROM agg a JOIN public.buildings b ON b.id = a.building_id
  WHERE a.total > 0 AND a.con_cuota::numeric < a.total::numeric * 0.5
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.detect_guarda_4()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0;
BEGIN
  CREATE TEMP TABLE _g4_tareas ON COMMIT DROP AS
    SELECT DISTINCT ei.entity_id AS owner_id
    FROM public.hubspot_tasks ht
    JOIN LATERAL unnest(ht.associated_contact_ids) AS cid ON true
    JOIN public.external_ids ei ON ei.provider_id = cid
      AND ei.provider='hubspot' AND ei.entity_type='owner' AND ei.provider_object_type='contact'
    WHERE ht.hs_task_status = 'NOT_STARTED';

  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 4, 'building_owner', bo.owner_id::text || ':' || bo.building_id::text, bo.building_id,
         coalesce(o.nombre, 'Titular') || ' · titular con cuota sin tarea',
         format('Cuota %s%% en %s y sin próxima acción ni tarea abierta en HubSpot.',
                round(bo.cuota::numeric, 2), coalesce(b.direccion, 'edificio sin dirección')),
         jsonb_build_object('accion','crear_tarea','owner_id', bo.owner_id, 'building_id', bo.building_id, 'cuota', bo.cuota)
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  JOIN public.buildings b ON b.id = bo.building_id
  WHERE bo.cuota IS NOT NULL
    AND coalesce(o.estado_vital, 'vivo') <> 'fallecido'
    AND NOT EXISTS (SELECT 1 FROM public.next_actions na WHERE na.owner_id = bo.owner_id AND na.estado = 'pendiente')
    AND NOT EXISTS (SELECT 1 FROM _g4_tareas t WHERE t.owner_id = bo.owner_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.detect_guarda_6()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0;
BEGIN
  CREATE TEMP TABLE _g6_ce ON COMMIT DROP AS
    SELECT DISTINCT bo.building_id, ei.provider_id AS hs_contact_id
    FROM public.building_owners bo
    JOIN public.external_ids ei ON ei.entity_id = bo.owner_id
      AND ei.provider='hubspot' AND ei.entity_type='owner' AND ei.provider_object_type='contact';
  CREATE INDEX ON _g6_ce (hs_contact_id);
  CREATE INDEX ON _g6_ce (building_id);

  CREATE TEMP TABLE _g6_vivos ON COMMIT DROP AS
    SELECT building_id, max(ultima) AS ultima FROM (
      SELECT ce.building_id, max(hc.hs_timestamp) AS ultima
      FROM public.hubspot_calls hc
      JOIN LATERAL unnest(hc.associated_contact_ids) AS cid ON true
      JOIN _g6_ce ce ON ce.hs_contact_id = cid
      WHERE hc.hs_timestamp >= now() - interval '60 days'
      GROUP BY 1
      UNION ALL
      SELECT ei.entity_id, max(hc.hs_timestamp)
      FROM public.hubspot_calls hc
      JOIN LATERAL unnest(hc.associated_deal_ids) AS did ON true
      JOIN public.external_ids ei ON ei.provider_id = did
        AND ei.provider='hubspot' AND ei.entity_type='building' AND ei.provider_object_type='deal'
      WHERE hc.hs_timestamp >= now() - interval '60 days'
      GROUP BY 1
    ) s GROUP BY 1;

  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 6, 'building', b.id::text, b.id,
         coalesce(b.direccion, 'Edificio ' || b.id::text) || ' · operación viva sin próxima acción',
         format('Última llamada el %s y sin próxima acción pendiente ni tarea abierta en HubSpot.',
                to_char(v.ultima, 'DD/MM/YYYY')),
         jsonb_build_object('accion','definir_proxima_accion','building_id', b.id, 'ultima_llamada', v.ultima)
  FROM _g6_vivos v
  JOIN public.buildings b ON b.id = v.building_id
  WHERE NOT EXISTS (
      SELECT 1 FROM public.next_actions na
      WHERE na.estado='pendiente'
        AND (na.scope_id = b.id OR na.owner_id IN (SELECT bo.owner_id FROM public.building_owners bo WHERE bo.building_id = b.id)))
    AND NOT EXISTS (
      SELECT 1 FROM _g6_ce ce
      JOIN public.hubspot_tasks ht ON ce.hs_contact_id = ANY (ht.associated_contact_ids)
      WHERE ce.building_id = b.id AND ht.hs_task_status='NOT_STARTED')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

CREATE OR REPLACE FUNCTION public.detect_guard_proposals()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g1 int; g2 int; g4 int; g6 int;
BEGIN
  g1 := public.detect_guarda_1();
  g2 := public.detect_guarda_2();
  g4 := public.detect_guarda_4();
  g6 := public.detect_guarda_6();
  INSERT INTO public.hubspot_sync_log (entity, started_at, finished_at, status, records_upserted, metadatos)
  VALUES ('guardas', now(), now(), 'ok', g1+g2+g4+g6,
          jsonb_build_object('guarda_1',g1,'guarda_2',g2,'guarda_4',g4,'guarda_6',g6,'modo','deteccion'));
  RETURN jsonb_build_object('guarda_1',g1,'guarda_2',g2,'guarda_4',g4,'guarda_6',g6);
END; $$;

REVOKE ALL ON FUNCTION public.detect_guarda_1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_guarda_2() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_guarda_4() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.detect_guarda_6() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_guarda_1() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_guarda_2() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_guarda_4() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_guarda_6() TO service_role;