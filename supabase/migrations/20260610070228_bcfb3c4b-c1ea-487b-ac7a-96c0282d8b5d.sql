ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS n_escaleras_final integer,
  ADD COLUMN IF NOT EXISTS n_escaleras_fuente text,
  ADD COLUMN IF NOT EXISTS n_escaleras_evidencia jsonb;