CREATE OR REPLACE FUNCTION public.volcar_titulares_registrales_pendientes(
  p_building_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 2000,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_altas int := 0;
  v_enlazados int := 0;
  v_pendientes int := 0;
  r record;
  v_owner uuid;
BEGIN
  FOR r IN
    WITH tit AS (
      SELECT n.building_id,
             public.norm_person_name(t.nombre_extraido) AS nn,
             min(t.nombre_extraido) AS nombre,
             least(100, sum(coalesce(t.porcentaje, 0))) AS pct,
             array_agg(t.id) AS titular_ids
      FROM public.notas_simples n
      JOIN public.nota_simple_titulares t ON t.nota_simple_id = n.id
      WHERE coalesce(n.status, 'listo') = 'listo'
        AND n.building_id IS NOT NULL
        AND (p_building_id IS NULL OR n.building_id = p_building_id)
        AND length(coalesce(public.norm_person_name(t.nombre_extraido), '')) >= 6
      GROUP BY n.building_id, public.norm_person_name(t.nombre_extraido)
    ), own AS (
      SELECT bo.building_id, public.norm_person_name(o.nombre) AS nn
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id
    )
    SELECT t.* FROM tit t
    LEFT JOIN own w ON w.building_id = t.building_id AND w.nn = t.nn
    WHERE w.nn IS NULL
    ORDER BY t.pct DESC NULLS LAST
    LIMIT greatest(p_limit, 1)
  LOOP
    v_pendientes := v_pendientes + 1;
    IF p_dry_run THEN CONTINUE; END IF;

    v_owner := public.buscar_owner_por_nombre(r.nombre);

    IF v_owner IS NULL THEN
      INSERT INTO public.owners (nombre, rol, notas_breves, metadatos)
      VALUES (
        initcap(lower(btrim(r.nombre))),
        'desconocido'::public.owner_role,
        'Alta desde nota simple (titular registral)',
        jsonb_build_object('origen', 'volcado_titulares_registrales',
                           'nombre_nota', r.nombre, 'at', now())
      )
      RETURNING id INTO v_owner;
      v_altas := v_altas + 1;
    ELSE
      v_enlazados := v_enlazados + 1;
    END IF;

    INSERT INTO public.building_owners (building_id, owner_id, cuota, rol_notas, cuota_estado,
                                        cuota_estado_motivo, cuota_auditada_at, metadatos)
    VALUES (r.building_id, v_owner, nullif(r.pct, 0), 'Titular en nota simple', 'vigente',
            'Volcado desde la nota simple', now(),
            jsonb_build_object('origen', 'volcado_titulares_registrales', 'nombre_nota', r.nombre))
    ON CONFLICT (building_id, owner_id) DO NOTHING;

    UPDATE public.nota_simple_titulares
      SET owner_id = v_owner
      WHERE id = ANY (r.titular_ids) AND owner_id IS NULL AND company_id IS NULL;

    INSERT INTO public.building_relink_audit (entidad, entidad_id, building_origen, building_destino, motivo, evidencia)
    VALUES ('titular_registral', v_owner::text, NULL, r.building_id,
            'Titular que constaba en la nota simple y no estaba cargado como propietario',
            jsonb_build_object('nombre_nota', r.nombre, 'cuota', r.pct, 'titular_ids', r.titular_ids));
  END LOOP;

  RETURN jsonb_build_object('pendientes', v_pendientes, 'altas_nuevas', v_altas,
                            'enlazados_existentes', v_enlazados, 'dry_run', p_dry_run);
END;
$function$;

REVOKE ALL ON FUNCTION public.volcar_titulares_registrales_pendientes(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.volcar_titulares_registrales_pendientes(uuid, integer, boolean) TO service_role;
