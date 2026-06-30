-- [#7] esquina_needs_review: la decisión de esquina puede descansar en una señal
-- débil (la 2ª vía proviene sólo de un fallback google_roads o de una arista sin
-- nombre OSM). Esta columna NO afecta al score (compute_cluster_score sigue leyendo
-- únicamente building_analysis.esquina); sólo enruta a revisión humana y permite que
-- el badge de "Esquina" no se presente como oportunidad confirmada.
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS esquina_needs_review boolean NOT NULL DEFAULT false;
