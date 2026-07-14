
CREATE OR REPLACE FUNCTION public._owner_names_typo_match(a_nn text, b_nn text, p_token_threshold real DEFAULT 0.7)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  a text[]; b text[];
  a_only text[]; b_only text[];
  sim_val real;
BEGIN
  IF a_nn IS NULL OR b_nn IS NULL OR a_nn = '' OR b_nn = '' THEN RETURN false; END IF;
  a := string_to_array(a_nn, ' ');
  b := string_to_array(b_nn, ' ');
  -- Deben tener el mismo número de tokens y al menos 2 (nombre + apellido)
  IF array_length(a,1) <> array_length(b,1) OR array_length(a,1) < 2 THEN RETURN false; END IF;
  -- Tokens exclusivos de cada lado
  SELECT array_agg(t) INTO a_only FROM (SELECT unnest(a) t EXCEPT SELECT unnest(b)) s;
  SELECT array_agg(t) INTO b_only FROM (SELECT unnest(b) t EXCEPT SELECT unnest(a)) s;
  -- Si son idénticos (mismos tokens) no es duplicado distinto, es exact match (lo tratamos como sí)
  IF a_only IS NULL AND b_only IS NULL THEN RETURN true; END IF;
  -- Debe haber exactamente un token distinto por lado
  IF array_length(a_only,1) <> 1 OR array_length(b_only,1) <> 1 THEN RETURN false; END IF;
  sim_val := similarity(a_only[1], b_only[1]);
  RETURN sim_val >= p_token_threshold;
END $$;

CREATE OR REPLACE FUNCTION public.dedup_owners_fuzzy(
  p_dry_run boolean DEFAULT false,
  p_threshold real DEFAULT 0.7,
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
BEGIN
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
           (a.nif IS NOT NULL AND a.nif = b.nif) AS by_nif
      FROM candidates a
      JOIN candidates b
        ON a.building_id = b.building_id
       AND a.owner_id < b.owner_id
       AND a.nn IS NOT NULL AND b.nn IS NOT NULL
       AND (
         (a.nif IS NOT NULL AND a.nif = b.nif)
         OR public._owner_names_typo_match(a.nn, b.nn, p_threshold)
       )
  LOOP
    v_pairs := v_pairs + 1;
    IF EXISTS (SELECT 1 FROM public.owners WHERE id = pair.a_id AND merged_into IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.owners WHERE id = pair.b_id AND merged_into IS NOT NULL)
    THEN CONTINUE; END IF;

    SELECT (SELECT count(*) FROM public.external_ids WHERE entity_type='owner' AND entity_id=pair.a_id) * 1000
         + (SELECT count(*) FROM public.calls WHERE owner_id=pair.a_id) INTO v_canon_score;
    SELECT (SELECT count(*) FROM public.external_ids WHERE entity_type='owner' AND entity_id=pair.b_id) * 1000
         + (SELECT count(*) FROM public.calls WHERE owner_id=pair.b_id) INTO v_loser_score;

    IF v_canon_score >= v_loser_score THEN
      v_canonical := pair.a_id; v_loser := pair.b_id;
    ELSE
      v_canonical := pair.b_id; v_loser := pair.a_id;
    END IF;

    v_reason := CASE WHEN pair.by_nif THEN 'nif_match' ELSE 'fuzzy_name_typo' END;
    v_details := jsonb_build_object(
      'a_name', pair.a_nn, 'b_name', pair.b_nn,
      'nif', COALESCE(pair.a_nif, pair.b_nif), 'building_id', pair.building_id
    );

    IF p_dry_run THEN v_merged := v_merged + 1; CONTINUE; END IF;
    PERFORM public._merge_owner_pair(v_canonical, v_loser, v_reason, v_details);
    v_merged := v_merged + 1;
  END LOOP;

  RETURN jsonb_build_object('pairs_evaluated', v_pairs, 'merged', v_merged,
    'dry_run', p_dry_run, 'threshold', p_threshold, 'building_id', p_building_id);
END $$;
