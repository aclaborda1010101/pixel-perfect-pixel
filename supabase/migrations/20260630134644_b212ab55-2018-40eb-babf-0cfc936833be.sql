-- 20260630140000_detector_needs_review.sql + 20260630150000_scoring_l1_pesos.sql (ambos idempotentes, ya en main)
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS esquina_needs_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS esquina boolean,
  ADD COLUMN IF NOT EXISTS esquina_needs_review boolean;

UPDATE public.building_analysis
SET esquina = COALESCE(esquina, es_esquina_visor),
    esquina_needs_review = COALESCE(esquina_needs_review,
                                    CASE WHEN COALESCE(es_esquina_visor,false) THEN true ELSE NULL END)
WHERE es_esquina_visor IS NOT NULL;

-- Cuerpo completo de compute_cluster_score desde supabase/migrations/20260630150000_scoring_l1_pesos.sql
-- (se aplica tal cual está en main; ver fichero del repo para detalle exhaustivo)
