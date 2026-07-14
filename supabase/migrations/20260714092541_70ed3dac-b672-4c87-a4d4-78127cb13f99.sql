
-- 1) v_owner_score: renormalización correcta por finca + ponderación de fincas
CREATE OR REPLACE VIEW public.v_owner_score
WITH (security_invoker=on)
AS
WITH
-- Suma pct crudo por (owner, finca) usando el normalizador existente (interpreta fracciones, %, etc.)
raw_owner_finca AS (
  SELECT
    t.owner_id,
    t.nota_simple_id,
    n.building_id,
    SUM(np.pct) FILTER (WHERE np.pct IS NOT NULL) AS pct_raw_sum,
    MAX(np.raw_value) AS raw_value,
    BOOL_AND(np.invalido) AS all_invalid
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples n ON n.id = t.nota_simple_id
  CROSS JOIN LATERAL public.normalize_pct_propiedad(t.porcentaje::text) np(pct, normalizado, invalido, raw_value)
  WHERE t.owner_id IS NOT NULL
    AND n.building_id IS NOT NULL
    AND COALESCE(n.status,'listo') = 'listo'
  GROUP BY t.owner_id, t.nota_simple_id, n.building_id
),
-- Total pct por finca (para renormalizar dentro de la finca a 100%)
finca_totals AS (
  SELECT nota_simple_id, building_id, SUM(pct_raw_sum) AS finca_sum
  FROM raw_owner_finca
  WHERE pct_raw_sum IS NOT NULL AND pct_raw_sum > 0
  GROUP BY nota_simple_id, building_id
),
-- Cuántas fincas con datos hay por edificio (para ponderación equitativa)
building_data_fincas AS (
  SELECT building_id, COUNT(*)::numeric AS n_fincas
  FROM finca_totals
  GROUP BY building_id
),
-- Pct renormalizado por (owner, finca, edificio)
owner_finca_norm AS (
  SELECT
    r.owner_id,
    r.building_id,
    r.nota_simple_id,
    CASE
      WHEN ft.finca_sum IS NOT NULL AND ft.finca_sum > 0 AND r.pct_raw_sum IS NOT NULL
      THEN (r.pct_raw_sum / ft.finca_sum) * 100.0
      ELSE NULL
    END AS pct_finca_norm,
    r.raw_value,
    r.all_invalid
  FROM raw_owner_finca r
  LEFT JOIN finca_totals ft
    ON ft.nota_simple_id = r.nota_simple_id
),
-- Agregación a nivel edificio: suma ponderada por (1/n_fincas) sobre fincas con datos
ns_pct AS (
  SELECT
    o.owner_id,
    o.building_id,
    ROUND(SUM(o.pct_finca_norm / NULLIF(bdf.n_fincas,0)) FILTER (WHERE o.pct_finca_norm IS NOT NULL), 2) AS pct,
    BOOL_OR(o.pct_finca_norm IS NOT NULL) AS has_norm,
    BOOL_AND(o.all_invalid) AS all_invalid,
    MAX(o.raw_value) AS raw_value
  FROM owner_finca_norm o
  LEFT JOIN building_data_fincas bdf ON bdf.building_id = o.building_id
  GROUP BY o.owner_id, o.building_id
),
-- Fallback HubSpot: cuota en building_owners si no hay ns
pct_resolved AS (
  SELECT
    bo_1.owner_id,
    bo_1.building_id,
    CASE
      WHEN np.pct IS NOT NULL THEN np.pct
      WHEN hs.pct IS NOT NULL THEN hs.pct
      ELSE NULL
    END AS pct_propiedad,
    CASE
      WHEN np.pct IS NOT NULL THEN 'nota_simple'
      WHEN hs.pct IS NOT NULL THEN 'building_owners'
      ELSE 'desconocido'
    END AS pct_origen,
    -- Verificado cuando viene de renormalización de nota simple, o de HubSpot ya normalizado
    CASE
      WHEN np.pct IS NOT NULL THEN true
      WHEN hs.pct IS NOT NULL THEN COALESCE(hs.normalizado, false)
      ELSE false
    END AS pct_normalizado,
    CASE
      WHEN np.pct IS NULL AND hs.pct IS NULL AND (COALESCE(np.all_invalid,false) OR COALESCE(hs.invalido,false)) THEN true
      ELSE false
    END AS pct_invalido,
    COALESCE(np.raw_value, hs.raw_value) AS pct_raw
  FROM public.building_owners bo_1
  JOIN public.owners o_1 ON o_1.id = bo_1.owner_id
  LEFT JOIN ns_pct np ON np.owner_id = bo_1.owner_id AND np.building_id = bo_1.building_id
  LEFT JOIN LATERAL public.normalize_pct_propiedad(bo_1.cuota::text) hs(pct, normalizado, invalido, raw_value) ON true
)
SELECT
  o.id AS owner_id,
  o.nombre,
  o.telefono,
  o.email,
  o.rol,
  bo.building_id,
  bo.subrole,
  bo.rol_notas,
  bo.es_influencer,
  bo.influencer_score,
  bo.influencer_reason,
  o.metadatos,
  pr.pct_propiedad,
  pr.pct_origen,
  pr.pct_normalizado,
  pr.pct_invalido,
  pr.pct_raw,
  COALESCE(lc.calls_count,0) AS contactos_previos,
  lc.last_call_at,
  ROUND((0.30 *
    CASE WHEN pr.pct_propiedad IS NULL THEN 0::numeric ELSE 1.0 - LEAST(1.0, pr.pct_propiedad/100.0) END
    + 0.25 *
    CASE WHEN pr.pct_propiedad IS NULL THEN 0::numeric ELSE LEAST(1.0, pr.pct_propiedad/100.0) END
    + 0.20 * LEAST(1.0, COALESCE(lc.calls_count,0)::numeric/5.0)
    + 0.15 * CASE WHEN o.rol='desconocido'::owner_role THEN 0 ELSE 1 END::numeric
    + 0.10 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END::numeric
  ) * 100::numeric, 1) AS score
