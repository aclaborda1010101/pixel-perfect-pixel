ALTER TABLE public.catastro_data
  ADD COLUMN IF NOT EXISTS plantas_pdf_url text,
  ADD COLUMN IF NOT EXISTS plantas_pages_urls jsonb,
  ADD COLUMN IF NOT EXISTS plantas_num_pages integer,
  ADD COLUMN IF NOT EXISTS plantas_pdf_disponible boolean DEFAULT false;

ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS viviendas_por_planta_tipo integer,
  ADD COLUMN IF NOT EXISTS n_locales_planta_baja integer,
  ADD COLUMN IF NOT EXISTS n_almacenes_sotano integer,
  ADD COLUMN IF NOT EXISTS tiene_sotano boolean,
  ADD COLUMN IF NOT EXISTS tiene_azotea_transitable boolean,
  ADD COLUMN IF NOT EXISTS n_escaleras_en_piso01 integer,
  ADD COLUMN IF NOT EXISTS n_escaleras_en_planta_baja integer,
  ADD COLUMN IF NOT EXISTS patios_codigos jsonb,
  ADD COLUMN IF NOT EXISTS accesos_codigos jsonb;