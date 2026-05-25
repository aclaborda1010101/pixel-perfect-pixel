ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS metricas_detalle jsonb;

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS score_summary text,
  ADD COLUMN IF NOT EXISTS confianza_media numeric;