
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS ventanas_fachada_needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escaleras_needs_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plantas_levantables_requiere_humano boolean NOT NULL DEFAULT false;

-- Marca needs_review en escaleras: edificios sin detección (n_escaleras_final IS NULL y sin segundas_escaleras)
UPDATE public.building_analysis
SET escaleras_needs_review = true
WHERE n_escaleras_final IS NULL
  AND n_escaleras_en_piso01 IS NULL
  AND (segundas_escaleras IS NULL);

-- Marca needs_review en ventanas fachada: confidence baja o flags conocidos
UPDATE public.building_analysis
SET ventanas_fachada_needs_review = true
WHERE ventanas_fachada_total IS NOT NULL
  AND (
    COALESCE(confidence_ventanas,0) < 0.6
    OR COALESCE(aviso_ventanas,'') ILIKE '%mirador%'
    OR COALESCE(aviso_ventanas,'') ILIKE '%ancho%'
    OR COALESCE(aviso_ventanas,'') ILIKE '%ocl%'
  );

-- Recomputa plantas_levantables desde plantas_max_normativa - plantas_visibles
UPDATE public.building_analysis
SET plantas_levantables = GREATEST(0, plantas_max_normativa - COALESCE(plantas_visibles,0)),
    plantas_levantables_requiere_humano = false
WHERE plantas_max_normativa IS NOT NULL;

-- Marca requiere_humano cuando no hay normativa
UPDATE public.building_analysis
SET plantas_levantables_requiere_humano = true,
    plantas_levantables = NULL
WHERE plantas_max_normativa IS NULL;