FROM public.owners o
JOIN public.building_owners bo ON bo.owner_id = o.id
LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
LEFT JOIN public.v_owner_last_contact lc ON lc.owner_id = o.id
WHERE o.merged_into IS NULL;

-- 2) Helper interno: fusiona un par (canonical, loser). Reasigna TODO el historial.
CREATE OR REPLACE FUNCTION public._merge_owner_pair(
  p_canonical uuid, p_loser uuid, p_reason text DEFAULT 'fuzzy_match', p_details jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name_norm text;
  v_nif text;
BEGIN
  IF p_canonical = p_loser THEN RETURN; END IF;

  -- external_ids: mover si no colisiona con unique
  UPDATE public.external_ids e
    SET entity_id = p_canonical
    WHERE e.entity_type='owner' AND e.entity_id = p_loser
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e2
        WHERE e2.entity_type='owner' AND e2.entity_id = p_canonical
          AND e2.provider = e.provider
          AND e2.provider_object_type = e.provider_object_type
          AND e2.provider_id = e.provider_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e3
        WHERE e3.entity_type='owner' AND e3.entity_id = p_canonical
          AND e3.provider = e.provider
          AND e3.provider_object_type = e.provider_object_type
      );
  DELETE FROM public.external_ids WHERE entity_type='owner' AND entity_id = p_loser;

  UPDATE public.calls               SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.notes               SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.notas_simples       SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.nota_simple_titulares SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.call_sessions       SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.cadence_steps       SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.whatsapp_messages   SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.assets              SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.next_actions        SET owner_id = p_canonical WHERE owner_id = p_loser;

  DELETE FROM public.owner_companies a
    WHERE a.owner_id = p_loser
      AND EXISTS (SELECT 1 FROM public.owner_companies b
                   WHERE b.owner_id = p_canonical AND b.company_id=a.company_id AND b.role=a.role);
  UPDATE public.owner_companies SET owner_id = p_canonical WHERE owner_id = p_loser;

  UPDATE public.owner_relations SET owner_a_id = p_canonical WHERE owner_a_id = p_loser AND owner_b_id <> p_canonical;
  UPDATE public.owner_relations SET owner_b_id = p_canonical WHERE owner_b_id = p_loser AND owner_a_id <> p_canonical;
  DELETE FROM public.owner_relations WHERE owner_a_id = p_loser OR owner_b_id = p_loser;

  -- building_owners: fusión por edificio (mantiene la fila canónica, funde metadatos)
  UPDATE public.building_owners bc
     SET cuota = GREATEST(COALESCE(bc.cuota,0), COALESCE(bl.cuota,0)),
         es_influencer = bc.es_influencer OR bl.es_influencer,
         influencer_score = GREATEST(COALESCE(bc.influencer_score,0), COALESCE(bl.influencer_score,0)),
         rol_notas = COALESCE(bc.rol_notas, bl.rol_notas),
         metadatos = COALESCE(bc.metadatos,'{}'::jsonb) || COALESCE(bl.metadatos,'{}'::jsonb)
    FROM public.building_owners bl
   WHERE bl.owner_id = p_loser
     AND bc.owner_id = p_canonical
     AND bc.building_id = bl.building_id;
  DELETE FROM public.building_owners
   WHERE owner_id = p_loser
     AND building_id IN (SELECT building_id FROM public.building_owners WHERE owner_id = p_canonical);
  UPDATE public.building_owners SET owner_id = p_canonical WHERE owner_id = p_loser;

  SELECT public.normalize_person_name(nombre),
         COALESCE(NULLIF(upper(metadatos->>'nif'),''), NULLIF(upper(metadatos->>'dni'),''))
    INTO v_name_norm, v_nif
    FROM public.owners WHERE id = p_loser;

  INSERT INTO public.owner_merge_audit (canonical_owner_id, merged_owner_id, name_norm, nif, reason, details)
  VALUES (p_canonical, p_loser, v_name_norm, v_nif, p_reason, COALESCE(p_details,'{}'::jsonb));

  UPDATE public.owners
     SET merged_into = p_canonical,
         metadatos = COALESCE(metadatos,'{}'::jsonb) || jsonb_build_object('merged_into', p_canonical, 'merged_at', now())
   WHERE id = p_loser;
