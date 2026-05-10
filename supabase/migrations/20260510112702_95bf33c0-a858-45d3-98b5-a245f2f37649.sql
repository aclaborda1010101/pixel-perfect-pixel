ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS metadatos jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_calls_metadatos_gin ON public.calls USING GIN (metadatos);