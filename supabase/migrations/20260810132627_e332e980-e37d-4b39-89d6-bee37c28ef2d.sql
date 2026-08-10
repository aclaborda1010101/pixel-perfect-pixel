-- =============== 0. Utilidad de normalización de direcciones ===============
CREATE OR REPLACE FUNCTION public.norm_addr(p text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(btrim(regexp_replace(
    regexp_replace(
      lower(translate(coalesce(p,''),'áéíóúüñàèìòùçÁÉÍÓÚÜÑÀÈÌÒÙÇ','aeiouunaeioucAEIOUUNAEIOUC')),
      '(^|[^a-z0-9])(calle|c/|avenida|avda|av|paseo|pº|plaza|pza|pl|camino|carrer|travesia|glorieta|ronda|de|del|la|las|los|el)([^a-z0-9]|$)',
      ' ', 'g'),
    '[^a-z0-9]+', ' ', 'g')), '')
$$;

-- =============== 1. Auditoría de enlaces HubSpot ===============
CREATE TABLE IF NOT EXISTS public.building_hs_deal_link_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  old_hs_deal_id text,
  new_hs_deal_id text,
  criterio text NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.building_hs_deal_link_audit TO authenticated;
GRANT ALL ON public.building_hs_deal_link_audit TO service_role;
ALTER TABLE public.building_hs_deal_link_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hs_link_audit_read" ON public.building_hs_deal_link_audit
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "hs_link_audit_admin_write" ON public.building_hs_deal_link_audit
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_hs_link_audit_building ON public.building_hs_deal_link_audit(building_id);

-- =============== 2. Modelo de saneamiento ===============
CREATE TABLE IF NOT EXISTS public.building_sanitation_reviews (
  building_id uuid PRIMARY KEY REFERENCES public.buildings(id) ON DELETE CASCADE,
  feedback_row integer,
  interest_status text NOT NULL DEFAULT 'active'
    CHECK (interest_status IN ('active','no_interest','discarded','review')),
  exclusion_reason text,
  note_status text NOT NULL DEFAULT 'unknown'
    CHECK (note_status IN ('unknown','requested','received','unusable','not_required')),
  note_requested_at timestamptz,
  ownership_kind text NOT NULL DEFAULT 'unknown'
    CHECK (ownership_kind IN ('person','company','mixed','unknown')),
  feedback_text text,
  source text NOT NULL DEFAULT 'feedback_jesus_2026-08-06',
  requires_human_review boolean NOT NULL DEFAULT false,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.building_sanitation_reviews TO authenticated;
GRANT ALL ON public.building_sanitation_reviews TO service_role;
ALTER TABLE public.building_sanitation_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sanitation_read" ON public.building_sanitation_reviews
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sanitation_admin_write" ON public.building_sanitation_reviews
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.building_sanitation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL,
  accion text NOT NULL,
  antes jsonb,
  despues jsonb,
  source text,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.building_sanitation_history TO authenticated;
GRANT ALL ON public.building_sanitation_history TO service_role;
ALTER TABLE public.building_sanitation_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sanitation_hist_read" ON public.building_sanitation_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "sanitation_hist_admin_write" ON public.building_sanitation_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX IF NOT EXISTS idx_sanitation_hist_building ON public.building_sanitation_history(building_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.trg_sanitation_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.updated_at := now();
  INSERT INTO public.building_sanitation_history(building_id, accion, antes, despues, source, changed_by)
  VALUES (NEW.building_id, TG_OP, CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
          to_jsonb(NEW), NEW.source, auth.uid());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_sanitation_audit ON public.building_sanitation_reviews;
CREATE TRIGGER trg_sanitation_audit BEFORE INSERT OR UPDATE ON public.building_sanitation_reviews
  FOR EACH ROW EXECUTE FUNCTION public.trg_sanitation_audit();

-- =============== 3. Derechos de propiedad ===============
CREATE TABLE IF NOT EXISTS public.building_property_rights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  note_simple_id uuid REFERENCES public.notas_simples(id) ON DELETE SET NULL,
  right_type text NOT NULL DEFAULT 'pleno_dominio'
    CHECK (right_type IN ('pleno_dominio','nuda_propiedad','usufructo','ganancial','otro')),
  percentage numeric CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  coownership_regime text,
  source_type text NOT NULL DEFAULT 'manual',
  source_ref text,
  evidence text,
  confidence numeric,
  valid_from date,
  valid_to date,
  verified_at timestamptz,
  verified_by uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','review','superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bpr_owner_xor_company CHECK ((owner_id IS NOT NULL)::int + (company_id IS NOT NULL)::int = 1)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_property_rights TO authenticated;
GRANT ALL ON public.building_property_rights TO service_role;
ALTER TABLE public.building_property_rights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bpr_read" ON public.building_property_rights
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "bpr_admin_write" ON public.building_property_rights
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE INDEX IF NOT EXISTS idx_bpr_building ON public.building_property_rights(building_id);
CREATE INDEX IF NOT EXISTS idx_bpr_owner ON public.building_property_rights(owner_id);
CREATE INDEX IF NOT EXISTS idx_bpr_company ON public.building_property_rights(company_id);

CREATE TABLE IF NOT EXISTS public.building_property_rights_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  right_id uuid,
  building_id uuid,
  accion text NOT NULL,
  antes jsonb,
  despues jsonb,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.building_property_rights_history TO authenticated;
GRANT ALL ON public.building_property_rights_history TO service_role;
ALTER TABLE public.building_property_rights_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bpr_hist_read" ON public.building_property_rights_history
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "bpr_hist_write" ON public.building_property_rights_history
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));

