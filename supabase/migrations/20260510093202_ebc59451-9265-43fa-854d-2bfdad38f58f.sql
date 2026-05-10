CREATE OR REPLACE FUNCTION public.calls_stats()
RETURNS TABLE(total bigint, analizables bigint, sin_transcripcion bigint, avg_duracion numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE transcripcion IS NOT NULL AND btrim(transcripcion) <> '')::bigint AS analizables,
    COUNT(*) FILTER (WHERE transcripcion IS NULL OR btrim(transcripcion) = '')::bigint AS sin_transcripcion,
    COALESCE(AVG(duracion_seg), 0)::numeric AS avg_duracion
  FROM public.calls;
$$;
GRANT EXECUTE ON FUNCTION public.calls_stats() TO anon, authenticated;