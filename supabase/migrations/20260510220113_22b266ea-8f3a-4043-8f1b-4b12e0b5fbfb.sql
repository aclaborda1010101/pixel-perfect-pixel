
-- FTS index on knowledge_chunks.contenido (Spanish)
CREATE INDEX IF NOT EXISTS knowledge_chunks_fts_idx
  ON public.knowledge_chunks
  USING gin (to_tsvector('spanish', coalesce(contenido, '')));

CREATE INDEX IF NOT EXISTS knowledge_chunks_embedding_idx
  ON public.knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE INDEX IF NOT EXISTS knowledge_chunks_origen_ref_idx
  ON public.knowledge_chunks (origen, referencia_id);

-- Hybrid search: cosine similarity + FTS rank
CREATE OR REPLACE FUNCTION public.rpc_rag_search(
  query_text text,
  query_embedding vector(768) DEFAULT NULL,
  match_count int DEFAULT 8,
  filter_scope_type text DEFAULT NULL,
  filter_scope_id uuid DEFAULT NULL,
  filter_origen text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  contenido text,
  origen text,
  referencia_id uuid,
  scope_type text,
  scope_id uuid,
  metadatos jsonb,
  similarity double precision,
  fts_rank double precision,
  hybrid_score double precision
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH q AS (
    SELECT
      websearch_to_tsquery('spanish', coalesce(query_text, '')) AS tsq
  ),
  scored AS (
    SELECT
      kc.id,
      kc.contenido,
      kc.origen,
      kc.referencia_id,
      kc.scope_type,
      kc.scope_id,
      kc.metadatos,
      CASE
        WHEN query_embedding IS NOT NULL AND kc.embedding IS NOT NULL
        THEN 1 - (kc.embedding <=> query_embedding)
        ELSE 0
      END::double precision AS similarity,
      CASE
        WHEN query_text IS NOT NULL AND length(trim(query_text)) > 0
        THEN ts_rank(to_tsvector('spanish', coalesce(kc.contenido,'')), (SELECT tsq FROM q))::double precision
        ELSE 0
      END AS fts_rank
    FROM public.knowledge_chunks kc
    WHERE
      (filter_scope_type IS NULL OR kc.scope_type = filter_scope_type)
      AND (filter_scope_id IS NULL OR kc.scope_id = filter_scope_id)
      AND (filter_origen IS NULL OR kc.origen = filter_origen)
      AND (
        query_embedding IS NULL
        OR query_text IS NULL
        OR to_tsvector('spanish', coalesce(kc.contenido,'')) @@ (SELECT tsq FROM q)
        OR kc.embedding IS NOT NULL
      )
  )
  SELECT
    id, contenido, origen, referencia_id, scope_type, scope_id, metadatos,
    similarity, fts_rank,
    (0.7 * similarity + 0.3 * LEAST(fts_rank, 1.0))::double precision AS hybrid_score
  FROM scored
  ORDER BY (0.7 * similarity + 0.3 * LEAST(fts_rank, 1.0)) DESC
  LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_rag_search(text, vector, int, text, uuid, text) TO anon, authenticated, service_role;
