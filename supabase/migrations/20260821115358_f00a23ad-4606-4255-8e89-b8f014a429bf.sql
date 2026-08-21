CREATE OR REPLACE FUNCTION public.buscar_owner_por_nombre(p_nombre text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH q AS (
    SELECT public.norm_person_name(p_nombre) AS nn
  ), toks AS (
    SELECT nn, string_to_array(nn, ' ') AS t FROM q
  ), cand AS (
    SELECT o.id, o.created_at, public.norm_person_name(o.nombre) AS onn
    FROM public.owners o, toks
    WHERE o.merged_into IS NULL
      AND public.norm_person_name(o.nombre) <> ''
      AND array_length(toks.t, 1) >= 2
      AND public.norm_person_name(o.nombre) % toks.nn
  )
  SELECT id FROM (
    SELECT c.id, c.created_at,
      CASE
        WHEN c.onn = t.nn THEN 0
        WHEN string_to_array(c.onn,' ') <@ t.t OR t.t <@ string_to_array(c.onn,' ') THEN 1
        ELSE 2
      END AS rango
    FROM cand c, toks t
  ) x
  WHERE rango <= 1
  ORDER BY rango, created_at
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.buscar_owner_por_nombre(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.buscar_owner_por_nombre(text) TO authenticated, service_role;