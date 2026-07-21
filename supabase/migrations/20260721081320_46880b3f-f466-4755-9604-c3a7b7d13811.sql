
-- Retroactive audit: flag + comercial email denorm + queue view + permissive read policy for retro sessions
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS retroactiva boolean NOT NULL DEFAULT false;
ALTER TABLE public.call_sessions ADD COLUMN IF NOT EXISTS comercial_email text;

CREATE INDEX IF NOT EXISTS call_sessions_retroactiva_idx ON public.call_sessions(retroactiva) WHERE retroactiva = true;
CREATE INDEX IF NOT EXISTS call_sessions_comercial_email_idx ON public.call_sessions(comercial_email);

-- Cualquier autenticado puede LEER expedientes retroactivos (no llevan comercial real asignado y deben aparecer
-- en historial de propietario + agregados de productividad para Jesús/David/Marta).
DROP POLICY IF EXISTS "sessions_select_retroactiva_public" ON public.call_sessions;
CREATE POLICY "sessions_select_retroactiva_public"
ON public.call_sessions FOR SELECT
TO authenticated
USING (retroactiva = true);

-- Vista de cola para monitorización.
CREATE OR REPLACE VIEW public.v_retro_audit_queue AS
SELECT
  hc.hs_id,
  hc.hs_timestamp,
  hc.hs_call_duration,
  hc.hs_owner_id,
  hc.hs_call_disposition,
  hc.associated_contact_ids
FROM public.hubspot_calls hc
WHERE hc.hs_call_transcription IS NOT NULL
  AND hc.hs_call_transcription <> ''
  AND hc.hs_call_disposition = ANY (ARRAY[
    'f240bbac-87c9-4f6e-bf70-924b57d47db7',
    '55428849-9fbc-4038-92d6-7c4f2b850974',
    '371c7887-c871-4c38-b0e7-77bafc4de124',
    'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'
  ])
  AND COALESCE(hc.hs_call_duration, 0) >= 60000
  AND NOT EXISTS (
    SELECT 1 FROM public.call_sessions cs
    WHERE cs.hubspot_call_id = hc.hs_id AND cs.voss_post IS NOT NULL
  );
GRANT SELECT ON public.v_retro_audit_queue TO authenticated, service_role;

-- Vista de progreso para dashboards.
CREATE OR REPLACE VIEW public.v_retro_audit_progress AS
WITH universe AS (
  SELECT COUNT(*)::int AS total
  FROM public.hubspot_calls hc
  WHERE hc.hs_call_transcription IS NOT NULL AND hc.hs_call_transcription <> ''
    AND hc.hs_call_disposition = ANY (ARRAY[
      'f240bbac-87c9-4f6e-bf70-924b57d47db7',
      '55428849-9fbc-4038-92d6-7c4f2b850974',
      '371c7887-c871-4c38-b0e7-77bafc4de124',
      'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'
    ])
    AND COALESCE(hc.hs_call_duration, 0) >= 60000
),
audited AS (
  SELECT COUNT(*)::int AS n FROM public.call_sessions WHERE retroactiva = true AND voss_post IS NOT NULL
),
pending AS (
  SELECT COUNT(*)::int AS n FROM public.v_retro_audit_queue
)
SELECT
  (SELECT total FROM universe) AS total_universo,
  (SELECT n FROM audited)      AS auditadas,
  (SELECT n FROM pending)      AS pendientes,
  CASE WHEN (SELECT total FROM universe) > 0
       THEN ROUND(100.0 * (SELECT n FROM audited) / (SELECT total FROM universe), 1)
       ELSE 0 END AS pct;
GRANT SELECT ON public.v_retro_audit_progress TO authenticated, service_role;
