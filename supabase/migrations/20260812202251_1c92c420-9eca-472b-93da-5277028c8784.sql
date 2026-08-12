
-- 1) Estados ampliados
ALTER TABLE public.guard_proposals DROP CONSTRAINT IF EXISTS guard_proposals_estado_check;
ALTER TABLE public.guard_proposals ADD CONSTRAINT guard_proposals_estado_check
  CHECK (estado = ANY (ARRAY['pendiente','aprobada','rechazada','aplicada','aprobada_pendiente_aplicacion']));
ALTER TABLE public.guard_proposals ADD COLUMN IF NOT EXISTS motivo text;
ALTER TABLE public.guard_proposals ADD COLUMN IF NOT EXISTS aplicada_at timestamptz;
CREATE INDEX IF NOT EXISTS guard_proposals_guarda_entity_idx ON public.guard_proposals (guarda, entity_id);

-- 2) RLS: solo admin y sales_manager
DROP POLICY IF EXISTS guard_proposals_read_auth ON public.guard_proposals;
DROP POLICY IF EXISTS "Admins gestionan propuestas de guardas" ON public.guard_proposals;
CREATE POLICY guard_proposals_manage_staff ON public.guard_proposals
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));

-- 3) Escrituras pendientes de HubSpot (interruptor apagado)
CREATE TABLE IF NOT EXISTS public.hubspot_escrituras_pendientes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad_tipo text NOT NULL,
  entidad_id text NOT NULL,
  campo text NOT NULL,
  valor_propuesto text NOT NULL,
  proposal_id uuid REFERENCES public.guard_proposals(id) ON DELETE SET NULL,
  estado text NOT NULL DEFAULT 'pendiente',
  creado_por text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $fn$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $fn$;

GRANT SELECT ON public.hubspot_escrituras_pendientes TO authenticated;
GRANT ALL ON public.hubspot_escrituras_pendientes TO service_role;
ALTER TABLE public.hubspot_escrituras_pendientes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hep_staff_read ON public.hubspot_escrituras_pendientes;
CREATE POLICY hep_staff_read ON public.hubspot_escrituras_pendientes
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager'));
DROP TRIGGER IF EXISTS trg_hep_updated_at ON public.hubspot_escrituras_pendientes;
CREATE TRIGGER trg_hep_updated_at BEFORE UPDATE ON public.hubspot_escrituras_pendientes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4) Resumen por tipo y estado
CREATE OR REPLACE FUNCTION public.correcciones_resumen()
RETURNS TABLE(guarda smallint, estado text, total bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT gp.guarda, gp.estado, count(*)
  FROM public.guard_proposals gp
  WHERE public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager')
  GROUP BY 1,2
$$;
REVOKE ALL ON FUNCTION public.correcciones_resumen() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correcciones_resumen() TO authenticated;

-- 5) Resolución en bloque
CREATE OR REPLACE FUNCTION public.resolver_correcciones(
  p_accion text,
  p_ids uuid[] DEFAULT NULL,
  p_guarda smallint DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_limite integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor text;
  v_aplicadas int := 0;
  v_pend_aplicacion int := 0;
  v_rechazadas int := 0;
  v_hs int := 0;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager')) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;
  IF p_accion NOT IN ('aprobar','rechazar') THEN
    RAISE EXCEPTION 'Acción no válida';
  END IF;
  IF p_ids IS NULL AND p_guarda IS NULL THEN
    RAISE EXCEPTION 'Indica correcciones o un tipo';
  END IF;

  v_actor := coalesce(auth.jwt()->>'email', auth.uid()::text);

  CREATE TEMP TABLE _sel ON COMMIT DROP AS
    SELECT gp.id, gp.guarda, gp.entity_id, gp.propuesta
    FROM public.guard_proposals gp
    WHERE gp.estado = 'pendiente'
      AND (p_ids IS NULL OR gp.id = ANY(p_ids))
      AND (p_guarda IS NULL OR gp.guarda = p_guarda)
    ORDER BY gp.creado_at DESC
    LIMIT greatest(1, coalesce(p_limite, 5000));

  IF p_accion = 'rechazar' THEN
    UPDATE public.guard_proposals gp
      SET estado='rechazada', resuelto_at=now(), resuelto_por=v_actor, motivo=p_motivo
      FROM _sel s WHERE gp.id = s.id;
    GET DIAGNOSTICS v_rechazadas = ROW_COUNT;
    RETURN jsonb_build_object('accion','rechazar','rechazadas',v_rechazadas);
  END IF;

  -- Aprobación: tipo 1 (contactos con llamada real) tiene aplicador determinista
  UPDATE public.owners o
    SET metadatos = coalesce(o.metadatos,'{}'::jsonb)
      || jsonb_build_object(coalesce(s.propuesta->>'campo','hs_lead_status'), coalesce(s.propuesta->>'valor','Contactado'))
  FROM _sel s
  WHERE s.guarda = 1
    AND o.id = (s.propuesta->>'owner_id')::uuid;

  INSERT INTO public.hubspot_escrituras_pendientes (entidad_tipo, entidad_id, campo, valor_propuesto, proposal_id, creado_por)
  SELECT 'contact', coalesce(s.propuesta->>'hs_contact_id', s.entity_id),
         coalesce(s.propuesta->>'campo','hs_lead_status'),
         coalesce(s.propuesta->>'valor','Contactado'),
         s.id, v_actor
  FROM _sel s WHERE s.guarda = 1;
  GET DIAGNOSTICS v_hs = ROW_COUNT;

  UPDATE public.guard_proposals gp
    SET estado='aplicada', resuelto_at=now(), aplicada_at=now(), resuelto_por=v_actor, motivo=p_motivo
    FROM _sel s WHERE gp.id = s.id AND s.guarda = 1;
  GET DIAGNOSTICS v_aplicadas = ROW_COUNT;

  UPDATE public.guard_proposals gp
    SET estado='aprobada_pendiente_aplicacion', resuelto_at=now(), resuelto_por=v_actor, motivo=p_motivo
    FROM _sel s WHERE gp.id = s.id AND s.guarda <> 1;
  GET DIAGNOSTICS v_pend_aplicacion = ROW_COUNT;

  RETURN jsonb_build_object('accion','aprobar','aplicadas',v_aplicadas,
    'aprobadas_pendientes_aplicacion',v_pend_aplicacion,'escrituras_hubspot_anotadas',v_hs);
END; $$;
REVOKE ALL ON FUNCTION public.resolver_correcciones(text, uuid[], smallint, text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolver_correcciones(text, uuid[], smallint, text, integer) TO authenticated;

-- 6) Antirrebote del detector: no volver a proponer lo ya resuelto
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
  WHERE NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda=1 AND gp.entity_id = cl.hs_contact_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION public.detect_guarda_2()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    AND NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda=2 AND gp.entity_id = b.id::text)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION public.detect_guarda_4()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    AND NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda=4
                    AND gp.entity_id = bo.owner_id::text || ':' || bo.building_id::text)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;

CREATE OR REPLACE FUNCTION public.detect_guarda_6()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    AND NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda=6 AND gp.entity_id = b.id::text)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $function$;