CREATE OR REPLACE FUNCTION public.trg_bpr_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.building_property_rights_history(right_id, building_id, accion, antes, changed_by)
    VALUES (OLD.id, OLD.building_id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  INSERT INTO public.building_property_rights_history(right_id, building_id, accion, antes, despues, changed_by)
  VALUES (NEW.id, NEW.building_id, TG_OP,
          CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW), auth.uid());
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_bpr_audit_iu ON public.building_property_rights;
CREATE TRIGGER trg_bpr_audit_iu BEFORE INSERT OR UPDATE ON public.building_property_rights
  FOR EACH ROW EXECUTE FUNCTION public.trg_bpr_audit();
DROP TRIGGER IF EXISTS trg_bpr_audit_d ON public.building_property_rights;
CREATE TRIGGER trg_bpr_audit_d BEFORE DELETE ON public.building_property_rights
  FOR EACH ROW EXECUTE FUNCTION public.trg_bpr_audit();

-- Resumen por capa de derecho (NO mezcla capas)
CREATE OR REPLACE VIEW public.v_building_rights_summary
WITH (security_invoker = true) AS
SELECT
  r.building_id,
  r.right_type,
  count(*)                                   AS n_titulares,
  count(*) FILTER (WHERE r.percentage IS NULL) AS n_sin_pct,
  round(sum(coalesce(r.percentage,0))::numeric, 2) AS suma_pct,
  (count(*) FILTER (WHERE r.percentage IS NULL) = 0
   AND sum(coalesce(r.percentage,0)) BETWEEN 99 AND 101) AS capa_completa
FROM public.building_property_rights r
WHERE r.status = 'active'
GROUP BY r.building_id, r.right_type;
GRANT SELECT ON public.v_building_rights_summary TO authenticated;

-- =============== 4. Cola de conciliación ===============
CREATE TABLE IF NOT EXISTS public.reconciliation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  nota_simple_id uuid,
  titular_id uuid,
  titular_nombre text,
  titular_cif_dni text,
  titular_pct numeric,
  match_kind text NOT NULL DEFAULT 'none' CHECK (match_kind IN ('dni_exacto','fuzzy','multiple','none')),
  match_owner_id uuid,
  match_company_id uuid,
  candidatos jsonb NOT NULL DEFAULT '[]'::jsonb,
  estado text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aplicado','descartado','revision')),
  motivo text,
  source text NOT NULL DEFAULT 'reconciliacion_determinista_2026-08-10',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_queue TO authenticated;
