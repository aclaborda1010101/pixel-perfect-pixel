-- Correcciones: paginación real en servidor, archivado automático de obsoletas
-- y separación entre correcciones de datos (1,2,6) y trabajo comercial (4).

ALTER TABLE public.guard_proposals DROP CONSTRAINT IF EXISTS guard_proposals_estado_check;
ALTER TABLE public.guard_proposals ADD CONSTRAINT guard_proposals_estado_check
  CHECK (estado = ANY (ARRAY['pendiente','aprobada','rechazada','aplicada','aprobada_pendiente_aplicacion','obsoleta']));

-- ---------------------------------------------------------------- listado paginado
CREATE OR REPLACE FUNCTION public.correcciones_listado(
  p_guarda smallint,
  p_estado text DEFAULT 'pendiente',
  p_offset integer DEFAULT 0,
  p_limite integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_lim int := least(greatest(coalesce(p_limite, 50), 1), 200);
  v_off int := greatest(coalesce(p_offset, 0), 0);
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'sales_manager')) THEN
    RAISE EXCEPTION 'Sin permisos';
  END IF;

  SELECT count(*) INTO v_total
  FROM public.guard_proposals gp
  WHERE gp.guarda = p_guarda AND gp.estado = p_estado;

  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.creado_at DESC), '[]'::jsonb) INTO v_rows
  FROM (
    SELECT gp.id, gp.guarda, gp.entity_type, gp.entity_id, gp.edificio_id, gp.titulo,
           gp.detalle, gp.propuesta, gp.estado, gp.creado_at, gp.resuelto_at,
           gp.resuelto_por, gp.motivo
    FROM public.guard_proposals gp
    WHERE gp.guarda = p_guarda AND gp.estado = p_estado
    ORDER BY gp.creado_at DESC
    OFFSET v_off LIMIT v_lim
  ) t;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END; $$;

REVOKE ALL ON FUNCTION public.correcciones_listado(smallint, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correcciones_listado(smallint, text, integer, integer) TO authenticated, service_role;

-- ---------------------------------------------------------------- archivado de obsoletas
CREATE OR REPLACE FUNCTION public.archivar_correcciones_obsoletas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE n int := 0;
BEGIN
  WITH obsoletas AS (
    SELECT gp.id
    FROM public.guard_proposals gp
    LEFT JOIN public.buildings b ON b.id = gp.edificio_id
    WHERE gp.estado = 'pendiente'
      AND (
        -- edificio inexistente o descartado: ya no aplica nada
        (gp.edificio_id IS NOT NULL AND (b.id IS NULL OR b.estado = 'descartado'))
        -- guarda 1: el contacto ya tiene estado de ciclo actualizado
        OR (gp.guarda = 1 AND EXISTS (
              SELECT 1 FROM public.owners o
              WHERE o.id = (gp.propuesta->>'owner_id')::uuid
                AND (o.merged_into IS NOT NULL
                     OR (nullif(btrim(coalesce(o.metadatos->>'hs_lead_status','')),'') IS NOT NULL
                         AND o.metadatos->>'hs_lead_status' <> 'No contactado'))))
        -- guarda 2: porcentajes ya verificados o ya cargados por encima del umbral
        OR (gp.guarda = 2 AND (
              coalesce(b.porcentajes_estado,'') IN ('verificado','verificado_pendiente_matching','sin_propietarios')
              OR NOT EXISTS (
                SELECT 1 FROM public.building_owners bo
                WHERE bo.building_id = gp.edificio_id
                GROUP BY bo.building_id
                HAVING count(*) > 0 AND count(bo.cuota)::numeric < count(*)::numeric * 0.5)))
        -- guarda 4: el titular ya tiene acción prevista, ya no consta, o no procede
        OR (gp.guarda = 4 AND (
              NOT EXISTS (
                SELECT 1 FROM public.building_owners bo
                WHERE bo.owner_id = (gp.propuesta->>'owner_id')::uuid
                  AND bo.building_id = gp.edificio_id
                  AND bo.cuota IS NOT NULL)
              OR EXISTS (
                SELECT 1 FROM public.next_actions na
                WHERE na.owner_id = (gp.propuesta->>'owner_id')::uuid AND na.estado = 'pendiente')
              OR EXISTS (
                SELECT 1 FROM public.owners o
                WHERE o.id = (gp.propuesta->>'owner_id')::uuid
                  AND (o.merged_into IS NOT NULL OR coalesce(o.estado_vital,'vivo') = 'fallecido'))
              OR EXISTS (
                SELECT 1 FROM public.building_tasks bt
                WHERE bt.building_id = gp.edificio_id
                  AND bt.status NOT IN ('completed','completada','cancelled','cancelada','skipped','no_procede','superseded'))))
        -- guarda 6: ya hay próxima acción definida o tarea viva
        OR (gp.guarda = 6 AND (
              EXISTS (
                SELECT 1 FROM public.next_actions na
                WHERE na.estado = 'pendiente'
                  AND (na.scope_id = gp.edificio_id
                       OR na.owner_id IN (SELECT bo.owner_id FROM public.building_owners bo WHERE bo.building_id = gp.edificio_id)))
              OR EXISTS (
                SELECT 1 FROM public.building_tasks bt
                WHERE bt.building_id = gp.edificio_id
                  AND bt.status NOT IN ('completed','completada','cancelled','cancelada','skipped','no_procede','superseded'))))
      )
  )
  UPDATE public.guard_proposals gp
     SET estado = 'obsoleta',
         resuelto_at = now(),
         resuelto_por = 'sistema',
         motivo = coalesce(gp.motivo, 'Archivada automáticamente: ya no aplica')
    FROM obsoletas o
   WHERE gp.id = o.id;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.archivar_correcciones_obsoletas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archivar_correcciones_obsoletas() TO authenticated, service_role;

-- ---------------------------------------------------------------- detector: archiva antes de proponer
CREATE OR REPLACE FUNCTION public.detect_guard_proposals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE g1 int; g2 int; g4 int; g6 int; obs int;
BEGIN
  obs := public.archivar_correcciones_obsoletas();
  g1 := public.detect_guarda_1();
  g2 := public.detect_guarda_2();
  g4 := public.detect_guarda_4();
  g6 := public.detect_guarda_6();
  INSERT INTO public.hubspot_sync_log (entity, started_at, finished_at, status, records_upserted, metadatos)
  VALUES ('guardas', now(), now(), 'ok', g1+g2+g4+g6,
          jsonb_build_object('guarda_1',g1,'guarda_2',g2,'guarda_4',g4,'guarda_6',g6,
                             'obsoletas_archivadas',obs,'modo','deteccion'));
  RETURN jsonb_build_object('guarda_1',g1,'guarda_2',g2,'guarda_4',g4,'guarda_6',g6,
                            'obsoletas_archivadas',obs);
END; $$;
