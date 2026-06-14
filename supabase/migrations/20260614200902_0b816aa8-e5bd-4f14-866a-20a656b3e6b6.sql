
ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS puntuacion numeric,
  ADD COLUMN IF NOT EXISTS hubspot_call_id text,
  ADD COLUMN IF NOT EXISTS estado text NOT NULL DEFAULT 'preparada',
  ADD COLUMN IF NOT EXISTS finalizada_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS call_sessions_estado_idx ON public.call_sessions(estado);
CREATE INDEX IF NOT EXISTS call_sessions_owner_open_idx ON public.call_sessions(owner_id) WHERE finalizada_at IS NULL;
CREATE INDEX IF NOT EXISTS call_sessions_hubspot_call_idx ON public.call_sessions(hubspot_call_id);
