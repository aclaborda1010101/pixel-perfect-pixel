-- 1) Utilidad de evidencia registral trazable
CREATE OR REPLACE FUNCTION public.nota_evidence_snippet(p_nota_id uuid, p_nombre text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_txt text; v_key text; v_pos int := 0; v_snip text;
BEGIN
  SELECT raw_pdf_text INTO v_txt FROM notas_simples WHERE id = p_nota_id;
  IF v_txt IS NULL OR length(v_txt) < 20 OR p_nombre IS NULL THEN
    RETURN jsonb_build_object('nota_simple_id', p_nota_id, 'encontrado', false, 'fuente', 'structured_json');
  END IF;
  v_key := upper(btrim(left(regexp_replace(p_nombre, '\s*\(.*$', ''), 24)));
  v_pos := position(v_key in upper(v_txt));
  IF v_pos = 0 THEN
    v_key := upper(split_part(btrim(p_nombre), ' ', 1));
    IF length(v_key) >= 4 THEN v_pos := position(v_key in upper(v_txt)); END IF;
  END IF;
  IF v_pos = 0 THEN
    RETURN jsonb_build_object('nota_simple_id', p_nota_id, 'encontrado', false, 'fuente', 'raw_pdf_text');
  END IF;
  v_snip := btrim(regexp_replace(substr(v_txt, greatest(1, v_pos - 160), 440), '\s+', ' ', 'g'));
  RETURN jsonb_build_object(
    'nota_simple_id', p_nota_id, 'encontrado', true, 'fuente', 'raw_pdf_text',
    'char_offset', v_pos, 'cita', v_snip);
END $$;

-- 2) Reconstrucción de derechos con tipo, régimen, evidencia y revisión
CREATE OR REPLACE FUNCTION public.p0_rebuild_property_rights(p_reason text DEFAULT 'fase2_p0')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_arch int; v_ins int;
BEGIN
  INSERT INTO public.building_property_rights_archive(reason, row_data)
  SELECT p_reason, to_jsonb(r) FROM public.building_property_rights r;
  GET DIAGNOSTICS v_arch = ROW_COUNT;

  DELETE FROM public.building_property_rights;

  WITH tit AS (
    SELECT t.id AS titular_id, ns.id AS nota_id, ns.building_id,
           t.nombre_extraido,
           nullif(upper(regexp_replace(coalesce(t.cif_dni,''),'[^A-Za-z0-9]','','g')),'') AS dni,
           t.porcentaje,
           t.rol::text AS rol,
           coalesce(t.rol_literal, t.metadatos->>'rol_literal') AS rol_literal,
           t.company_id,
           public.norm_person_name(t.nombre_extraido) AS nn
    FROM public.nota_simple_titulares t
    JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
    WHERE ns.building_id IS NOT NULL
  ),
  clasif AS (
    SELECT tit.*,
      lower(coalesce(tit.rol_literal,'')) AS lit,
      CASE
        WHEN tit.rol = 'ganancial'
          OR coalesce(tit.rol_literal,'') ~* '(car[áa]cter\s+ganancial|gananciales?|sociedad\s+conyugal)'
          OR tit.nombre_extraido ~* '(SOCIEDAD\s+CONYUGAL|GANANCIAL)' THEN 'ganancial'
        WHEN tit.rol = 'pleno' OR coalesce(tit.rol_literal,'') ~* 'pleno\s*dominio' THEN 'pleno_dominio'
        WHEN tit.rol = 'nuda_propiedad' OR coalesce(tit.rol_literal,'') ~* 'nuda\s*propiedad' THEN 'nuda_propiedad'
        WHEN tit.rol = 'usufructo' OR coalesce(tit.rol_literal,'') ~* 'usufruct' THEN 'usufructo'
        ELSE 'otro'
      END AS right_type,
      CASE WHEN tit.nombre_extraido ~* '(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|CAPITAL)\M'
                OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]'
           THEN true ELSE false END AS es_sociedad
    FROM tit
  ),
  capa AS (
    SELECT nota_id, right_type, count(*) AS n_capa FROM clasif GROUP BY nota_id, right_type
  ),
  m_dni AS (
    SELECT c.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
    FROM clasif c
    JOIN public.owners o
      ON nullif(upper(regexp_replace(coalesce(o.metadatos->>'dni__nif__cif',''),'[^A-Za-z0-9]','','g')),'') = c.dni
    WHERE c.dni IS NOT NULL AND o.merged_into IS NULL
    GROUP BY c.titular_id
  ),
  m_nom AS (
    SELECT c.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
    FROM clasif c
    JOIN public.owners o ON public.norm_person_name(o.nombre) = c.nn
    WHERE c.nn IS NOT NULL AND o.merged_into IS NULL
    GROUP BY c.titular_id
  ),
  m_comp AS (
    SELECT c.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
    FROM clasif c
    JOIN public.companies k ON public.norm_person_name(k.nombre) = c.nn
    WHERE c.es_sociedad AND c.nn IS NOT NULL
    GROUP BY c.titular_id
  ),
  final AS (
    SELECT c.*, cp.n_capa,
      CASE WHEN c.es_sociedad THEN coalesce(c.company_id, CASE WHEN mc.n = 1 THEN mc.company_id END) ELSE c.company_id END AS f_company_id,
      CASE WHEN NOT c.es_sociedad THEN CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id ELSE NULL END END AS f_owner_id,
      CASE
        WHEN c.es_sociedad THEN CASE WHEN c.company_id IS NOT NULL OR mc.n = 1 THEN 'nombre_exacto' ELSE 'ninguno' END
        WHEN md.n = 1 THEN 'dni'
        WHEN mn.n = 1 THEN 'nombre_exacto'
        WHEN md.n > 1 OR mn.n > 1 THEN 'aproximado'
        ELSE 'ninguno'
      END AS f_identity,
      CASE WHEN md.n = 1 THEN 1.0 WHEN mn.n = 1 THEN 0.8 ELSE 0.4 END AS f_conf,
      public.nota_evidence_snippet(c.nota_id, c.nombre_extraido) AS ev
    FROM clasif c
    LEFT JOIN capa cp ON cp.nota_id = c.nota_id AND cp.right_type = c.right_type
    LEFT JOIN m_dni md ON md.titular_id = c.titular_id
    LEFT JOIN m_nom mn ON mn.titular_id = c.titular_id
    LEFT JOIN m_comp mc ON mc.titular_id = c.titular_id
  )
  INSERT INTO public.building_property_rights (
    building_id, owner_id, company_id, note_simple_id, titular_id, titular_nombre, titular_dni,
    right_type, percentage, coownership_regime, cotitulares,
    source_type, source_ref, evidence, evidence_ref, right_literal,
    identity_match, confidence, status, review_flag, review_reason, feeds_cuota, blocked_reason
  )
  SELECT
    f.building_id, f.f_owner_id, f.f_company_id, f.nota_id, f.titular_id, f.nombre_extraido, f.dni,
    f.right_type, f.porcentaje,
    CASE
      WHEN f.right_type = 'ganancial' THEN 'gananciales'
      WHEN f.n_capa > 1 THEN 'proindiviso'
      WHEN f.n_capa = 1 AND f.porcentaje IS NOT NULL AND abs(f.porcentaje - 100) <= 0.5 THEN 'privativo'
      ELSE 'desconocido'
    END,
    CASE WHEN f.right_type = 'ganancial'
         THEN (SELECT array_agg(btrim(x)) FROM unnest(regexp_split_to_array(
                 regexp_replace(f.nombre_extraido, '\s*\((SOCIEDAD\s+CONYUGAL|GANANCIALES?)\)\s*', '', 'gi'),
                 '\s+Y\s+')) x WHERE btrim(x) <> '')
    END,
    'nota_simple',
    'titular:' || f.titular_id::text || '|nota:' || f.nota_id::text,
    'Nota simple ' || f.nota_id::text || ' · titular literal: "' || f.nombre_extraido ||
      '" · derecho: ' || f.right_type || coalesce(' ("' || f.rol_literal || '")','') ||
      ' · porcentaje declarado: ' || coalesce(f.porcentaje::text,'(sin dato)') ||
      CASE WHEN (f.ev->>'encontrado')::boolean THEN ' · cita registral: «' || (f.ev->>'cita') || '»'
           ELSE ' · SIN cita literal localizada en el texto de la nota' END,
    f.ev, f.rol_literal,
    f.f_identity, f.f_conf, 'active',
    -- revisión obligatoria
    (f.right_type = 'otro')
      OR (f.right_type = 'ganancial')
      OR ((f.ev->>'encontrado')::boolean IS DISTINCT FROM true)
      OR (f.rol_literal IS NOT NULL AND f.right_type = 'pleno_dominio' AND f.rol_literal !~* 'pleno')
      OR (f.porcentaje IS NULL),
    nullif(concat_ws(' · ',
      CASE WHEN f.right_type = 'otro' THEN 'rol no reconocido en la nota (no se asume pleno dominio)' END,
      CASE WHEN f.right_type = 'ganancial' THEN 'carácter ganancial: no se reparte entre cónyuges, requiere validación' END,
      CASE WHEN (f.ev->>'encontrado')::boolean IS DISTINCT FROM true THEN 'sin cita literal trazable en la nota' END,
      CASE WHEN f.rol_literal IS NOT NULL AND f.right_type = 'pleno_dominio' AND f.rol_literal !~* 'pleno' THEN 'contradicción entre texto literal y rol clasificado' END,
      CASE WHEN f.porcentaje IS NULL THEN 'porcentaje ausente en la nota' END
    ), ''),
    false, NULL
  FROM final f;

  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- feeds_cuota solo en casos seguros
  UPDATE public.building_property_rights r
     SET feeds_cuota = true, blocked_reason = NULL
   WHERE r.status = 'active' AND NOT r.review_flag
     AND r.right_type = 'pleno_dominio' AND r.identity_match = 'dni' AND r.owner_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.v_building_rights_status s
                 WHERE s.building_id = r.building_id AND s.apto_para_cuota);

  UPDATE public.building_property_rights r
     SET blocked_reason = coalesce(r.review_reason, 'no cumple pleno dominio + identidad por DNI + capa completa')
   WHERE NOT r.feeds_cuota AND r.blocked_reason IS NULL;

  RETURN jsonb_build_object('archivadas', v_arch, 'insertadas', v_ins);
