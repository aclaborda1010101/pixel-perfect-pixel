
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

  DROP TABLE IF EXISTS _sel;
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
