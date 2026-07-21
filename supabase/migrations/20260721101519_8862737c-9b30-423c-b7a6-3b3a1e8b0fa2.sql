CREATE OR REPLACE FUNCTION public.find_owner_for_orphan_contact(
  p_email text, p_phone text, p_first text, p_last text
) RETURNS TABLE(owner_id uuid, method text, confidence numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_cnt int;
  v_phone_norm text;
  v_full text;
  v_sim numeric;
  v_next_sim numeric;
BEGIN
  -- Email exacto y único
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT count(*), min(o.id) INTO v_cnt, v_id
    FROM public.owners o
    WHERE lower(o.email) = lower(btrim(p_email))
      AND o.merged_into IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e
        WHERE e.entity_type = 'owner'
          AND e.entity_id = o.id
          AND e.provider = 'hubspot'
          AND e.provider_object_type = 'contact'
      );

    IF v_cnt = 1 THEN
      RETURN QUERY SELECT v_id, 'email'::text, 1.0::numeric;
      RETURN;
    END IF;
  END IF;

  -- Teléfono: últimos 9 dígitos, único
  v_phone_norm := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  IF length(v_phone_norm) = 9 THEN
    SELECT count(*), min(o.id) INTO v_cnt, v_id
    FROM public.owners o
    WHERE o.merged_into IS NULL
      AND o.telefono IS NOT NULL
      AND right(regexp_replace(o.telefono, '\D', '', 'g'), 9) = v_phone_norm
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e
        WHERE e.entity_type = 'owner'
          AND e.entity_id = o.id
          AND e.provider = 'hubspot'
          AND e.provider_object_type = 'contact'
      );

    IF v_cnt = 1 THEN
      RETURN QUERY SELECT v_id, 'phone'::text, 0.95::numeric;
      RETURN;
    END IF;
  END IF;

  -- Nombre: similaridad trigrama, top-1 con margen frente al segundo candidato.
  v_full := public.normalize_person_name(concat_ws(' ', p_first, p_last));
  IF v_full IS NOT NULL AND length(v_full) >= 5 THEN
    WITH cand AS (
      SELECT
        o.id,
        similarity(public.normalize_person_name(o.nombre), v_full)::numeric AS sim
      FROM public.owners o
      WHERE o.merged_into IS NULL
        AND o.nombre IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.external_ids e
          WHERE e.entity_type = 'owner'
            AND e.entity_id = o.id
            AND e.provider = 'hubspot'
            AND e.provider_object_type = 'contact'
        )
        AND public.normalize_person_name(o.nombre) % v_full
    ), ranked AS (
      SELECT
        id,
        sim,
        row_number() OVER (ORDER BY sim DESC, id) AS rn,
        lead(sim) OVER (ORDER BY sim DESC, id) AS next_sim
      FROM cand
      ORDER BY sim DESC, id
      LIMIT 2
    )
    SELECT id, sim, next_sim
      INTO v_id, v_sim, v_next_sim
    FROM ranked
    WHERE rn = 1;

    IF v_id IS NOT NULL
       AND v_sim >= 0.75
       AND (v_next_sim IS NULL OR (v_sim - v_next_sim) >= 0.15) THEN
      RETURN QUERY SELECT v_id, 'name'::text, v_sim;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT NULL::uuid, 'none'::text, 0::numeric;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_owner_for_orphan_contact(text,text,text,text) TO authenticated, service_role;

CREATE INDEX IF NOT EXISTS idx_hs_notes_assoc_contacts ON public.hubspot_notes USING gin (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_tasks_assoc_contacts ON public.hubspot_tasks USING gin (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_meetings_assoc_contacts ON public.hubspot_meetings USING gin (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_comms_assoc_contacts ON public.hubspot_communications USING gin (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_notes_hs_lastmod ON public.hubspot_notes (hs_lastmodifieddate DESC);
CREATE INDEX IF NOT EXISTS idx_hs_tasks_hs_lastmod ON public.hubspot_tasks (hs_lastmodifieddate DESC);
CREATE INDEX IF NOT EXISTS idx_hs_meetings_hs_lastmod ON public.hubspot_meetings (hs_lastmodifieddate DESC);