END $$;

-- 3) Elegibilidad de cuota endurecida
CREATE OR REPLACE VIEW public.v_rights_cuota_eligible AS
SELECT r.building_id, r.owner_id, r.percentage AS pct_pleno, r.note_simple_id, r.titular_id, r.evidence
FROM public.building_property_rights r
JOIN public.v_building_rights_status s ON s.building_id = r.building_id
WHERE r.status = 'active'
  AND r.right_type = 'pleno_dominio'
  AND r.identity_match = 'dni'
  AND r.owner_id IS NOT NULL
  AND NOT r.review_flag
  AND (r.evidence_ref->>'encontrado')::boolean IS TRUE
  AND r.percentage IS NOT NULL
  AND s.apto_para_cuota;

-- 4) Auditoría 1:1 derecho ↔ titular de la nota
CREATE OR REPLACE VIEW public.v_rights_audit_1to1 AS
SELECT r.id AS right_id, r.building_id, b.direccion, r.note_simple_id,
       r.titular_id, r.titular_nombre, r.titular_dni,
       r.right_type, r.percentage, r.coownership_regime, r.identity_match,
       r.right_literal, t.rol::text AS rol_nota, t.porcentaje AS pct_nota, t.nombre_extraido AS nombre_nota,
       (r.evidence_ref->>'encontrado')::boolean AS evidencia_localizada,
       left(coalesce(r.evidence_ref->>'cita', r.evidence), 400) AS evidencia,
       r.review_flag, r.review_reason, r.feeds_cuota,
       CASE
         WHEN t.id IS NULL THEN 'huerfano'
         WHEN r.right_type = 'otro' THEN 'review'
         WHEN r.right_type = 'ganancial' THEN 'review'
         WHEN r.percentage IS DISTINCT FROM t.porcentaje THEN 'conflicto_pct'
         WHEN public.norm_person_name(r.titular_nombre) IS DISTINCT FROM public.norm_person_name(t.nombre_extraido) THEN 'conflicto_nombre'
         WHEN r.review_flag THEN 'review'
         ELSE 'ok'
       END AS estado_auditoria
