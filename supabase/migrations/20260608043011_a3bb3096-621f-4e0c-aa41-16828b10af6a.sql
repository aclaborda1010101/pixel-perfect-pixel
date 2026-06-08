ALTER TABLE public.parcel_geometry_cache
  ADD COLUMN IF NOT EXISTS street_edges_jsonb jsonb,
  ADD COLUMN IF NOT EXISTS is_corner boolean,
  ADD COLUMN IF NOT EXISTS total_street_length_m numeric;

ALTER TABLE public.facade_window_counts
  ADD COLUMN IF NOT EXISTS es_esquina boolean,
  ADD COLUMN IF NOT EXISTS esquina_source text,
  ADD COLUMN IF NOT EXISTS fachadas_a_calle jsonb,
  ADD COLUMN IF NOT EXISTS longitud_fachada_total_m numeric;

COMMENT ON COLUMN public.facade_window_counts.es_esquina IS
  'true si el poligono tiene >=2 aristas a calle con angulo en [60, 120] grados';
COMMENT ON COLUMN public.facade_window_counts.esquina_source IS
  'geometria | vlm_fallback | desconocido';
COMMENT ON COLUMN public.facade_window_counts.fachadas_a_calle IS
  'Array de aristas a calle: [{bearing, len, heading, midpoint, role}]';
COMMENT ON COLUMN public.facade_window_counts.longitud_fachada_total_m IS
  'Suma de longitudes de TODAS las aristas a calle';