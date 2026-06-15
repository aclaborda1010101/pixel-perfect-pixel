
CREATE OR REPLACE FUNCTION public.get_pending_scoring_calls(_limit int DEFAULT 8)
RETURNS TABLE(id uuid, comercial_email text, duracion_seg int, transcripcion text, metadatos jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT c.id, c.comercial_email, c.duracion_seg, c.transcripcion, c.metadatos
  FROM public.calls c
  WHERE c.transcripcion IS NOT NULL
    AND c.transcripcion <> ''
    AND NOT (COALESCE(c.metadatos, '{}'::jsonb) ? 'post_call_scoring')
  ORDER BY c.fecha DESC
  LIMIT _limit;
$$;

CREATE OR REPLACE FUNCTION public.count_pending_scoring_calls()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)
  FROM public.calls c
  WHERE c.transcripcion IS NOT NULL
    AND c.transcripcion <> ''
    AND NOT (COALESCE(c.metadatos, '{}'::jsonb) ? 'post_call_scoring');
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_scoring_calls(int) TO service_role;
GRANT EXECUTE ON FUNCTION public.count_pending_scoring_calls() TO authenticated, service_role;
