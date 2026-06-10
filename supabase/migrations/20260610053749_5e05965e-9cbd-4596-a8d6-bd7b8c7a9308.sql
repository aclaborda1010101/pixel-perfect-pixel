CREATE TABLE IF NOT EXISTS public.knowledge_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  origen text NOT NULL,
  num_chunks int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendiente',
  error text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.knowledge_documents TO authenticated;
GRANT ALL ON public.knowledge_documents TO service_role;

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_manage_kdocs" ON public.knowledge_documents
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE POLICY "authenticated_read_kdocs" ON public.knowledge_documents
  FOR SELECT TO authenticated USING (true);

-- Link knowledge_chunks back to a source document for re-ingest/delete
ALTER TABLE public.knowledge_chunks
  ADD COLUMN IF NOT EXISTS document_id uuid REFERENCES public.knowledge_documents(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_document_id ON public.knowledge_chunks(document_id);