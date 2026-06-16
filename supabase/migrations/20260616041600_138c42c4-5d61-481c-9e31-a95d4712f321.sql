-- 1) Audit table
CREATE TABLE IF NOT EXISTS public.owner_merge_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  merged_owner_id    uuid NOT NULL,
  name_norm          text,
  nif                text,
  reason             text,
  details            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_oma_canonical ON public.owner_merge_audit(canonical_owner_id);
CREATE INDEX IF NOT EXISTS idx_oma_merged    ON public.owner_merge_audit(merged_owner_id);
GRANT SELECT ON public.owner_merge_audit TO authenticated;
GRANT ALL ON public.owner_merge_audit TO service_role;
ALTER TABLE public.owner_merge_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner_merge_audit_admin_read"
  ON public.owner_merge_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Soft-delete marker on owners
ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS merged_into uuid REFERENCES public.owners(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_owners_merged_into ON public.owners(merged_into) WHERE merged_into IS NOT NULL;

-- 3) Merge function
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
  v_external_kept int := 0;
  v_external_dropped int := 0;
  v_bo_merged int := 0;
  v_bo_dropped int := 0;
  v_calls_moved int := 0;
  v_notes_moved int := 0;
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

    -- Iterate losers
    FOR r IN SELECT unnest(grp.ids[2:array_length(grp.ids,1)]) AS loser LOOP
      IF p_dry_run THEN
        v_merged := v_merged + 1;
        CONTINUE;
      END IF;

      -- external_ids: move where no conflict, delete duplicates
      WITH moved AS (
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
        RETURNING 1
      ) SELECT COALESCE(COUNT(*),0) INTO STRICT v_external_kept FROM moved;
      WITH dropped AS (
        DELETE FROM public.external_ids
        WHERE entity_type='owner' AND entity_id = r.loser
        RETURNING 1
      ) SELECT COALESCE(COUNT(*),0) INTO STRICT v_external_dropped FROM dropped;

      -- calls: just repoint
      WITH mv AS (UPDATE public.calls SET owner_id = v_canonical WHERE owner_id = r.loser RETURNING 1)
        SELECT COUNT(*) INTO v_calls_moved FROM mv;
      -- notes, tasks (no unique constraints to worry about)
      UPDATE public.notes              SET owner_id = v_canonical WHERE owner_id = r.loser;
      WITH mv AS (UPDATE public.notas_simples SET owner_id = v_canonical WHERE owner_id = r.loser RETURNING 1)
        SELECT COUNT(*) INTO v_notes_moved FROM mv;
      UPDATE public.nota_simple_titulares SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.call_sessions       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.cadence_steps       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.whatsapp_messages   SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.assets              SET owner_id = v_canonical WHERE owner_id = r.loser;
      -- next_actions has UNIQUE(scope_type, scope_id, origen); owner_id no es parte → seguro repuntar
      UPDATE public.next_actions        SET owner_id = v_canonical WHERE owner_id = r.loser;

      -- owner_companies: unique(owner_id, company_id, role) → conflicto manual
      WITH dups AS (
        SELECT a.id FROM public.owner_companies a
        WHERE a.owner_id = r.loser
          AND EXISTS (SELECT 1 FROM public.owner_companies b
                       WHERE b.owner_id = v_canonical AND b.company_id=a.company_id AND b.role=a.role)
      )
      DELETE FROM public.owner_companies WHERE id IN (SELECT id FROM dups);
      UPDATE public.owner_companies SET owner_id = v_canonical WHERE owner_id = r.loser;

      -- owner_relations (a or b)
      UPDATE public.owner_relations SET owner_a_id = v_canonical WHERE owner_a_id = r.loser AND owner_b_id <> v_canonical;
      UPDATE public.owner_relations SET owner_b_id = v_canonical WHERE owner_b_id = r.loser AND owner_a_id <> v_canonical;
      DELETE FROM public.owner_relations WHERE owner_a_id = r.loser OR owner_b_id = r.loser;

      -- building_owners: PK(building_id, owner_id) + UNIQUE(building_id, owner_name_norm)
      -- Para cada building del loser:
      --   * si canónico ya está en ese building → fusionar (cuota MAX, OR de flags, sumar contactos)
      --   * si no → repuntar (el trigger reasigna owner_name_norm)
      WITH conflicts AS (
        SELECT bl.building_id, bl.cuota AS loser_cuota, bl.subrole AS loser_subrole,
               bl.rol_notas AS loser_rol_notas, bl.es_influencer AS loser_inf,
               bl.influencer_score AS loser_iscore, bl.metadatos AS loser_meta
        FROM public.building_owners bl
        WHERE bl.owner_id = r.loser
          AND EXISTS (SELECT 1 FROM public.building_owners bc
                       WHERE bc.building_id = bl.building_id AND bc.owner_id = v_canonical)
      )
      UPDATE public.building_owners bc
      SET cuota = GREATEST(COALESCE(bc.cuota,0), COALESCE(c.loser_cuota,0)),
          es_influencer = bc.es_influencer OR c.loser_inf,
          influencer_score = GREATEST(COALESCE(bc.influencer_score,0), COALESCE(c.loser_iscore,0)),
          rol_notas = COALESCE(bc.rol_notas, c.loser_rol_notas),
          metadatos = bc.metadatos || c.loser_meta
      FROM conflicts c
      WHERE bc.building_id = c.building_id AND bc.owner_id = v_canonical;

      WITH bo_drop AS (
        DELETE FROM public.building_owners
        WHERE owner_id = r.loser
          AND building_id IN (SELECT building_id FROM public.building_owners WHERE owner_id = v_canonical)
        RETURNING 1
      ) SELECT COUNT(*) INTO v_bo_dropped FROM bo_drop;

      -- Repuntar los restantes (sin conflicto). El trigger trg_building_owners_set_name_norm
      -- recalcula owner_name_norm en UPDATE OF owner_id.
      WITH mv AS (
        UPDATE public.building_owners SET owner_id = v_canonical WHERE owner_id = r.loser RETURNING 1
      ) SELECT COUNT(*) INTO v_bo_merged FROM mv;

      -- Audit + soft delete del loser
      INSERT INTO public.owner_merge_audit (canonical_owner_id, merged_owner_id, name_norm, nif, reason, details)
      VALUES (v_canonical, r.loser, grp.nrm, (SELECT nif FROM unnest(grp.nifs) nif LIMIT 1),
              'name_norm_match',
              jsonb_build_object('bo_dropped', v_bo_dropped, 'bo_repointed', v_bo_merged,
                                 'ext_kept', v_external_kept, 'ext_dropped', v_external_dropped));

      UPDATE public.owners
      SET merged_into = v_canonical,
          metadatos = COALESCE(metadatos,'{}'::jsonb) || jsonb_build_object(
            'merged_into', v_canonical,
            'merged_at', now()
          )
      WHERE id = r.loser;

      v_merged := v_merged + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'dry_run', p_dry_run,
    'groups', v_groups,
    'merged', v_merged
  );
