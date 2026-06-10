
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector,
  match_count int DEFAULT 6,
  filter_origenes text[] DEFAULT NULL,
  filter_scope_type text DEFAULT NULL,
  filter_scope_id uuid DEFAULT NULL
)
RETURNS TABLE (
  chunk_id uuid,
  source text,
  snippet text,
  metadatos jsonb,
  similarity float
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    kc.id AS chunk_id,
    kc.origen AS source,
    kc.contenido AS snippet,
    kc.metadatos,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_origenes IS NULL OR kc.origen = ANY(filter_origenes))
    AND (filter_scope_type IS NULL OR kc.scope_type = filter_scope_type)
    AND (filter_scope_id IS NULL OR kc.scope_id = filter_scope_id)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count
$$;

GRANT EXECUTE ON FUNCTION public.match_knowledge_chunks(vector, int, text[], text, uuid) TO authenticated, service_role, anon;
