CREATE TABLE public.guard_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guarda smallint NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  edificio_id uuid,
  titulo text NOT NULL,
  detalle text,
  propuesta jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  creado_at timestamptz NOT NULL DEFAULT now(),
  resuelto_at timestamptz,
  resuelto_por text
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guard_proposals TO authenticated;
GRANT ALL ON public.guard_proposals TO service_role;

ALTER TABLE public.guard_proposals ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX guard_proposals_pendiente_uniq
  ON public.guard_proposals (guarda, entity_id)
  WHERE estado = 'pendiente';
CREATE INDEX guard_proposals_guarda_estado_idx ON public.guard_proposals (guarda, estado, creado_at DESC);

CREATE POLICY "Admins gestionan propuestas de guardas"
  ON public.guard_proposals FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR (auth.jwt() ->> 'email') = 'jesus.anzola@afflux.es')
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR (auth.jwt() ->> 'email') = 'jesus.anzola@afflux.es');

CREATE OR REPLACE FUNCTION public.detect_guard_proposals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  g1 int := 0; g2 int := 0; g4 int := 0; g6 int := 0;
BEGIN
  -- GUARDA 1: estado de ciclo desactualizado
  WITH contactos AS (
    SELECT ei.provider_id AS hs_contact_id, o.id AS owner_id, o.nombre
    FROM public.external_ids ei
    JOIN public.owners o ON o.id = ei.entity_id
    WHERE ei.provider = 'hubspot' AND ei.entity_type = 'owner' AND ei.provider_object_type = 'contact'
      AND o.merged_into IS NULL
      AND (
        o.metadatos->>'hs_lead_status' IS NULL
        OR btrim(o.metadatos->>'hs_lead_status') = ''
        OR o.metadatos->>'hs_lead_status' = 'No contactado'
      )
  ), con_llamada AS (
    SELECT c.hs_contact_id, c.owner_id, c.nombre,
           max(hc.hs_timestamp) AS ultima_llamada,
           count(*) AS n_llamadas
    FROM contactos c
    JOIN public.hubspot_calls hc ON c.hs_contact_id = ANY (hc.associated_contact_ids)
    WHERE (coalesce(hc.hs_call_duration, 0) >= 30000 OR nullif(btrim(coalesce(hc.hs_call_body, '')), '') IS NOT NULL)
    GROUP BY 1, 2, 3
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, titulo, detalle, propuesta)
  SELECT 1, 'hubspot_contact', cl.hs_contact_id,
         coalesce(cl.nombre, 'Contacto ' || cl.hs_contact_id) || ' · estado de ciclo desactualizado',
         format('%s llamada(s) real(es), última el %s. Estado actual sin contactar.',
                cl.n_llamadas, coalesce(to_char(cl.ultima_llamada, 'DD/MM/YYYY'), 'fecha desconocida')),
         jsonb_build_object('accion','patch_contact','campo','hs_lead_status','valor','Contactado',
                            'hs_contact_id', cl.hs_contact_id, 'owner_id', cl.owner_id)
  FROM con_llamada cl
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS g1 = ROW_COUNT;

  -- GUARDA 2: % de participación sin cargar
  WITH agg AS (
    SELECT bo.building_id,
           count(*) AS total,
           count(bo.cuota) AS con_cuota
    FROM public.building_owners bo
    GROUP BY 1
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 2, 'building', b.id::text, b.id,
         coalesce(b.direccion, 'Edificio ' || b.id::text) || ' · porcentajes sin cargar',
         format('%s de %s titulares con cuota. %s',
                a.con_cuota, a.total,
                CASE WHEN EXISTS (SELECT 1 FROM public.notas_simples ns WHERE ns.building_id = b.id)
                     THEN 'Hay nota simple atada: el dato existe pero no cuadra.'
                     ELSE 'Sin nota simple atada: conseguir nota.' END),
         jsonb_build_object('accion', CASE WHEN EXISTS (SELECT 1 FROM public.notas_simples ns WHERE ns.building_id = b.id)
                                           THEN 'revisar_nota' ELSE 'conseguir_nota' END,
                            'con_cuota', a.con_cuota, 'total', a.total)
  FROM agg a
  JOIN public.buildings b ON b.id = a.building_id
  WHERE a.total > 0 AND a.con_cuota::numeric < a.total::numeric * 0.5
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS g2 = ROW_COUNT;

  -- GUARDA 4: titular con cuota sin tarea
  WITH titulares AS (
    SELECT bo.owner_id, bo.building_id, bo.cuota, o.nombre, b.direccion
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
    JOIN public.buildings b ON b.id = bo.building_id
    WHERE bo.cuota IS NOT NULL
      AND coalesce(o.estado_vital, 'vivo') <> 'fallecido'
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 4, 'building_owner', t.owner_id::text || ':' || t.building_id::text, t.building_id,
         coalesce(t.nombre, 'Titular') || ' · titular con cuota sin tarea',
         format('Cuota %s%% en %s y sin próxima acción ni tarea abierta en HubSpot.',
                round(t.cuota::numeric, 2), coalesce(t.direccion, 'edificio sin dirección')),
         jsonb_build_object('accion','crear_tarea','owner_id', t.owner_id, 'building_id', t.building_id, 'cuota', t.cuota)
  FROM titulares t
  WHERE NOT EXISTS (
      SELECT 1 FROM public.next_actions na
      WHERE na.owner_id = t.owner_id AND na.estado = 'pendiente'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.external_ids ei
      JOIN public.hubspot_tasks ht ON ei.provider_id = ANY (ht.associated_contact_ids)
      WHERE ei.provider = 'hubspot' AND ei.entity_type = 'owner' AND ei.provider_object_type = 'contact'
        AND ei.entity_id = t.owner_id
        AND ht.hs_task_status = 'NOT_STARTED'
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS g4 = ROW_COUNT;

  -- GUARDA 6: operación viva sin próxima acción
  WITH contactos_edificio AS (
    SELECT bo.building_id, ei.provider_id AS hs_contact_id
    FROM public.building_owners bo
    JOIN public.external_ids ei ON ei.entity_id = bo.owner_id
      AND ei.provider = 'hubspot' AND ei.entity_type = 'owner' AND ei.provider_object_type = 'contact'
  ), deals_edificio AS (
    SELECT ei.entity_id AS building_id, ei.provider_id AS hs_deal_id
    FROM public.external_ids ei
    WHERE ei.provider = 'hubspot' AND ei.entity_type = 'building' AND ei.provider_object_type = 'deal'
  ), llamadas AS (
    SELECT ce.building_id, max(hc.hs_timestamp) AS ultima
    FROM contactos_edificio ce
    JOIN public.hubspot_calls hc ON ce.hs_contact_id = ANY (hc.associated_contact_ids)
    WHERE hc.hs_timestamp >= now() - interval '60 days'
    GROUP BY 1
    UNION ALL
    SELECT de.building_id, max(hc.hs_timestamp)
    FROM deals_edificio de
    JOIN public.hubspot_calls hc ON de.hs_deal_id = ANY (hc.associated_deal_ids)
    WHERE hc.hs_timestamp >= now() - interval '60 days'
    GROUP BY 1
  ), vivos AS (
    SELECT building_id, max(ultima) AS ultima FROM llamadas GROUP BY 1
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 6, 'building', b.id::text, b.id,
         coalesce(b.direccion, 'Edificio ' || b.id::text) || ' · operación viva sin próxima acción',
         format('Última llamada el %s y sin próxima acción pendiente ni tarea abierta en HubSpot.',
                to_char(v.ultima, 'DD/MM/YYYY')),
         jsonb_build_object('accion','definir_proxima_accion','building_id', b.id, 'ultima_llamada', v.ultima)
  FROM vivos v
  JOIN public.buildings b ON b.id = v.building_id
  WHERE NOT EXISTS (
      SELECT 1 FROM public.next_actions na
      WHERE na.estado = 'pendiente'
        AND (na.scope_id = b.id OR na.owner_id IN (SELECT bo.owner_id FROM public.building_owners bo WHERE bo.building_id = b.id))
    )
    AND NOT EXISTS (
      SELECT 1 FROM contactos_edificio ce
      JOIN public.hubspot_tasks ht ON ce.hs_contact_id = ANY (ht.associated_contact_ids)
      WHERE ce.building_id = b.id AND ht.hs_task_status = 'NOT_STARTED'
    )
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS g6 = ROW_COUNT;

  INSERT INTO public.hubspot_sync_log (entity, started_at, finished_at, status, records_upserted, metadatos)
  VALUES ('guardas', now(), now(), 'ok', g1 + g2 + g4 + g6,
          jsonb_build_object('guarda_1', g1, 'guarda_2', g2, 'guarda_4', g4, 'guarda_6', g6, 'modo', 'deteccion'));

  RETURN jsonb_build_object('guarda_1', g1, 'guarda_2', g2, 'guarda_4', g4, 'guarda_6', g6);
END;
$$;

REVOKE ALL ON FUNCTION public.detect_guard_proposals() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_guard_proposals() TO service_role;