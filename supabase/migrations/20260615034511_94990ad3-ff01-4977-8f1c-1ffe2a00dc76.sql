
-- Unique parcial: misma persona/empresa (NIF) por edificio no se duplica
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrichment_jobs_building_nif
  ON public.enrichment_jobs (building_id, titular_nif)
  WHERE building_id IS NOT NULL AND titular_nif IS NOT NULL AND estado <> 'descartado';

-- Unique parcial: mismo nombre normalizado por edificio y nota
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrichment_jobs_building_name_nota
  ON public.enrichment_jobs (building_id, lower(titular_nombre), nota_simple_id)
  WHERE building_id IS NOT NULL AND estado <> 'descartado';

-- Una sola verificación final viva por job
CREATE UNIQUE INDEX IF NOT EXISTS uq_enrichment_verifications_job_final
  ON public.enrichment_verifications (job_id)
  WHERE decision IN ('aprobada', 'rechazada');