FROM public.building_property_rights r
LEFT JOIN public.nota_simple_titulares t ON t.id = r.titular_id
LEFT JOIN public.buildings b ON b.id = r.building_id
WHERE r.status = 'active';

-- 5) Auditoría (no destructiva) de las cuotas operativas
CREATE OR REPLACE FUNCTION public.audit_building_owner_cuotas()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  WITH elig AS (SELECT building_id, owner_id, pct_pleno FROM public.v_rights_cuota_eligible),
  otros AS (
    SELECT DISTINCT building_id, owner_id FROM public.building_property_rights
    WHERE status='active' AND owner_id IS NOT NULL AND right_type <> 'pleno_dominio'
  ),
  calc AS (
    SELECT bo.building_id, bo.owner_id, bo.cuota, e.pct_pleno,
      CASE
        WHEN bo.cuota IS NULL THEN 'sin_auditar'
        WHEN e.pct_pleno IS NOT NULL AND abs(bo.cuota - e.pct_pleno) <= 0.5 THEN 'vigente'
        WHEN e.pct_pleno IS NOT NULL THEN 'superseded'
        WHEN o.owner_id IS NOT NULL THEN 'review'
        ELSE 'review'
      END AS est,
      CASE
        WHEN bo.cuota IS NULL THEN NULL
        WHEN e.pct_pleno IS NOT NULL AND abs(bo.cuota - e.pct_pleno) <= 0.5 THEN 'coincide con pleno dominio verificado en nota simple'
        WHEN e.pct_pleno IS NOT NULL THEN 'la nota simple declara ' || e.pct_pleno::text || '% en pleno dominio; cuota operativa conservada pero no usable'
        WHEN o.owner_id IS NOT NULL THEN 'el titular solo tiene derechos no plenos (usufructo/nuda/ganancial/otro)'
        ELSE 'sin derecho vigente de pleno dominio con identidad inequívoca y capa completa'
      END AS motivo
    FROM public.building_owners bo
    LEFT JOIN elig e ON e.building_id = bo.building_id AND e.owner_id = bo.owner_id
    LEFT JOIN otros o ON o.building_id = bo.building_id AND o.owner_id = bo.owner_id
  )
  UPDATE public.building_owners bo
     SET cuota_estado = c.est,
         cuota_estado_motivo = c.motivo,
         cuota_auditada_at = now(),
         metadatos = coalesce(bo.metadatos,'{}'::jsonb) || jsonb_build_object(
           'cuota_auditoria', jsonb_build_object(
             'cuota_operativa', bo.cuota, 'pct_registral_pleno', c.pct_pleno,
             'estado', c.est, 'motivo', c.motivo, 'at', now()))
    FROM calc c
   WHERE c.building_id = bo.building_id AND c.owner_id = bo.owner_id;

  SELECT jsonb_object_agg(cuota_estado, n) INTO v
  FROM (SELECT cuota_estado, count(*) n FROM public.building_owners GROUP BY 1) s;
  RETURN coalesce(v,'{}'::jsonb);
