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
        (gp.edificio_id IS NOT NULL AND (b.id IS NULL OR b.estado = 'descartado'))
        OR (gp.guarda = 1 AND EXISTS (
              SELECT 1 FROM public.owners o
              WHERE o.id = (gp.propuesta->>'owner_id')::uuid
                AND (o.merged_into IS NOT NULL
                     OR (nullif(btrim(coalesce(o.metadatos->>'hs_lead_status','')),'') IS NOT NULL
                         AND o.metadatos->>'hs_lead_status' <> 'No contactado'))))
        OR (gp.guarda = 2 AND (
              coalesce(b.porcentajes_estado,'') IN ('verificado','verificado_pendiente_matching','sin_propietarios')
              OR NOT EXISTS (
                SELECT 1 FROM public.building_owners bo
                WHERE bo.building_id = gp.edificio_id
                GROUP BY bo.building_id
                HAVING count(*) > 0 AND count(bo.cuota)::numeric < count(*)::numeric * 0.5)))
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
                  AND (o.merged_into IS NOT NULL OR coalesce(o.estado_vital,'vivo') = 'fallecido'))))
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