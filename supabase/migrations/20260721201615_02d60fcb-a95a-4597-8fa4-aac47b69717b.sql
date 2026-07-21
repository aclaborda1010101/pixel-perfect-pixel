
-- ============================================================
-- Bloque reunión 21/07 · Tanda B + C · esquema
-- ============================================================

-- ---------- 1) Tanda B · punto 5 · reintentos post-llamada ----------
ALTER TABLE public.call_sessions
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS retries_left  integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_call_sessions_next_retry
  ON public.call_sessions (next_retry_at)
  WHERE next_retry_at IS NOT NULL AND estado <> 'finalizada';


-- ---------- 2) Tanda B · punto 2 · vista owner_kpis_state ----------
-- Devuelve, para cada owner y cada KPI (tipologia/motor/info_edificio/canal_abierto
-- + los "fantasma" whatsapp/pixel/reunion), la primera vez que se marcó done=true.
CREATE OR REPLACE VIEW public.owner_kpis_state AS
WITH kpi_events AS (
  -- Checklist de sesiones finalizadas
  SELECT
    cs.owner_id,
    (item->>'k')::text                       AS k,
    LEAST(cs.finalizada_at, cs.cerrada_at, cs.updated_at) AS at,
    cs.hubspot_call_id
  FROM public.call_sessions cs,
       LATERAL jsonb_array_elements(COALESCE(cs.checklist, '[]'::jsonb)) item
  WHERE cs.estado = 'finalizada'
    AND (item->>'done')::boolean IS TRUE
    AND cs.owner_id IS NOT NULL

  UNION ALL
  -- KPIs "fantasma" desde calls.metadatos
  SELECT c.owner_id, 'whatsapp'::text AS k, c.fecha, (c.metadatos->>'hubspot_call_id')
    FROM public.calls c
    WHERE c.owner_id IS NOT NULL AND (c.metadatos->>'whatsapp_enviado')::boolean IS TRUE
  UNION ALL
  SELECT c.owner_id, 'pixel'::text, c.fecha, (c.metadatos->>'hubspot_call_id')
    FROM public.calls c
    WHERE c.owner_id IS NOT NULL AND (c.metadatos->>'pixel_enviado')::boolean IS TRUE
  UNION ALL
  SELECT c.owner_id, 'reunion'::text, c.fecha, (c.metadatos->>'hubspot_call_id')
    FROM public.calls c
    WHERE c.owner_id IS NOT NULL AND (c.metadatos->>'reunion_cerrada')::boolean IS TRUE
)
SELECT
  owner_id,
  k,
  MIN(at)                                    AS first_done_at,
  (ARRAY_AGG(hubspot_call_id ORDER BY at ASC))[1] AS first_hubspot_call_id,
  COUNT(*)                                   AS times_done
FROM kpi_events
WHERE at IS NOT NULL
GROUP BY owner_id, k;

GRANT SELECT ON public.owner_kpis_state TO authenticated, service_role;