END $$;

-- 6) Gate explícito de score
CREATE OR REPLACE VIEW public.v_building_score_gate AS
WITH r AS (
  SELECT building_id,
         count(*) FILTER (WHERE right_type = 'otro') AS n_otro,
         count(*) FILTER (WHERE review_flag) AS n_review,
         count(*) FILTER (WHERE feeds_cuota) AS n_ok
  FROM public.building_property_rights WHERE status='active' GROUP BY building_id
), c AS (
  SELECT building_id,
         count(*) FILTER (WHERE cuota_estado IN ('review','superseded')) AS n_cuota_mala,
         count(*) FILTER (WHERE cuota_estado = 'vigente') AS n_cuota_ok
  FROM public.building_owners GROUP BY building_id
)
SELECT b.id AS building_id, b.direccion,
  coalesce(r.n_ok,0) AS derechos_usables,
  coalesce(r.n_review,0) AS derechos_en_revision,
  coalesce(r.n_otro,0) AS derechos_sin_clasificar,
  coalesce(c.n_cuota_ok,0) AS cuotas_vigentes,
  coalesce(c.n_cuota_mala,0) AS cuotas_no_usables,
  array_remove(ARRAY[
    CASE WHEN coalesce(r.n_ok,0) = 0 THEN 'sin_pleno_dominio_verificado' END,
    CASE WHEN coalesce(r.n_otro,0) > 0 THEN 'derechos_sin_clasificar' END,
    CASE WHEN coalesce(r.n_review,0) > 0 THEN 'derechos_en_revision' END,
    CASE WHEN coalesce(c.n_cuota_mala,0) > 0 THEN 'cuotas_operativas_contradictorias' END,
    CASE WHEN NOT coalesce(s.apto_para_cuota,false) THEN 'capa_registral_incompleta' END
  ], NULL) AS motivos,
  (coalesce(r.n_ok,0) = 0 OR coalesce(r.n_otro,0) > 0 OR coalesce(r.n_review,0) > 0
   OR coalesce(c.n_cuota_mala,0) > 0 OR NOT coalesce(s.apto_para_cuota,false)) AS score_bloqueado
FROM public.buildings b
LEFT JOIN r ON r.building_id = b.id
LEFT JOIN c ON c.building_id = b.id
LEFT JOIN public.v_building_rights_status s ON s.building_id = b.id;

GRANT SELECT ON public.v_building_score_gate TO authenticated, anon;
GRANT SELECT ON public.v_rights_audit_1to1 TO authenticated, anon;

