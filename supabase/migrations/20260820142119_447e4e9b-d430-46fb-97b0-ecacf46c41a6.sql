ALTER FUNCTION public.normalize_pct_propiedad(text) ROWS 1 PARALLEL SAFE;

ALTER FUNCTION public.is_internal_member() PARALLEL SAFE;
ALTER FUNCTION public.derecho_grupos(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.derecho_computa_propiedad(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.derecho_es_ganancial(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.derecho_es_familiar(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.normalize_person_name(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.norm_phone(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.clean_owner_name(text) PARALLEL SAFE COST 10;
ALTER FUNCTION public.strip_html_to_text(text) PARALLEL SAFE COST 10;

CREATE INDEX IF NOT EXISTS idx_buildings_interlocutor
  ON public.buildings (interlocutor_owner_id) WHERE interlocutor_owner_id IS NOT NULL;

ALTER TABLE public.buildings SET (fillfactor = 70);
ALTER TABLE public.buildings SET (autovacuum_vacuum_scale_factor = 0.02);

ANALYZE public.calls;
ANALYZE public.buildings;
ANALYZE public.building_owners;