-- ---------- 3) Tanda B · punto 3 · info compartida del edificio ----------
-- Agrega, por edificio, señales que salen de las llamadas de TODOS sus
-- propietarios: precio/oferta discutida, bloqueadores, gestor/portavoz,
-- conflicto, estado de venta.  Se lee de voss_post.
CREATE OR REPLACE VIEW public.v_building_common_intel AS
WITH sessions AS (
  SELECT
    cs.building_id,
    cs.owner_id,
    cs.finalizada_at,
    cs.voss_post,
    cs.hubspot_call_id
  FROM public.call_sessions cs
  WHERE cs.estado = 'finalizada'
    AND cs.building_id IS NOT NULL
    AND cs.voss_post IS NOT NULL
),
-- Extraer números que aparezcan en oferta/precio (busca el nodo intel_edificio o
-- inteligencia_edificio si el prompt lo emite; si no, hace fallback al texto).
prices AS (
  SELECT
    s.building_id,
    s.owner_id,
    s.finalizada_at AS at,
    s.hubspot_call_id,
    NULLIF(regexp_replace(
      COALESCE(
        s.voss_post #>> '{intel_edificio,precio_o_oferta}',
        s.voss_post #>> '{inteligencia_edificio,precio_o_oferta}',
        ''
      ),
      '[^0-9]', '', 'g'
    ), '')::bigint AS amount,
    COALESCE(
      s.voss_post #>> '{intel_edificio,precio_o_oferta}',
      s.voss_post #>> '{inteligencia_edificio,precio_o_oferta}'
    ) AS raw
  FROM sessions s
),
blockers AS (
  SELECT
    s.building_id,
    s.owner_id,
    s.finalizada_at AS at,
    COALESCE(
      s.voss_post #>> '{intel_edificio,bloqueador}',
      s.voss_post #>> '{inteligencia_edificio,bloqueador}'
    ) AS bloqueador,
    COALESCE(
      s.voss_post #>> '{intel_edificio,gestor}',
      s.voss_post #>> '{inteligencia_edificio,gestor}',
      s.voss_post #>> '{intel_edificio,portavoz}'
    ) AS gestor,
    COALESCE(
      s.voss_post #>> '{intel_edificio,conflicto}',
      s.voss_post #>> '{inteligencia_edificio,conflicto}'
    ) AS conflicto,
    COALESCE(
      s.voss_post #>> '{intel_edificio,estado_venta}',
      s.voss_post #>> '{inteligencia_edificio,estado_venta}'
    ) AS estado_venta
  FROM sessions s
),
price_agg AS (
  SELECT
    building_id,
    jsonb_agg(jsonb_build_object(
      'owner_id', owner_id,
      'at', at,
      'hubspot_call_id', hubspot_call_id,
      'amount', amount,
      'raw', raw
    ) ORDER BY at DESC) FILTER (WHERE raw IS NOT NULL AND raw <> '') AS mentions,
    MIN(amount) FILTER (WHERE amount IS NOT NULL) AS min_amount,
    MAX(amount) FILTER (WHERE amount IS NOT NULL) AS max_amount,
    COUNT(DISTINCT amount) FILTER (WHERE amount IS NOT NULL) AS distinct_amounts
  FROM prices
  GROUP BY building_id
)
SELECT
  b.building_id,
  COALESCE(pa.mentions, '[]'::jsonb) AS precios_mencionados,
  pa.min_amount,
  pa.max_amount,
  CASE
    WHEN pa.min_amount IS NOT NULL AND pa.max_amount IS NOT NULL
     AND (
       (pa.max_amount - pa.min_amount) > 500000
       OR (pa.max_amount - pa.min_amount)::numeric / NULLIF(pa.min_amount,0) > 0.10
     )
    THEN true ELSE false
  END AS precio_discrepancia,
  (SELECT jsonb_agg(DISTINCT jsonb_build_object('at', at, 'owner_id', owner_id, 'texto', bloqueador))
     FROM blockers bl WHERE bl.building_id = b.building_id AND bloqueador IS NOT NULL AND bloqueador <> '') AS bloqueadores,
  (SELECT jsonb_agg(DISTINCT jsonb_build_object('at', at, 'owner_id', owner_id, 'texto', gestor))
     FROM blockers bl WHERE bl.building_id = b.building_id AND gestor IS NOT NULL AND gestor <> '') AS gestores,
  (SELECT jsonb_agg(DISTINCT jsonb_build_object('at', at, 'owner_id', owner_id, 'texto', conflicto))
     FROM blockers bl WHERE bl.building_id = b.building_id AND conflicto IS NOT NULL AND conflicto <> '') AS conflictos,
  (SELECT jsonb_agg(DISTINCT jsonb_build_object('at', at, 'owner_id', owner_id, 'texto', estado_venta))
     FROM blockers bl WHERE bl.building_id = b.building_id AND estado_venta IS NOT NULL AND estado_venta <> '') AS estados_venta
FROM (SELECT DISTINCT building_id FROM sessions) b
LEFT JOIN price_agg pa USING (building_id);

GRANT SELECT ON public.v_building_common_intel TO authenticated, service_role;


-- ---------- 4) Tanda C · punto 8 · seed de auto-asignación por zona ----------
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'oportunidades_zone_assignments',
  jsonb_build_object(
    'default_owner_email', 'jesus.anzola@afflux.es',
    'zones', jsonb_build_array(
      jsonb_build_object('email','david.casero@afflux.es','name','David',
        'terms', jsonb_build_array('vallecas','carabanchel','chamberí','chamberi')),
      jsonb_build_object('email','jesus.anzola@afflux.es','name','Jesús',
        'terms', jsonb_build_array('salamanca','centro'))
    )
  ),
  now()
)
ON CONFLICT (key) DO NOTHING;


-- ---------- 5) Tanda C · punto 9 · pausas del bot ----------
ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz;

ALTER TABLE public.wa_bot_config
  ADD COLUMN IF NOT EXISTS stop_words jsonb NOT NULL DEFAULT
    jsonb_build_array('quedamos así','cerrado','gracias, hablamos');

-- Trigger: si entra un outbound con sender_type != 'bot', pausa la IA.
CREATE OR REPLACE FUNCTION public.wa_pause_bot_on_human_outbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.direction = 'out'
     AND COALESCE(NEW.sender_type, 'bot') <> 'bot'
     AND NEW.conversation_id IS NOT NULL THEN
    UPDATE public.wa_conversations
      SET ai_enabled       = false,
          bot_paused_until = now() + interval '24 hours',
          handoff_reason   = COALESCE(handoff_reason, 'human_outbound'),
          updated_at       = now()
      WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_wa_pause_bot_on_human_outbound ON public.wa_messages;
CREATE TRIGGER trg_wa_pause_bot_on_human_outbound
AFTER INSERT ON public.wa_messages
FOR EACH ROW
EXECUTE FUNCTION public.wa_pause_bot_on_human_outbound();
