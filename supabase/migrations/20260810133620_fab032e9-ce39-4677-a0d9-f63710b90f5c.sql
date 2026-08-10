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
    SELECT DISTINCT ON (entity) entity, status, error_message, finished_at
    FROM hubspot_sync_log
    WHERE entity <> 'integrity_watchdog'
    ORDER BY entity, coalesce(finished_at, started_at) DESC NULLS LAST
  ), sin_analizar AS (
    SELECT count(*) AS n FROM hubspot_calls hc
    WHERE nullif(hc.hs_call_transcription,'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM call_sessions cs WHERE cs.hubspot_call_id = hc.hs_id)
      AND EXISTS (
        SELECT 1 FROM unnest(hc.associated_contact_ids) AS cid
        JOIN external_ids e ON e.provider_id = cid AND e.entity_type = 'owner' AND e.provider = 'hubspot'
        JOIN building_owners bo ON bo.owner_id = e.entity_id)
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
    FROM ultimo_log l
    WHERE l.status = 'error' AND l.finished_at > now() - interval '7 days'
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

  DELETE FROM integrity_alert_log l
  WHERE NOT EXISTS (SELECT 1 FROM _problemas p WHERE p.k = l.issue_key);

  RETURN QUERY
  SELECT p.k, p.d, p.sev FROM _problemas p
  LEFT JOIN integrity_alert_log l ON l.issue_key = p.k
  WHERE l.last_sent_at IS NULL OR l.last_sent_at < now() - interval '6 hours';
END $$;