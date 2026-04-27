-- Activar pgvector
CREATE EXTENSION IF NOT EXISTS vector;

-- Tabla de chunks de conocimiento para RAG
CREATE TABLE IF NOT EXISTS public.knowledge_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origen TEXT NOT NULL,           -- p.ej. 'nota', 'llamada', 'documento', 'manual'
  referencia_id UUID,             -- id del registro origen (note, call, etc.)
  scope_type TEXT,                -- 'owner', 'asset', 'building', 'global'
  scope_id UUID,
  contenido TEXT NOT NULL,
  embedding vector(768),
  metadatos JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_scope
  ON public.knowledge_chunks (scope_type, scope_id);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON public.knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "preview_all_select" ON public.knowledge_chunks FOR SELECT USING (true);
CREATE POLICY "preview_all_insert" ON public.knowledge_chunks FOR INSERT WITH CHECK (true);
CREATE POLICY "preview_all_update" ON public.knowledge_chunks FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "preview_all_delete" ON public.knowledge_chunks FOR DELETE USING (true);

-- Función RPC para búsqueda semántica (similaridad coseno)
CREATE OR REPLACE FUNCTION public.match_knowledge_chunks(
  query_embedding vector(768),
  match_count int DEFAULT 5,
  filter_scope_type text DEFAULT NULL,
  filter_scope_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  contenido text,
  origen text,
  scope_type text,
  scope_id uuid,
  metadatos jsonb,
  similarity float
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT
    kc.id,
    kc.contenido,
    kc.origen,
    kc.scope_type,
    kc.scope_id,
    kc.metadatos,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_scope_type IS NULL OR kc.scope_type = filter_scope_type)
    AND (filter_scope_id IS NULL OR kc.scope_id = filter_scope_id)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;