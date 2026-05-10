
CREATE OR REPLACE FUNCTION public.rpc_inversores_paginated(
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 200,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  nombre text,
  telefono text,
  email text,
  metadatos jsonb,
  updated_at timestamptz,
  total_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT o.id, o.nombre, o.telefono, o.email, o.metadatos, o.updated_at
    FROM public.owners o
    WHERE o.metadatos->>'tipo_de_inversor' IS NOT NULL
      AND o.metadatos->>'tipo_de_inversor' <> ''
      AND (
        p_search IS NULL OR p_search = '' OR
        o.nombre ILIKE '%'||p_search||'%' OR
        (o.metadatos->>'tipo_de_inversor') ILIKE '%'||p_search||'%' OR
        (o.metadatos->>'distrito_zona') ILIKE '%'||p_search||'%' OR
        COALESCE(o.email,'') ILIKE '%'||p_search||'%' OR
        COALESCE(o.telefono,'') ILIKE '%'||p_search||'%'
      )
  ), counted AS (
    SELECT COUNT(*)::bigint AS total FROM filtered
  )
  SELECT f.id, f.nombre, f.telefono, f.email, f.metadatos, f.updated_at,
         (SELECT total FROM counted) AS total_count
  FROM filtered f
  ORDER BY f.updated_at DESC NULLS LAST, f.nombre ASC
  LIMIT p_limit OFFSET p_offset;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_inversores_paginated(text, int, int) TO anon, authenticated, service_role;
