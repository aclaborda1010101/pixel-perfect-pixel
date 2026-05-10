ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS notas_post_llamada text,
  ADD COLUMN IF NOT EXISTS transcripcion_source text DEFAULT 'note';

UPDATE public.calls
SET notas_post_llamada = transcripcion,
    transcripcion = NULL,
    transcripcion_source = 'note'
WHERE transcripcion IS NOT NULL
  AND (transcripcion_source IS NULL OR transcripcion_source = 'note')
  AND notas_post_llamada IS NULL;

CREATE INDEX IF NOT EXISTS idx_calls_transcripcion_source ON public.calls(transcripcion_source);