-- 7) Reconciliación: candidatos vs aplicables
CREATE OR REPLACE FUNCTION public.reconciliation_mark_candidates()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v jsonb;
BEGIN
  UPDATE public.reconciliation_queue q
     SET apto_auto = req.apto,
         requisitos = req.det,
         estado = CASE WHEN q.estado IN ('aplicado','descartado') THEN q.estado ELSE 'candidato' END,
         updated_at = now()
  FROM (
    SELECT q2.id,
      jsonb_build_object(
        'dni_exacto', q2.match_kind = 'dni_exacto',
        'nota_del_edificio', ns.building_id IS NOT DISTINCT FROM q2.building_id,
        'nota_vigente', coalesce(ns.status,'listo') = 'listo',
        'derecho_pleno_dominio', bpr.right_type = 'pleno_dominio',
        'derecho_sin_revision', coalesce(bpr.review_flag, true) = false,
        'identidad_coherente', (bpr.company_id IS NULL AND q2.match_company_id IS NULL AND q2.match_owner_id IS NOT NULL)
      ) AS det,
      (q2.match_kind = 'dni_exacto'
        AND ns.building_id IS NOT DISTINCT FROM q2.building_id
        AND coalesce(ns.status,'listo') = 'listo'
        AND bpr.right_type = 'pleno_dominio'
        AND coalesce(bpr.review_flag, true) = false
        AND bpr.company_id IS NULL AND q2.match_company_id IS NULL AND q2.match_owner_id IS NOT NULL) AS apto
    FROM public.reconciliation_queue q2
    LEFT JOIN public.notas_simples ns ON ns.id = q2.nota_simple_id
    LEFT JOIN public.building_property_rights bpr ON bpr.titular_id = q2.titular_id AND bpr.status = 'active'
  ) req
  WHERE req.id = q.id;

  SELECT jsonb_build_object('total', count(*), 'aptos', count(*) FILTER (WHERE apto_auto),
                            'candidatos', count(*) FILTER (WHERE estado='candidato'))
    INTO v FROM public.reconciliation_queue;
  RETURN v;
END $$;

-- 8) Vigía: controles separados + autocierre sin borrar historial
CREATE OR REPLACE FUNCTION public.integridad_alertas_pendientes()
RETURNS TABLE(issue_key text, detalle text, severidad text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
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
    FROM hubspot_sync_log WHERE entity <> 'integrity_watchdog'
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
    -- === controles registrales separados (sustituyen a notas_sin_volcar_pct) ===
    UNION ALL
    SELECT 'derechos_sin_clasificar',
      'Hay '||count(*)||' derechos registrales sin clasificar (tipo "otro") pendientes de revisión manual', 'CALIDAD'
    FROM building_property_rights WHERE status='active' AND right_type='otro' HAVING count(*) > 0
    UNION ALL
    SELECT 'capa_pleno_incompleta',
      'Hay '||count(*)||' edificios cuya capa de pleno dominio no suma 100% en la nota simple', 'CALIDAD'
    FROM (SELECT building_id FROM v_rights_layer_check
          WHERE right_type IN ('pleno_dominio','ganancial') AND NOT capa_100
          GROUP BY building_id) x HAVING count(*) > 10
    UNION ALL
    SELECT 'sociedades_sin_derecho_enlazado',
      'Hay '||count(*)||' titulares sociedad sin empresa enlazada en el CRM', 'CALIDAD'
    FROM building_property_rights
    WHERE status='active' AND owner_id IS NULL AND company_id IS NULL AND identity_match = 'ninguno'
    HAVING count(*) > 0
    UNION ALL
    SELECT 'personas_sin_match',
      'Hay '||count(*)||' titulares persona de nota simple sin contacto identificado en el CRM', 'CALIDAD'
    FROM building_property_rights
    WHERE status='active' AND owner_id IS NULL AND company_id IS NULL AND identity_match IN ('aproximado','ninguno')
    HAVING count(*) > 50
    UNION ALL
    SELECT 'cuotas_operativas_contradictorias',
      'Hay '||count(*)||' cuotas de ficha que contradicen la nota simple (marcadas superseded/review, no usadas para score)', 'CALIDAD'
    FROM building_owners WHERE cuota_estado IN ('superseded','review') HAVING count(*) > 0
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

  -- autocierre SIN borrar historial
  UPDATE integrity_alert_log l
     SET resolved_at = now()
   WHERE l.resolved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _problemas p WHERE p.k = l.issue_key);

  -- reapertura si vuelve a aparecer
  UPDATE integrity_alert_log l
     SET resolved_at = NULL
   WHERE l.resolved_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM _problemas p WHERE p.k = l.issue_key);

  RETURN QUERY
  SELECT p.k, p.d, p.sev FROM _problemas p
  LEFT JOIN integrity_alert_log l ON l.issue_key = p.k
  WHERE l.last_sent_at IS NULL OR l.resolved_at IS NOT NULL OR l.last_sent_at < now() - interval '6 hours';
END $function$;