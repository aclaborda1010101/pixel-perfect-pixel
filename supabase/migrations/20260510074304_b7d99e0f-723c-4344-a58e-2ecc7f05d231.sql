
ALTER TABLE public.hubspot_calls ADD COLUMN IF NOT EXISTS hs_owner_id text;
CREATE INDEX IF NOT EXISTS idx_hubspot_calls_hs_owner_id ON public.hubspot_calls(hs_owner_id);

CREATE TABLE IF NOT EXISTS public.hubspot_owners (
  hs_owner_id text PRIMARY KEY,
  email text,
  first_name text,
  last_name text,
  full_name text,
  archived boolean NOT NULL DEFAULT false,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.hubspot_owners ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hubspot_owners_select_all ON public.hubspot_owners;
CREATE POLICY hubspot_owners_select_all ON public.hubspot_owners FOR SELECT USING (true);
DROP POLICY IF EXISTS hubspot_owners_service_write ON public.hubspot_owners;
CREATE POLICY hubspot_owners_service_write ON public.hubspot_owners FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS comercial_hs_id text;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS comercial_email text;
ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS comercial_nombre text;
CREATE INDEX IF NOT EXISTS idx_calls_comercial_hs_id_fecha ON public.calls(comercial_hs_id, fecha);

ALTER TABLE public.coach_reports ADD COLUMN IF NOT EXISTS comercial_hs_id text;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coach_reports_comercial_week ON public.coach_reports(comercial_hs_id, week_start) WHERE comercial_hs_id IS NOT NULL;
