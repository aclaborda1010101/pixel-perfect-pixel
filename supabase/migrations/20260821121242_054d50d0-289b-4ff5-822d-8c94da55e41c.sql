ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS distrito text,
  ADD COLUMN IF NOT EXISTS barrio text,
  ADD COLUMN IF NOT EXISTS metros_comercio numeric,
  ADD COLUMN IF NOT EXISTS metros_oficina numeric,
  ADD COLUMN IF NOT EXISTS anio_construccion integer;

CREATE INDEX IF NOT EXISTS idx_buildings_distrito ON public.buildings (distrito);
CREATE INDEX IF NOT EXISTS idx_buildings_cotejo ON public.buildings (hs_props_synced_at NULLS FIRST);

ALTER TABLE public.cotejo_hubspot_incidencias
  ADD COLUMN IF NOT EXISTS resolucion text NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS run_id uuid;

CREATE TABLE IF NOT EXISTS public.cotejo_hubspot_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  estado text NOT NULL DEFAULT 'en_curso',
  total_objetivo integer NOT NULL DEFAULT 0,
  procesados integer NOT NULL DEFAULT 0,
  fallidos integer NOT NULL DEFAULT 0,
  ultimo_building_id uuid,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.cotejo_hubspot_runs TO authenticated;
GRANT ALL ON public.cotejo_hubspot_runs TO service_role;
ALTER TABLE public.cotejo_hubspot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cotejo_runs_read_auth" ON public.cotejo_hubspot_runs;
CREATE POLICY "cotejo_runs_read_auth" ON public.cotejo_hubspot_runs
  FOR SELECT TO authenticated USING (true);

DROP TRIGGER IF EXISTS trg_cotejo_runs_updated ON public.cotejo_hubspot_runs;
CREATE TRIGGER trg_cotejo_runs_updated BEFORE UPDATE ON public.cotejo_hubspot_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();