CREATE OR REPLACE FUNCTION public.limpiar_propietarios_fantasma(p_dry_run boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  CREATE TEMP TABLE _fantasmas ON COMMIT DROP AS
  SELECT bo.building_id, bo.owner_id, o.nombre, b.direccion
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  JOIN public.buildings b ON b.id = bo.building_id
  WHERE lower(o.nombre) ~ '^(propietario|propietarios|titular|titulares|desconocido|sin nombre)\y'
     OR public.person_merge_key(o.nombre) = public.person_merge_key(b.direccion);

  SELECT count(*) INTO v_n FROM _fantasmas;

  IF NOT p_dry_run THEN
    INSERT INTO public.cotejo_hubspot_incidencias (building_id, tipo, titulo, detalle)
    SELECT f.building_id, 'propietario_fantasma',
           'Registro de propietario sin persona real: ' || f.nombre,
           jsonb_build_object('owner_id', f.owner_id, 'nombre', f.nombre, 'direccion', f.direccion)
      FROM _fantasmas f;

    UPDATE public.owners o
       SET metadatos = COALESCE(o.metadatos,'{}'::jsonb) || jsonb_build_object('fantasma', true, 'fantasma_at', now())
      FROM _fantasmas f WHERE o.id = f.owner_id;

    DELETE FROM public.building_owners bo
     USING _fantasmas f
     WHERE bo.building_id = f.building_id AND bo.owner_id = f.owner_id;
  END IF;

  RETURN jsonb_build_object('dry_run', p_dry_run, 'fantasmas', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.limpiar_propietarios_fantasma(boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.limpiar_propietarios_fantasma(boolean) TO service_role;