END $$;

-- 3) Dedup fuzzy: NIF y similitud de nombre, agrupado por edificio (o global si p_building_id NULL con NIF).
CREATE OR REPLACE FUNCTION public.dedup_owners_fuzzy(
  p_dry_run boolean DEFAULT false,
  p_threshold real DEFAULT 0.6,
  p_building_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pair record;
  v_pairs int := 0;
  v_merged int := 0;
  v_details jsonb;
  v_canonical uuid;
  v_loser uuid;
  v_canon_score int;
  v_loser_score int;
  v_reason text;
  v_sim real;
BEGIN
  -- Set trigram threshold for the session
  PERFORM set_limit(GREATEST(0.3, p_threshold - 0.1));

  FOR pair IN
    WITH candidates AS (
      SELECT DISTINCT o.id AS owner_id,
             public.normalize_person_name(o.nombre) AS nn,
             NULLIF(upper(COALESCE(o.metadatos->>'nif', o.metadatos->>'dni','')),'') AS nif,
             bo.building_id
        FROM public.owners o
        JOIN public.building_owners bo ON bo.owner_id = o.id
       WHERE o.merged_into IS NULL
         AND (p_building_id IS NULL OR bo.building_id = p_building_id)
    )
    SELECT a.owner_id AS a_id, b.owner_id AS b_id,
           a.nn AS a_nn, b.nn AS b_nn,
           a.nif AS a_nif, b.nif AS b_nif,
           a.building_id,
           CASE
             WHEN a.nif IS NOT NULL AND a.nif = b.nif THEN 1.0::real
             ELSE similarity(a.nn, b.nn)
           END AS sim
      FROM candidates a
      JOIN candidates b
        ON a.building_id = b.building_id
       AND a.owner_id < b.owner_id
       AND a.nn IS NOT NULL AND b.nn IS NOT NULL
       AND (
         (a.nif IS NOT NULL AND a.nif = b.nif)
         OR similarity(a.nn, b.nn) >= p_threshold
       )
     ORDER BY sim DESC
  LOOP
    v_pairs := v_pairs + 1;

    -- Re-check estado (por si en iteración previa uno fue fusionado)
    IF EXISTS (SELECT 1 FROM public.owners WHERE id = pair.a_id AND merged_into IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.owners WHERE id = pair.b_id AND merged_into IS NOT NULL)
    THEN CONTINUE; END IF;

    -- Score: hubspot external_id > más llamadas > más antiguo
    SELECT (SELECT count(*) FROM public.external_ids WHERE entity_type='owner' AND entity_id=pair.a_id) * 1000
         + (SELECT count(*) FROM public.calls WHERE owner_id=pair.a_id)
      INTO v_canon_score;
    SELECT (SELECT count(*) FROM public.external_ids WHERE entity_type='owner' AND entity_id=pair.b_id) * 1000
         + (SELECT count(*) FROM public.calls WHERE owner_id=pair.b_id)
      INTO v_loser_score;

    IF v_canon_score >= v_loser_score THEN
      v_canonical := pair.a_id; v_loser := pair.b_id;
    ELSE
      v_canonical := pair.b_id; v_loser := pair.a_id;
    END IF;

    v_sim := pair.sim;
    v_reason := CASE WHEN pair.a_nif IS NOT NULL AND pair.a_nif = pair.b_nif THEN 'nif_match' ELSE 'fuzzy_name' END;
    v_details := jsonb_build_object(
      'similarity', v_sim,
      'a_name', pair.a_nn, 'b_name', pair.b_nn,
      'nif', COALESCE(pair.a_nif, pair.b_nif),
      'building_id', pair.building_id
    );

    IF p_dry_run THEN
      v_merged := v_merged + 1;
      CONTINUE;
    END IF;

    PERFORM public._merge_owner_pair(v_canonical, v_loser, v_reason, v_details);
    v_merged := v_merged + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'pairs_evaluated', v_pairs,
    'merged', v_merged,
    'dry_run', p_dry_run,
    'threshold', p_threshold,
    'building_id', p_building_id
  );
END $$;
