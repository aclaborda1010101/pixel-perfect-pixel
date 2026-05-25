
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS ventanas_patios_total integer,
  ADD COLUMN IF NOT EXISTS ventanas_patios_por_planta jsonb,
  ADD COLUMN IF NOT EXISTS ventanas_patios_por_patio jsonb;
