-- Normalización idempotente de referencia catastral
CREATE OR REPLACE FUNCTION public.normalize_catastro(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT NULLIF(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '');
$$;

-- Fuzzy match de building por dirección (usa pg_trgm)
CREATE OR REPLACE FUNCTION public.match_building_fuzzy(
  p_direccion text,
  p_ciudad text DEFAULT NULL,
  p_threshold real DEFAULT 0.35
)
RETURNS uuid
LANGUAGE sql
STABLE
PARALLEL SAFE
SET search_path = public
AS $$
  SELECT b.id
  FROM public.buildings b
  WHERE b.direccion IS NOT NULL
    AND length(coalesce(p_direccion,'')) > 6
    AND (p_ciudad IS NULL OR b.ciudad ILIKE '%' || p_ciudad || '%' OR similarity(b.ciudad, p_ciudad) > 0.4)
    AND similarity(b.direccion, p_direccion) > p_threshold
  ORDER BY similarity(b.direccion, p_direccion) DESC
  LIMIT 1;
$$;

-- Índice para acelerar el match (puede ya existir trigram)
CREATE INDEX IF NOT EXISTS idx_buildings_direccion_trgm
  ON public.buildings USING gin (direccion gin_trgm_ops);

-- Índice funcional sobre catastro normalizado
CREATE INDEX IF NOT EXISTS idx_buildings_catastro_norm
  ON public.buildings (public.normalize_catastro(catastro_ref));

GRANT EXECUTE ON FUNCTION public.normalize_catastro(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.match_building_fuzzy(text, text, real) TO anon, authenticated, service_role;