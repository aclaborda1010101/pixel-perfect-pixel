
ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS kpis_objetivo jsonb;

COMMENT ON COLUMN public.call_sessions.kpis_objetivo IS 'KPIs a abordar (claves del checklist) fijados en el paso 1. Inmutable como parte del expediente.';

CREATE INDEX IF NOT EXISTS idx_call_sessions_owner_finalizada
  ON public.call_sessions(owner_id, finalizada_at DESC)
  WHERE estado = 'finalizada';

CREATE INDEX IF NOT EXISTS idx_call_sessions_hs_call
  ON public.call_sessions(hubspot_call_id)
  WHERE hubspot_call_id IS NOT NULL;
