CREATE INDEX IF NOT EXISTS idx_owners_norm_person_name_trgm
  ON public.owners USING gin (public.norm_person_name(nombre) public.gin_trgm_ops)
  WHERE merged_into IS NULL;
ANALYZE public.owners;