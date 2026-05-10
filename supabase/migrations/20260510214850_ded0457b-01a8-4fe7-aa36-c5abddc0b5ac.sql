CREATE OR REPLACE FUNCTION public.notas_simples_kpis(
  p_status text DEFAULT NULL,
  p_riesgo text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_building_id uuid DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_tipo_carga text DEFAULT NULL,
  p_divisible text DEFAULT NULL, -- 'true'|'false'|null
  p_search text DEFAULT NULL
)
RETURNS TABLE (
  total bigint,
  listas bigint,
  riesgo_alto bigint,
  sin_edificio bigint,
  importe_cargas numeric
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT n.*
    FROM public.notas_simples n
    WHERE (p_status IS NULL OR n.status = p_status)
      AND (p_riesgo IS NULL OR n.riesgo = p_riesgo)
      AND (p_from IS NULL OR n.created_at >= p_from)
      AND (p_to IS NULL OR n.created_at <= p_to)
      AND (p_building_id IS NULL OR n.building_id = p_building_id)
      AND (p_owner_id IS NULL OR n.owner_id = p_owner_id)
      AND (
        p_tipo_carga IS NULL OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'cargas','[]'::jsonb)) c
          WHERE lower(c->>'tipo') = lower(p_tipo_carga)
        )
      )
      AND (
        p_divisible IS NULL OR
        (n.structured_json->>'divisible') = p_divisible
      )
      AND (
        p_search IS NULL OR p_search = '' OR
        (n.structured_json->'finca'->>'ref_catastral') ILIKE '%'||p_search||'%' OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'titulares','[]'::jsonb)) t
          WHERE (t->>'nombre') ILIKE '%'||p_search||'%'
        ) OR
        EXISTS (
          SELECT 1 FROM public.buildings b
          WHERE b.id = n.building_id
            AND (b.direccion ILIKE '%'||p_search||'%' OR b.ciudad ILIKE '%'||p_search||'%')
        )
      )
  )
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE status = 'listo')::bigint AS listas,
    COUNT(*) FILTER (WHERE riesgo = 'alto')::bigint AS riesgo_alto,
    COUNT(*) FILTER (WHERE building_id IS NULL)::bigint AS sin_edificio,
    COALESCE((
      SELECT SUM( (c->>'importe')::numeric )
      FROM filtered f, jsonb_array_elements(COALESCE(f.structured_json->'cargas','[]'::jsonb)) c
      WHERE (c->>'importe') ~ '^-?\d+(\.\d+)?$'
    ), 0)::numeric AS importe_cargas
  FROM filtered;
$$;

CREATE OR REPLACE FUNCTION public.notas_simples_search(
  p_status text DEFAULT NULL,
  p_riesgo text DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_building_id uuid DEFAULT NULL,
  p_owner_id uuid DEFAULT NULL,
  p_tipo_carga text DEFAULT NULL,
  p_divisible text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  id uuid,
  created_at timestamptz,
  processed_at timestamptz,
  status text,
  riesgo text,
  file_url text,
  building_id uuid,
  owner_id uuid,
  structured_json jsonb,
  error_message text,
  building_direccion text,
  building_ciudad text,
  owner_nombre text,
  total_count bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH filtered AS (
    SELECT n.*
    FROM public.notas_simples n
    WHERE (p_status IS NULL OR n.status = p_status)
      AND (p_riesgo IS NULL OR n.riesgo = p_riesgo)
      AND (p_from IS NULL OR n.created_at >= p_from)
      AND (p_to IS NULL OR n.created_at <= p_to)
      AND (p_building_id IS NULL OR n.building_id = p_building_id)
      AND (p_owner_id IS NULL OR n.owner_id = p_owner_id)
      AND (
        p_tipo_carga IS NULL OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'cargas','[]'::jsonb)) c
          WHERE lower(c->>'tipo') = lower(p_tipo_carga)
        )
      )
      AND (
        p_divisible IS NULL OR (n.structured_json->>'divisible') = p_divisible
      )
      AND (
        p_search IS NULL OR p_search = '' OR
        (n.structured_json->'finca'->>'ref_catastral') ILIKE '%'||p_search||'%' OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'titulares','[]'::jsonb)) t
          WHERE (t->>'nombre') ILIKE '%'||p_search||'%'
        ) OR
        EXISTS (
          SELECT 1 FROM public.buildings b
          WHERE b.id = n.building_id
            AND (b.direccion ILIKE '%'||p_search||'%' OR b.ciudad ILIKE '%'||p_search||'%')
        )
      )
  ), counted AS (
    SELECT COUNT(*)::bigint AS total FROM filtered
  )
  SELECT
    f.id, f.created_at, f.processed_at, f.status, f.riesgo, f.file_url,
    f.building_id, f.owner_id, f.structured_json, f.error_message,
    b.direccion AS building_direccion,
    b.ciudad AS building_ciudad,
    o.nombre AS owner_nombre,
    (SELECT total FROM counted) AS total_count
  FROM filtered f
  LEFT JOIN public.buildings b ON b.id = f.building_id
  LEFT JOIN public.owners o ON o.id = f.owner_id
  ORDER BY f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;