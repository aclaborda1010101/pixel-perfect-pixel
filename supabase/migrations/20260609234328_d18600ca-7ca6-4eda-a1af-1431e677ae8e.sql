CREATE TABLE IF NOT EXISTS public.call_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercial_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  building_id uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  paso int NOT NULL DEFAULT 1,
  objetivo text,
  checklist jsonb NOT NULL DEFAULT '[]'::jsonb,
  voss_brief jsonb,
  voss_post jsonb,
  resultado text,
  notas text,
  call_id uuid REFERENCES public.calls(id) ON DELETE SET NULL,
  iniciada_at timestamptz NOT NULL DEFAULT now(),
  cerrada_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_sessions_comercial ON public.call_sessions(comercial_id, iniciada_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_sessions_owner ON public.call_sessions(owner_id);
CREATE INDEX IF NOT EXISTS idx_call_sessions_building ON public.call_sessions(building_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_sessions TO authenticated;
GRANT ALL ON public.call_sessions TO service_role;

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own_or_admin" ON public.call_sessions
  FOR SELECT TO authenticated
  USING (comercial_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "sessions_insert_own" ON public.call_sessions
  FOR INSERT TO authenticated
  WITH CHECK (comercial_id = auth.uid());
CREATE POLICY "sessions_update_own" ON public.call_sessions
  FOR UPDATE TO authenticated
  USING (comercial_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (comercial_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "sessions_delete_own" ON public.call_sessions
  FOR DELETE TO authenticated
  USING (comercial_id = auth.uid() OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_call_sessions_updated_at BEFORE UPDATE ON public.call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE VIEW public.v_kpis_comercial_semana AS
WITH base AS (
  SELECT
    COALESCE(c.comercial_hs_id, c.comercial_email, 'desconocido') AS comercial_key,
    COALESCE(c.comercial_nombre, c.comercial_email, 'Sin nombre') AS comercial_nombre,
    date_trunc('week', c.fecha)::date AS semana,
    c.id, c.duracion_seg, c.tecnica_score, c.outcome,
    c.metadatos
  FROM public.calls c
  WHERE c.fecha >= (now() - interval '12 weeks')
)
SELECT
  comercial_key,
  max(comercial_nombre) AS comercial_nombre,
  semana,
  count(*) AS llamadas_total,
  count(*) FILTER (WHERE duracion_seg > 60) AS llamadas_mayor_1min,
  ROUND(100.0 * count(*) FILTER (WHERE duracion_seg > 60) / NULLIF(count(*),0), 1) AS pct_mayor_1min,
  ROUND(avg(duracion_seg)::numeric, 0) AS duracion_media_seg,
  ROUND(avg(tecnica_score)::numeric, 2) AS calidad_media,
  count(*) FILTER (WHERE outcome = 'interesado') AS interesados,
  count(*) FILTER (WHERE outcome = 'volver') AS seguimientos,
  count(*) FILTER (WHERE (metadatos->>'whatsapp_enviado')::boolean IS TRUE) AS whatsapp_enviados,
  count(*) FILTER (WHERE (metadatos->>'pixel_enviado')::boolean IS TRUE) AS pixels_enviados,
  count(*) FILTER (WHERE (metadatos->>'reunion_cerrada')::boolean IS TRUE) AS reuniones_cerradas
FROM base
GROUP BY comercial_key, semana;

GRANT SELECT ON public.v_kpis_comercial_semana TO authenticated;

CREATE OR REPLACE VIEW public.v_call_queue_daily AS
WITH owner_signal AS (
  SELECT
    bo.building_id,
    bo.owner_id,
    o.nombre,
    o.telefono,
    bo.cuota,
    COALESCE(vbs.score, 0) AS score_edificio,
    COALESCE(vos.score, 0) AS score_owner,
    COALESCE(vos.contactos_previos, 0) AS contactos_previos,
    vos.last_call_at,
    CASE
      WHEN vos.last_call_at IS NULL THEN 'cold'
      WHEN vos.last_call_at > now() - interval '60 days' THEN 'hot'
      ELSE 'cold'
    END AS temperatura,
    GREATEST(0, EXTRACT(epoch FROM (now() - COALESCE(vos.last_call_at, now() - interval '365 days'))) / 86400 - 30) AS dias_cadencia_vencida
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id
  LEFT JOIN public.v_building_score vbs ON vbs.id = bo.building_id
  LEFT JOIN public.v_owner_score vos ON vos.owner_id = bo.owner_id
  WHERE o.telefono IS NOT NULL AND o.telefono <> ''
)
SELECT
  *,
  ROUND((score_edificio * GREATEST(score_owner, 1) * (1 + dias_cadencia_vencida / 30.0))::numeric, 2) AS prioridad
FROM owner_signal
ORDER BY prioridad DESC;

GRANT SELECT ON public.v_call_queue_daily TO authenticated;