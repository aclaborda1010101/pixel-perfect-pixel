ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS anotaciones_plano jsonb,
  ADD COLUMN IF NOT EXISTS analysis_duration_ms integer,
  ADD COLUMN IF NOT EXISTS plano_render_url text;