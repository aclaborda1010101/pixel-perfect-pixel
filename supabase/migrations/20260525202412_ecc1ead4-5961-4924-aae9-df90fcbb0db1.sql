
-- Bandera para los 79 edificios de la cartera demo de mayo
ALTER TABLE public.buildings 
  ADD COLUMN IF NOT EXISTS cartera_demo_seed boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_buildings_cartera_demo 
  ON public.buildings(cartera_demo_seed) 
  WHERE cartera_demo_seed = true;

-- Calidad del fetch catastral (high = PDF distribución plantas, low = fallback SVG croquis)
ALTER TABLE public.catastro_data
  ADD COLUMN IF NOT EXISTS fetch_quality text DEFAULT 'high';

-- Tracking más detallado de jobs para el orquestador end-to-end
ALTER TABLE public.scoring_v2_jobs
  ADD COLUMN IF NOT EXISTS kind text DEFAULT 'single',
  ADD COLUMN IF NOT EXISTS current_phase text,
  ADD COLUMN IF NOT EXISTS phase_progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS items_status jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS error text;

-- Allow phase null for orchestrator jobs (kind=cartera_demo)
ALTER TABLE public.scoring_v2_jobs ALTER COLUMN phase DROP NOT NULL;
