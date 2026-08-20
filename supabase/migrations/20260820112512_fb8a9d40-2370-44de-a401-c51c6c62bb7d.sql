CREATE TABLE public.building_hubspot_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  user_id uuid,
  ok boolean NOT NULL DEFAULT false,
  resumen jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  duracion_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_bhsl_building_created ON public.building_hubspot_sync_log (building_id, created_at DESC);

GRANT SELECT ON public.building_hubspot_sync_log TO authenticated;
GRANT ALL ON public.building_hubspot_sync_log TO service_role;

ALTER TABLE public.building_hubspot_sync_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "equipo lee el historial de sincronizacion"
  ON public.building_hubspot_sync_log FOR SELECT
  TO authenticated
  USING (public.is_internal_member());