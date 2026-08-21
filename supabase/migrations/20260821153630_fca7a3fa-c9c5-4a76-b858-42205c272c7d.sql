-- 1) Columnas de trazabilidad legal
ALTER TABLE public.wa_consent_signals
  ADD COLUMN IF NOT EXISTS origen text,
  ADD COLUMN IF NOT EXISTS veto_motivos text[],
  ADD COLUMN IF NOT EXISTS validacion jsonb,
  ADD COLUMN IF NOT EXISTS revisado_por uuid,
  ADD COLUMN IF NOT EXISTS revocado_at timestamptz;

UPDATE public.wa_consent_signals
SET origen = CASE
  WHEN fuente = 'hubspot' THEN 'cliente'
  WHEN fuente ILIKE 'tarjeta%' OR fuente ILIKE '%manual%' THEN 'comercial'
  ELSE 'sistema' END
WHERE origen IS NULL;

ALTER TABLE public.wa_consent_signals
  ALTER COLUMN origen SET DEFAULT 'sistema';

DO $$ BEGIN
  ALTER TABLE public.wa_consent_signals
    ADD CONSTRAINT wa_consent_origen_chk
    CHECK (origen IN ('cliente','sistema','comercial','revocacion'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_wa_consent_owner_fecha
  ON public.wa_consent_signals (owner_id, fecha_llamada DESC NULLS LAST, detectado_at DESC NULLS LAST);

-- 2) Consentimiento vigente: manda la señal MÁS RECIENTE
CREATE OR REPLACE VIEW public.v_wa_consent_vigente AS
WITH ordenadas AS (
  SELECT s.*,
         COALESCE(s.fecha_llamada, s.detectado_at) AS momento,
         ROW_NUMBER() OVER (
           PARTITION BY s.owner_id
           ORDER BY COALESCE(s.fecha_llamada, s.detectado_at) DESC NULLS LAST, s.id DESC
         ) AS rn
  FROM public.wa_consent_signals s
  WHERE s.owner_id IS NOT NULL
    AND s.veredicto IN ('autorizado','rechazado')
)
SELECT
  owner_id,
  veredicto AS veredicto_vigente,
  (veredicto = 'autorizado'
    AND COALESCE(review_status,'') NOT IN ('pendiente_revision','revocado')) AS autorizado,
  origen,
  fuente,
  cita_textual,
  telefono,
  confianza,
  momento AS fecha,
  review_status,
  review_reason,
  escrito_en_hubspot
FROM ordenadas
WHERE rn = 1;

GRANT SELECT ON public.v_wa_consent_vigente TO authenticated;
GRANT SELECT ON public.v_wa_consent_vigente TO service_role;

-- 3) Contadores separados por origen
CREATE OR REPLACE VIEW public.v_wa_consent_contadores AS
SELECT
  COALESCE(origen,'sistema') AS origen,
  COUNT(*) FILTER (WHERE autorizado) AS autorizados_vigentes,
  COUNT(*) FILTER (WHERE NOT autorizado) AS no_autorizados,
  COUNT(*) FILTER (WHERE review_status = 'pendiente_revision') AS pendientes_revision
FROM public.v_wa_consent_vigente
GROUP BY 1;

GRANT SELECT ON public.v_wa_consent_contadores TO authenticated;
GRANT SELECT ON public.v_wa_consent_contadores TO service_role;

-- 4) Incidencias de consentimiento (veto / revisión humana)
CREATE TABLE IF NOT EXISTS public.wa_consent_incidencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES public.owners(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.wa_consent_signals(id) ON DELETE SET NULL,
  hs_call_id text,
  tipo text NOT NULL,
  motivos text[] NOT NULL DEFAULT '{}',
  detalle text,
  estado text NOT NULL DEFAULT 'abierta',
  resuelta_por uuid,
  resuelta_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.wa_consent_incidencias TO authenticated;
GRANT ALL ON public.wa_consent_incidencias TO service_role;

ALTER TABLE public.wa_consent_incidencias ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "equipo interno lee incidencias de consentimiento"
    ON public.wa_consent_incidencias FOR SELECT TO authenticated
    USING (auth.uid() IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "admin gestiona incidencias de consentimiento"
    ON public.wa_consent_incidencias FOR ALL TO authenticated
    USING (public.has_role(auth.uid(), 'admin'::public.app_role))
    WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_wa_consent_inc_owner ON public.wa_consent_incidencias (owner_id);
CREATE INDEX IF NOT EXISTS idx_wa_consent_inc_estado ON public.wa_consent_incidencias (estado);

DROP TRIGGER IF EXISTS trg_wa_consent_inc_updated ON public.wa_consent_incidencias;
CREATE TRIGGER trg_wa_consent_inc_updated
  BEFORE UPDATE ON public.wa_consent_incidencias
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
