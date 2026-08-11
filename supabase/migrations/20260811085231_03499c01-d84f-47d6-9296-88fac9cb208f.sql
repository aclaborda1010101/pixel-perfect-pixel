CREATE OR REPLACE FUNCTION public.reparse_claim_ids(p_ids uuid[], p_lock_minutes integer DEFAULT 30)
RETURNS SETOF public.notas_simples
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_min integer := greatest(1, least(coalesce(p_lock_minutes, 30), 120));
BEGIN
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN;
  END IF;
  IF array_length(p_ids, 1) > 5 THEN
    RAISE EXCEPTION 'reparse_claim_ids: max 5 ids';
  END IF;

  RETURN QUERY
  UPDATE public.notas_simples n
     SET claimed_at       = now(),
         claim_token      = gen_random_uuid(),
         claim_expires_at = now() + make_interval(mins => v_min)
   WHERE n.id IN (
     SELECT c.id FROM public.notas_simples c
      WHERE c.id = ANY(p_ids)
        AND c.status = 'listo'
        AND c.dead_letter = false
        AND coalesce(c.structured_json->>'reparse_done','') <> '1'
        AND (c.claim_token IS NULL OR c.claim_expires_at IS NULL OR c.claim_expires_at <= now())
      ORDER BY c.created_at ASC
      FOR UPDATE SKIP LOCKED
   )
  RETURNING n.*;
END
$$;

REVOKE ALL ON FUNCTION public.reparse_claim_ids(uuid[], integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reparse_claim_ids(uuid[], integer) TO service_role;