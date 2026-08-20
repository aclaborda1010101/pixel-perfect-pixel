CREATE OR REPLACE FUNCTION public.enlazar_titulares_con_contactos(
  p_building_id uuid DEFAULT NULL,
  p_limit int DEFAULT 5000,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_enlazados int := 0;
  v_dudosos int := 0;
  r record;
  c_exacto uuid;
  n_exacto int;
  c_aprox uuid;
  n_aprox int;
BEGIN
  FOR r IN
    SELECT t.id, t.nombre_extraido, t.porcentaje, n.building_id,
           public.norm_person_name(t.nombre_extraido) AS nn
    FROM public.nota_simple_titulares t
    JOIN public.notas_simples n ON n.id = t.nota_simple_id
    WHERE t.owner_id IS NULL AND t.company_id IS NULL
      AND n.building_id IS NOT NULL
      AND coalesce(n.status, 'listo') = 'listo'
      AND (p_building_id IS NULL OR n.building_id = p_building_id)
    ORDER BY t.porcentaje DESC NULLS LAST
    LIMIT greatest(p_limit, 1)
  LOOP
    IF r.nn IS NULL OR length(r.nn) < 6 THEN CONTINUE; END IF;

    SELECT count(*), min(cand.owner_id::text)::uuid INTO n_exacto, c_exacto
    FROM (
      SELECT DISTINCT bo.owner_id
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
      JOIN public.external_ids ei ON ei.entity_type = 'owner' AND ei.entity_id = o.id
        AND ei.provider = 'hubspot' AND ei.provider_object_type = 'contact'
      WHERE bo.building_id = r.building_id
        AND public.norm_person_name(o.nombre) = r.nn
    ) cand;

    IF n_exacto = 1 THEN
      IF NOT p_dry_run THEN
        UPDATE public.nota_simple_titulares
        SET owner_id = c_exacto,
            metadatos = coalesce(metadatos, '{}'::jsonb)
              || jsonb_build_object('enlace_hubspot', jsonb_build_object('modo', 'exacto', 'at', now()))
        WHERE id = r.id;
      END IF;
      v_enlazados := v_enlazados + 1;
      CONTINUE;
    END IF;

    SELECT count(*), min(cand.owner_id::text)::uuid INTO n_aprox, c_aprox
    FROM (
      SELECT DISTINCT bo.owner_id
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
      JOIN public.external_ids ei ON ei.entity_type = 'owner' AND ei.entity_id = o.id
        AND ei.provider = 'hubspot' AND ei.provider_object_type = 'contact'
      WHERE bo.building_id = r.building_id
        AND length(public.norm_person_name(o.nombre)) >= 6
        AND levenshtein(public.norm_person_name(o.nombre), r.nn) <= 2
    ) cand;

    IF n_aprox = 1 AND n_exacto = 0 THEN
      IF NOT p_dry_run THEN
        UPDATE public.nota_simple_titulares
        SET owner_id = c_aprox,
            metadatos = coalesce(metadatos, '{}'::jsonb)
              || jsonb_build_object('enlace_hubspot', jsonb_build_object('modo', 'aproximado', 'at', now()))
        WHERE id = r.id;
      END IF;
      v_enlazados := v_enlazados + 1;
    ELSIF (n_exacto > 1 OR n_aprox > 1) THEN
      v_dudosos := v_dudosos + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
        SELECT 9, 'nota_titular', r.id::text, r.building_id,
               coalesce(r.nombre_extraido, 'Titular') || ' · coincidencia dudosa',
               'Hay varias personas parecidas en el edificio; no se enlaza automáticamente.',
               jsonb_build_object('accion', 'revisar_enlace', 'titular_id', r.id, 'building_id', r.building_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda = 9 AND gp.entity_id = r.id::text
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enlazados', v_enlazados, 'dudosos', v_dudosos, 'dry_run', p_dry_run);
END;
$fn$;

REVOKE ALL ON FUNCTION public.enlazar_titulares_con_contactos(uuid, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enlazar_titulares_con_contactos(uuid, int, boolean) TO service_role;