END $$;

GRANT EXECUTE ON FUNCTION public.merge_duplicate_owners(boolean) TO service_role;

-- 4) Recalculo conteo+suma % por edificio (Nuda+Usufructo no se suman doble)
CREATE OR REPLACE FUNCTION public.recompute_building_owner_metrics(p_building_ids uuid[] DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int := 0;
  v_inconsistente int := 0;
BEGIN
  WITH ids AS (
    SELECT b.id FROM public.buildings b
    WHERE p_building_ids IS NULL OR b.id = ANY(p_building_ids)
  ),
  -- pct por owner usando v_owner_score (que aplica normalize_pct_propiedad)
  base AS (
    SELECT vo.building_id, vo.owner_id, vo.pct_propiedad,
           lower(COALESCE(bo.rol_notas,'')) AS rol_lc
    FROM public.v_owner_score vo
    JOIN public.building_owners bo
      ON bo.building_id = vo.building_id AND bo.owner_id = vo.owner_id
    WHERE vo.building_id IN (SELECT id FROM ids)
  ),
  -- agrupamos por (building, owner) y tomamos UNA cuota (max) para no sumar nuda+usufructo
  dedup AS (
    SELECT building_id, owner_id, MAX(pct_propiedad) AS pct
    FROM base
    GROUP BY building_id, owner_id
  ),
  sums AS (
    SELECT building_id,
           COUNT(*) AS n_owners_unicos,
           ROUND(SUM(COALESCE(pct,0))::numeric, 2) AS sum_pct
    FROM dedup
    GROUP BY building_id
  ),
  upd AS (
    UPDATE public.building_analysis ba
    SET metricas_extra = COALESCE(ba.metricas_extra,'{}'::jsonb)
      || jsonb_build_object(
           'owners_unicos_post_dedup', s.n_owners_unicos,
           'pct_propiedad_sum', s.sum_pct,
           'pct_propiedad_estado',
              CASE
                WHEN s.sum_pct BETWEEN 95 AND 105 THEN 'ok'
                WHEN s.sum_pct = 0 THEN 'sin_pct'
                WHEN s.sum_pct > 105 THEN 'sobre_105'
                ELSE 'bajo_95'
              END,
           'pct_propiedad_needs_review', NOT (s.sum_pct BETWEEN 95 AND 105 OR s.sum_pct = 0),
           'pct_propiedad_audited_at', to_jsonb(now())
         )
    FROM sums s
    WHERE ba.building_id = s.building_id
    RETURNING ba.building_id, s.sum_pct
  )
  SELECT COUNT(*) FILTER (WHERE TRUE), COUNT(*) FILTER (WHERE sum_pct < 95 OR sum_pct > 105)
    INTO v_updated, v_inconsistente
  FROM upd;

  -- Reflejo en buildings.numero_propietarios para que el card cabecera coincida
  UPDATE public.buildings b
  SET numero_propietarios = sub.n
  FROM (
    SELECT building_id, COUNT(DISTINCT owner_id) AS n
    FROM public.building_owners
    WHERE building_id IN (SELECT id FROM public.buildings WHERE p_building_ids IS NULL OR id = ANY(p_building_ids))
    GROUP BY building_id
  ) sub
  WHERE b.id = sub.building_id;

  RETURN jsonb_build_object('buildings_updated', v_updated, 'inconsistentes', v_inconsistente);
END $$;

GRANT EXECUTE ON FUNCTION public.recompute_building_owner_metrics(uuid[]) TO service_role;