ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS es_esquina_visor boolean,
  ADD COLUMN IF NOT EXISTS calles_frente_visor jsonb,
  ADD COLUMN IF NOT EXISTS esquina_visor_confianza numeric;