GRANT ALL ON public.reconciliation_queue TO service_role;
ALTER TABLE public.reconciliation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recq_read" ON public.reconciliation_queue
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "recq_admin_write" ON public.reconciliation_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_recq_titular ON public.reconciliation_queue(titular_id);
CREATE INDEX IF NOT EXISTS idx_recq_building ON public.reconciliation_queue(building_id);

-- =============== 5. Control de reintentos del reparse ===============
ALTER TABLE public.notas_simples
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS next_retry_at timestamptz,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS dead_letter boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_notas_reparse_queue
  ON public.notas_simples(next_retry_at) WHERE dead_letter = false;

CREATE OR REPLACE FUNCTION public.reparse_claim_batch(p_limit integer DEFAULT 12, p_lock_minutes integer DEFAULT 10)
RETURNS SETOF public.notas_simples
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notas_simples n SET claimed_at = now()
  WHERE n.id IN (
    SELECT c.id FROM public.notas_simples c
    WHERE c.status = 'listo'
      AND c.dead_letter = false
      AND (c.building_id IS NULL OR c.structured_json->>'needs_extract' = '1')
      AND coalesce(c.structured_json->>'reparse_done','') <> '1'
      AND (c.next_retry_at IS NULL OR c.next_retry_at <= now())
      AND (c.claimed_at IS NULL OR c.claimed_at < now() - make_interval(mins => p_lock_minutes))
    ORDER BY c.attempt_count ASC, c.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING n.*;
END $$;
GRANT EXECUTE ON FUNCTION public.reparse_claim_batch(integer,integer) TO service_role;

-- =============== 6. Vigía reescrito ===============
DROP FUNCTION IF EXISTS public.integridad_alertas_pendientes();
CREATE OR REPLACE FUNCTION public.integridad_alertas_pendientes()
RETURNS TABLE(issue_key text, detalle text, severidad text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  CREATE TEMP TABLE _problemas ON COMMIT DROP AS
  WITH esperados(entity, max_edad) AS (VALUES
    ('calls_inc', interval '20 minutes'), ('notes_inc', interval '20 minutes'),
    ('tasks_inc', interval '20 minutes'), ('communications_inc', interval '20 minutes'),
    ('meetings_inc', interval '20 minutes'), ('contacts_inc', interval '50 minutes'),
    ('deals_inc', interval '50 minutes'), ('companies_inc', interval '3 hours')
  ), estado AS (
    SELECT e.entity, e.max_edad, s.last_run_at, s.last_run_status, s.last_error
    FROM esperados e LEFT JOIN hubspot_sync_state s ON s.entity = e.entity
  ), ultimo_cron AS (
    SELECT DISTINCT ON (jobid) jobid, status, return_message, start_time
    FROM cron.job_run_details ORDER BY jobid, start_time DESC
  ), ultimo_log AS (
    -- ÚLTIMO log por entidad (no "cualquier error de 2h")
    SELECT DISTINCT ON (entity) entity, status, error_message, finished_at
    FROM hubspot_sync_log
    WHERE entity <> 'integrity_watchdog'
    ORDER BY entity, coalesce(finished_at, started_at) DESC NULLS LAST
  ), sin_analizar AS (
    SELECT count(*) AS n FROM hubspot_calls hc
    WHERE nullif(hc.hs_call_transcription,'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM call_sessions cs WHERE cs.hubspot_call_id = hc.hs_id)
      AND EXISTS (
        SELECT 1
        FROM unnest(hc.associated_contact_ids) AS cid
        JOIN external_ids e ON e.provider_id = cid AND e.entity_type = 'owner' AND e.provider = 'hubspot'
        JOIN building_owners bo ON bo.owner_id = e.entity_id
      )
  )
  SELECT k, d, sev FROM (
    SELECT 'sync_parado:'||e.entity AS k,
      'El flujo '||e.entity||' lleva sin correr desde '||
      coalesce(to_char(e.last_run_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI'),'nunca')||
      CASE WHEN e.last_run_status='error' THEN ' · ERROR: '||left(coalesce(e.last_error,''),150) ELSE '' END AS d,
      CASE WHEN e.last_run_status='error' THEN 'ERROR' ELSE 'AVISO' END AS sev
    FROM estado e
    WHERE (e.last_run_at IS NULL AND e.entity IN ('calls_inc','notes_inc','tasks_inc','contacts_inc'))
       OR (e.last_run_at IS NOT NULL AND e.last_run_at < now() - e.max_edad)
       OR e.last_run_status = 'error'
    UNION ALL
    SELECT 'cron_fallando:'||j.jobname,
      'El cron '||j.jobname||' falló el '||to_char(u.start_time AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')||': '||left(coalesce(u.return_message,''),150),
      'ERROR'
    FROM cron.job j JOIN ultimo_cron u ON u.jobid = j.jobid
    WHERE j.active AND u.status = 'failed' AND u.start_time > now() - interval '24 hours'
    UNION ALL
    SELECT 'proceso_en_error:'||l.entity,
      'El último intento de '||l.entity||' ('||to_char(l.finished_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')||') falló: '||left(coalesce(l.error_message,''),200),
      'ERROR'
    FROM ultimo_log l WHERE l.status = 'error'
    UNION ALL
    SELECT 'sin_llamadas_48h',
      'No entra ninguna llamada nueva desde '||to_char(max(hs_timestamp) AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI'),
      'AVISO'
    FROM hubspot_calls HAVING max(hs_timestamp) < now() - interval '48 hours'
    UNION ALL
    SELECT 'llamadas_sin_analizar',
      'Hay '||n||' llamadas transcritas de propietarios nuestros SIN análisis ni score', 'CALIDAD'
    FROM sin_analizar WHERE n > 25
    UNION ALL
    SELECT 'notas_sin_volcar_pct',
      'Hay '||count(*)||' edificios con nota simple y titulares con % pero SIN porcentajes en la ficha', 'CALIDAD'
    FROM buildings b
    WHERE EXISTS (SELECT 1 FROM nota_simple_titulares t JOIN notas_simples n ON n.id = t.nota_simple_id
                  WHERE n.building_id = b.id AND t.porcentaje IS NOT NULL)
      AND NOT EXISTS (SELECT 1 FROM building_owners bo WHERE bo.building_id = b.id AND bo.cuota IS NOT NULL)
    HAVING count(*) > 30
    UNION ALL
    SELECT 'reparse_dead_letter',
      'Hay '||count(*)||' notas simples descartadas tras 5 intentos fallidos de relectura', 'CALIDAD'
    FROM notas_simples WHERE dead_letter HAVING count(*) > 0
    UNION ALL
    SELECT 'consentimientos_desincronizados',
      'Hay '||count(*)||' consentimientos de WhatsApp sin reflejar en la ficha del propietario', 'CALIDAD'
    FROM wa_consent_signals w JOIN owners o ON o.id = w.owner_id
    WHERE w.veredicto = 'autorizado' AND coalesce(o.consentimiento,false) = false
    HAVING count(*) > 0
    UNION ALL
    SELECT 'wa_sin_escribir_hubspot',
      'Hay '||count(*)||' consentimientos autorizados sin escribir en HubSpot', 'AVISO'
    FROM wa_consent_signals WHERE veredicto = 'autorizado' AND NOT escrito_en_hubspot
    HAVING count(*) > 5
  ) q(k, d, sev);

  -- Autocierre: las claves que ya no aparecen dejan de estar silenciadas
  DELETE FROM integrity_alert_log l
  WHERE NOT EXISTS (SELECT 1 FROM _problemas p WHERE p.k = l.issue_key);

  RETURN QUERY
  SELECT p.k, p.d, p.sev FROM _problemas p
  LEFT JOIN integrity_alert_log l ON l.issue_key = p.k
  WHERE l.last_sent_at IS NULL OR l.last_sent_at < now() - interval '6 hours';
END $$;
GRANT EXECUTE ON FUNCTION public.integridad_alertas_pendientes() TO authenticated, service_role;