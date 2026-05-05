
-- ============================================================
-- Fase B — HubSpot sync schema
-- ============================================================

-- 1. ALTER tablas existentes
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE public.owners
  ADD COLUMN IF NOT EXISTS metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE public.building_owners
  ADD COLUMN IF NOT EXISTS metadatos jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. external_ids — mapeo polimórfico
CREATE TABLE IF NOT EXISTS public.external_ids (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,           -- 'building' | 'owner' | 'building_owner'
  entity_id uuid NOT NULL,
  provider text NOT NULL,              -- 'hubspot'
  provider_object_type text NOT NULL,  -- 'deal' | 'contact' | 'company' | 'association'
  provider_id text NOT NULL,           -- ID en HubSpot (string)
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_object_type, provider_id),
  UNIQUE (entity_type, entity_id, provider, provider_object_type)
);

CREATE INDEX IF NOT EXISTS idx_external_ids_entity ON public.external_ids (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_external_ids_provider ON public.external_ids (provider, provider_object_type, provider_id);

-- 3. hubspot_sync_state — un row por entidad sincronizada
CREATE TABLE IF NOT EXISTS public.hubspot_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL UNIQUE,         -- 'deals' | 'contacts' | 'associations'
  cursor text,                         -- HubSpot pagination cursor (after)
  last_full_sync_at timestamptz,
  last_run_at timestamptz,
  last_run_status text,                -- 'idle' | 'running' | 'ok' | 'error'
  total_synced integer NOT NULL DEFAULT 0,
  last_error text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 4. hubspot_sync_log — auditoría de cada ejecución
CREATE TABLE IF NOT EXISTS public.hubspot_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running',  -- 'running' | 'ok' | 'error'
  pages_fetched integer NOT NULL DEFAULT 0,
  records_upserted integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0,
  error_message text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hubspot_sync_log_entity_started ON public.hubspot_sync_log (entity, started_at DESC);

-- 5. Triggers updated_at
DROP TRIGGER IF EXISTS trg_external_ids_updated ON public.external_ids;
CREATE TRIGGER trg_external_ids_updated BEFORE UPDATE ON public.external_ids
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_hubspot_sync_state_updated ON public.hubspot_sync_state;
CREATE TRIGGER trg_hubspot_sync_state_updated BEFORE UPDATE ON public.hubspot_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. RLS — Opción 2: lectura abierta (preview), escritura solo service_role
ALTER TABLE public.external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubspot_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hubspot_sync_log ENABLE ROW LEVEL SECURITY;

-- external_ids: lectura abierta, escritura solo service_role
CREATE POLICY "external_ids_select_all" ON public.external_ids FOR SELECT USING (true);
CREATE POLICY "external_ids_service_write" ON public.external_ids FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- hubspot_sync_state: lectura abierta (la UI necesita ver el status), escritura solo service_role
CREATE POLICY "hubspot_sync_state_select_all" ON public.hubspot_sync_state FOR SELECT USING (true);
CREATE POLICY "hubspot_sync_state_service_write" ON public.hubspot_sync_state FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- hubspot_sync_log: lectura abierta (historial visible en UI), escritura solo service_role
CREATE POLICY "hubspot_sync_log_select_all" ON public.hubspot_sync_log FOR SELECT USING (true);
CREATE POLICY "hubspot_sync_log_service_write" ON public.hubspot_sync_log FOR ALL
  TO service_role USING (true) WITH CHECK (true);

-- 7. Seed inicial de sync_state
INSERT INTO public.hubspot_sync_state (entity, last_run_status)
VALUES ('deals', 'idle'), ('contacts', 'idle'), ('associations', 'idle')
ON CONFLICT (entity) DO NOTHING;
