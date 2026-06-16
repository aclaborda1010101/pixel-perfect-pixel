CREATE OR REPLACE FUNCTION public.merge_duplicate_owners(p_dry_run boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grp record;
  r record;
  v_canonical uuid;
  v_groups int := 0;
  v_merged int := 0;
BEGIN
  FOR grp IN
    WITH n AS (
      SELECT id, nombre, created_at,
             public.normalize_person_name(nombre) AS nrm,
             COALESCE(NULLIF(upper(metadatos->>'nif'),''), NULLIF(upper(metadatos->>'dni'),'')) AS nif,
             (EXISTS (SELECT 1 FROM public.external_ids e
                       WHERE e.entity_type='owner' AND e.entity_id=owners.id
                         AND e.provider='hubspot')) AS has_hs
      FROM public.owners
      WHERE merged_into IS NULL
    )
    SELECT nrm,
           array_agg(id ORDER BY has_hs DESC, created_at ASC) AS ids,
           array_agg(nif) FILTER (WHERE nif IS NOT NULL) AS nifs
    FROM n
    WHERE nrm IS NOT NULL AND nrm <> ''
    GROUP BY nrm
    HAVING COUNT(*) > 1
  LOOP
    v_groups := v_groups + 1;
    v_canonical := grp.ids[1];

    FOR r IN SELECT unnest(grp.ids[2:array_length(grp.ids,1)]) AS loser LOOP
      IF p_dry_run THEN v_merged := v_merged + 1; CONTINUE; END IF;

      -- external_ids: mover sólo si no choca con NINGUNO de los dos UNIQUE.
      -- 1) Mismo provider_id (provider, provider_object_type, provider_id) ya existe → drop
      -- 2) Canónico ya tiene una entrada para (provider, provider_object_type) sobre sí mismo → drop
      UPDATE public.external_ids e
        SET entity_id = v_canonical
        WHERE e.entity_type='owner' AND e.entity_id = r.loser
          AND NOT EXISTS (
            SELECT 1 FROM public.external_ids e2
            WHERE e2.entity_type='owner' AND e2.entity_id = v_canonical
              AND e2.provider = e.provider
              AND e2.provider_object_type = e.provider_object_type
              AND e2.provider_id = e.provider_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.external_ids e3
            WHERE e3.entity_type='owner' AND e3.entity_id = v_canonical
              AND e3.provider = e.provider
              AND e3.provider_object_type = e.provider_object_type
          );
      DELETE FROM public.external_ids
        WHERE entity_type='owner' AND entity_id = r.loser;

      UPDATE public.calls               SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.notes               SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.notas_simples       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.nota_simple_titulares SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.call_sessions       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.cadence_steps       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.whatsapp_messages   SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.assets              SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.next_actions        SET owner_id = v_canonical WHERE owner_id = r.loser;

      DELETE FROM public.owner_companies a
        WHERE a.owner_id = r.loser
          AND EXISTS (SELECT 1 FROM public.owner_companies b
                       WHERE b.owner_id = v_canonical AND b.company_id=a.company_id AND b.role=a.role);
      UPDATE public.owner_companies SET owner_id = v_canonical WHERE owner_id = r.loser;

      UPDATE public.owner_relations SET owner_a_id = v_canonical WHERE owner_a_id = r.loser AND owner_b_id <> v_canonical;
      UPDATE public.owner_relations SET owner_b_id = v_canonical WHERE owner_b_id = r.loser AND owner_a_id <> v_canonical;
      DELETE FROM public.owner_relations WHERE owner_a_id = r.loser OR owner_b_id = r.loser;

      -- building_owners: fusión por edificio
      UPDATE public.building_owners bc
      SET cuota = GREATEST(COALESCE(bc.cuota,0), COALESCE(bl.cuota,0)),
          es_influencer = bc.es_influencer OR bl.es_influencer,
          influencer_score = GREATEST(COALESCE(bc.influencer_score,0), COALESCE(bl.influencer_score,0)),
          rol_notas = COALESCE(bc.rol_notas, bl.rol_notas),
          metadatos = bc.metadatos || bl.metadatos
      FROM public.building_owners bl
      WHERE bl.owner_id = r.loser
        AND bc.owner_id = v_canonical
        AND bc.building_id = bl.building_id;

      DELETE FROM public.building_owners
        WHERE owner_id = r.loser
          AND building_id IN (SELECT building_id FROM public.building_owners WHERE owner_id = v_canonical);
      UPDATE public.building_owners SET owner_id = v_canonical WHERE owner_id = r.loser;

      INSERT INTO public.owner_merge_audit (canonical_owner_id, merged_owner_id, name_norm, nif, reason)
      VALUES (v_canonical, r.loser, grp.nrm,
              (SELECT n FROM unnest(grp.nifs) n LIMIT 1),
              'name_norm_match');

      UPDATE public.owners
      SET merged_into = v_canonical,
          metadatos = COALESCE(metadatos,'{}'::jsonb) || jsonb_build_object('merged_into', v_canonical, 'merged_at', now())
      WHERE id = r.loser;

      v_merged := v_merged + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('groups', v_groups, 'merged', v_merged);
END $$;