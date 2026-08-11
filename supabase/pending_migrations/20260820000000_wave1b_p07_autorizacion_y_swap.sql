-- =====================================================================
-- RIGHTS WAVE 1B · P0.7 — AUTORIZACIÓN NO FALSIFICABLE, DDL APLICABLE,
-- ABORTO POR PAREJA AUSENTE, STAGING/SWAP Y ROLLBACK SEGURO
-- =====================================================================
-- Forward-only. Depende de 20260817000000_wave1b_materializacion_cuota.sql.
-- CERO apply, CERO limpieza de cuotas: sólo estructura y contratos.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0) TICKET DE ESCRITURA NO FALSIFICABLE (sustituye al GUC)
-- ---------------------------------------------------------------------
-- Tabla sin NINGÚN grant: ni PUBLIC, ni anon, ni authenticated, ni
-- service_role pueden insertar. Sólo las funciones SECURITY DEFINER de
-- esta migración (propiedad del owner de la migración) escriben aquí.
CREATE TABLE IF NOT EXISTS afflux_audit.wave1b_write_ticket(
  backend_pid int PRIMARY KEY,
  xid bigint NOT NULL,
  run_id uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON afflux_audit.wave1b_write_ticket FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION afflux_audit.wave1b_ticket_open(p_run_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'afflux_audit','public' AS $$
BEGIN
  DELETE FROM afflux_audit.wave1b_write_ticket WHERE backend_pid = pg_backend_pid();
  INSERT INTO afflux_audit.wave1b_write_ticket(backend_pid, xid, run_id)
  VALUES (pg_backend_pid(), txid_current(), p_run_id);
END $$;
REVOKE ALL ON FUNCTION afflux_audit.wave1b_ticket_open(uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION afflux_audit.wave1b_ticket_close()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'afflux_audit','public' AS $$
  DELETE FROM afflux_audit.wave1b_write_ticket WHERE backend_pid = pg_backend_pid();
$$;
REVOKE ALL ON FUNCTION afflux_audit.wave1b_ticket_close() FROM PUBLIC, anon, authenticated, service_role;

-- Válido sólo para ESTE backend y ESTA transacción: un ticket huérfano de
-- otra transacción no autoriza nada.
CREATE OR REPLACE FUNCTION afflux_audit.wave1b_ticket_valido()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'afflux_audit','public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM afflux_audit.wave1b_write_ticket
     WHERE backend_pid = pg_backend_pid() AND xid = txid_current()
  )
$$;
REVOKE ALL ON FUNCTION afflux_audit.wave1b_ticket_valido() FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1) GUARD DE CUOTA SIN GUC
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.building_owners_cuota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','afflux_audit' AS $t$
BEGIN
  IF afflux_audit.wave1b_ticket_valido() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND (NEW.cuota IS NOT NULL OR NEW.cuota_estado = 'vigente'
                           OR NEW.cuota_auditada_at IS NOT NULL) THEN
    RAISE EXCEPTION 'WAVE1B_CUOTA_BLOQUEADA: sólo la RPC Wave 1B escribe cuota/estado/motivo/auditoría';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.cuota IS DISTINCT FROM OLD.cuota
        OR NEW.cuota_estado IS DISTINCT FROM OLD.cuota_estado
        OR NEW.cuota_estado_motivo IS DISTINCT FROM OLD.cuota_estado_motivo
        OR NEW.cuota_auditada_at IS DISTINCT FROM OLD.cuota_auditada_at) THEN
    RAISE EXCEPTION 'WAVE1B_CUOTA_BLOQUEADA: sólo la RPC Wave 1B escribe cuota/estado/motivo/auditoría';
  END IF;
  RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS building_owners_cuota_guard ON public.building_owners;
CREATE TRIGGER building_owners_cuota_guard
  BEFORE INSERT OR UPDATE ON public.building_owners
  FOR EACH ROW EXECUTE FUNCTION public.building_owners_cuota_guard();

-- ---------------------------------------------------------------------
-- 2) CIERRE DE PERMISOS LIVE SOBRE building_owners
-- ---------------------------------------------------------------------
-- 2.a) Policies permisivas heredadas (preview_all / true) fuera.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT polname FROM pg_policy
     WHERE polrelid = 'public.building_owners'::regclass
       AND (polname ILIKE '%preview%'
            OR coalesce(pg_get_expr(polqual, polrelid), 'true') = 'true'
            OR coalesce(pg_get_expr(polwithcheck, polrelid), '') = 'true')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.building_owners', r.polname);
  END LOOP;
END $$;

ALTER TABLE public.building_owners ENABLE ROW LEVEL SECURITY;

-- 2.b) DML/TRUNCATE fuera de PUBLIC/anon/authenticated. Lecturas intactas
--      (WhatsApp y el resto de la app sólo LEEN building_owners).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.building_owners FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.building_owners TO anon, authenticated, service_role;

-- 2.c) service_role: nunca UPDATE directo de los campos de cuota.
REVOKE UPDATE ON public.building_owners FROM service_role;
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ') INTO cols
    FROM pg_attribute
   WHERE attrelid = 'public.building_owners'::regclass
     AND attnum > 0 AND NOT attisdropped
     AND attname NOT IN ('cuota','cuota_estado','cuota_estado_motivo','cuota_auditada_at');
  EXECUTE format('GRANT UPDATE (%s) ON public.building_owners TO service_role', cols);
END $$;
GRANT INSERT, DELETE ON public.building_owners TO service_role;

-- 2.d) Política mínima para lecturas autenticadas (no DML).
DROP POLICY IF EXISTS building_owners_read_authenticated ON public.building_owners;
CREATE POLICY building_owners_read_authenticated ON public.building_owners
  FOR SELECT TO authenticated USING (true);

-- 2.e) RPC legítima para asociar/desasociar (sin tocar cuota).
CREATE OR REPLACE FUNCTION public.wave1b_owner_link_upsert(
  p_building_id uuid, p_owner_id uuid, p_rol text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_gestor_access(auth.uid()) THEN
    RAISE EXCEPTION 'WAVE1B_NO_AUTORIZADO';
  END IF;
  INSERT INTO public.building_owners(building_id, owner_id)
  VALUES (p_building_id, p_owner_id)
  ON CONFLICT (building_id, owner_id) DO UPDATE SET building_id = EXCLUDED.building_id
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.wave1b_owner_link_upsert(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wave1b_owner_link_upsert(uuid, uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 3) AUDITORÍA APPEND-ONLY E INMUTABLE
-- ---------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON afflux_audit.wave1b_runs, afflux_audit.wave1b_rights_snapshot,
     afflux_audit.wave1b_owner_snapshot
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON afflux_audit.wave1b_runs, afflux_audit.wave1b_rights_snapshot,
      afflux_audit.wave1b_owner_snapshot TO service_role;

ALTER TABLE afflux_audit.wave1b_runs
  ADD COLUMN IF NOT EXISTS context_hash text,
  ADD COLUMN IF NOT EXISTS snapshot_hash text,
  ADD COLUMN IF NOT EXISTS current_hash text,
  ADD COLUMN IF NOT EXISTS idempotent_hits int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION afflux_audit.wave1b_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'afflux_audit','public' AS $t$
BEGIN
  IF NOT afflux_audit.wave1b_ticket_valido() THEN
    RAISE EXCEPTION 'WAVE1B_AUDITORIA_INMUTABLE: sólo la RPC Wave 1B puede escribir auditoría';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'WAVE1B_AUDITORIA_INMUTABLE: la auditoría es append-only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    -- Sólo se permiten cierres controlados del propio run.
    IF (OLD.run_id, OLD.signature, OLD.dry_run) IS DISTINCT FROM (NEW.run_id, NEW.signature, NEW.dry_run) THEN
      RAISE EXCEPTION 'WAVE1B_AUDITORIA_INMUTABLE: campos de identidad no editables';
    END IF;
  END IF;
  RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS wave1b_runs_immutable ON afflux_audit.wave1b_runs;
CREATE TRIGGER wave1b_runs_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON afflux_audit.wave1b_runs
  FOR EACH ROW EXECUTE FUNCTION afflux_audit.wave1b_audit_immutable();

CREATE OR REPLACE FUNCTION afflux_audit.wave1b_snapshot_immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'afflux_audit','public' AS $t$
BEGIN
  IF TG_OP <> 'INSERT' OR NOT afflux_audit.wave1b_ticket_valido() THEN
    RAISE EXCEPTION 'WAVE1B_SNAPSHOT_INMUTABLE: los snapshots son append-only y sólo los crea la RPC';
  END IF;
  RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS wave1b_rights_snapshot_immutable ON afflux_audit.wave1b_rights_snapshot;
CREATE TRIGGER wave1b_rights_snapshot_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON afflux_audit.wave1b_rights_snapshot
  FOR EACH ROW EXECUTE FUNCTION afflux_audit.wave1b_snapshot_immutable();

DROP TRIGGER IF EXISTS wave1b_owner_snapshot_immutable ON afflux_audit.wave1b_owner_snapshot;
CREATE TRIGGER wave1b_owner_snapshot_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON afflux_audit.wave1b_owner_snapshot
  FOR EACH ROW EXECUTE FUNCTION afflux_audit.wave1b_snapshot_immutable();

-- ---------------------------------------------------------------------
-- 4) DDL APLICABLE: fuera el índice prematuro, dentro el preflight
-- ---------------------------------------------------------------------
DROP INDEX IF EXISTS public.bpr_titular_unico_wave1b;

CREATE OR REPLACE FUNCTION public.p0_wave1b_preflight()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'titular_duplicados', (SELECT count(*) FROM (
        SELECT titular_id FROM public.building_property_rights
         WHERE titular_id IS NOT NULL GROUP BY titular_id HAVING count(*) > 1) d),
    'filas_historicas', (SELECT count(*) FROM public.building_property_rights),
    'indice_titular_presente', EXISTS (
        SELECT 1 FROM pg_class WHERE relname = 'bpr_titular_unico_wave1b'),
    'ambos_null_sin_review', (SELECT count(*) FROM public.building_property_rights
        WHERE owner_id IS NULL AND company_id IS NULL AND NOT (review_flag AND NOT feeds_cuota)),
    'index_solo_tras_swap', true
  )
$$;
REVOKE ALL ON FUNCTION public.p0_wave1b_preflight() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_wave1b_preflight() TO service_role;

-- CHECK owner/company exigido por el auditor: nunca ambos; ambos NULL sólo
-- si es una fila de revisión que NO alimenta cuota.
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_owner_company_wave1b;
ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_owner_company_wave1b CHECK (
    NOT (owner_id IS NOT NULL AND company_id IS NOT NULL)
    AND (owner_id IS NOT NULL OR company_id IS NOT NULL
         OR (review_flag AND NOT feeds_cuota))
  ) NOT VALID;

-- ---------------------------------------------------------------------
-- 5) FIRMA/CONTEXT HASH MATERIAL (addendum del auditor)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_wave1b_context_hash()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(
    public.p0_wave1b_rules_version() || '|R|' ||
    coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
      SELECT r.titular_id::text || ':' || r.right_type || ':' ||
             coalesce(r.percentage::text,'-') || ':' || coalesce(r.owner_id::text,'-') || ':' ||
             coalesce(r.company_id::text,'-') || ':' || r.status || ':' || r.feeds_cuota::text ||
             ':' || coalesce(r.ownership_signature,'-') || ':' || coalesce(r.evidence_ref::text,'-') ||
             ':' || coalesce(r.flags::text,'-') || ':' || coalesce(r.ownership_unit_key,'-') ||
             ':' || r.is_canonical::text || ':' || coalesce(r.coownership_regime,'-') ||
             ':' || coalesce(r.valid_from::text,'-') AS x
      FROM public.v_p0_wave1b_rights r) q), '') || '|N|' ||
    coalesce((SELECT string_agg(y, ',' ORDER BY y) FROM (
      SELECT ns.id::text || ':' || coalesce(ns.status,'-') || ':' ||
             md5(coalesce(ns.raw_pdf_text, '')) AS y
      FROM public.notas_simples ns) n), '') || '|P|' ||
    coalesce((SELECT string_agg(z, ',' ORDER BY z) FROM (
      SELECT bo.building_id::text || ':' || bo.owner_id::text AS z
      FROM public.building_owners bo) p), '')
  )
$$;
REVOKE ALL ON FUNCTION public.p0_wave1b_context_hash() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_wave1b_context_hash() TO service_role;

CREATE OR REPLACE FUNCTION public.p0_wave1b_signature()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.p0_wave1b_context_hash()
$$;

CREATE OR REPLACE FUNCTION public.p0_wave1b_current_hash()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(
    coalesce((SELECT string_agg(t, '|' ORDER BY t) FROM (
      SELECT b.id::text || coalesce(b.status,'-') || coalesce(b.percentage::text,'-') ||
             b.feeds_cuota::text || coalesce(b.flags::text,'-') AS t
      FROM public.building_property_rights b) x), '') || '#' ||
    coalesce((SELECT string_agg(u, '|' ORDER BY u) FROM (
      SELECT bo.building_id::text || bo.owner_id::text || coalesce(bo.cuota::text,'-') ||
             coalesce(bo.cuota_estado,'-') || coalesce(bo.cuota_auditada_at::text,'-') AS u
      FROM public.building_owners bo) y), '')
  )
$$;
REVOKE ALL ON FUNCTION public.p0_wave1b_current_hash() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_wave1b_current_hash() TO service_role;

-- ---------------------------------------------------------------------
-- 6) APPLY v2: STAGING/SWAP, ABORTO POR PAREJA AUSENTE, IDEMPOTENCIA REAL
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_apply_property_rights_wave1b(
  expected_signature text,
  p_apply boolean DEFAULT false,
  p_purge_ack text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public','afflux_audit' AS $fn$
DECLARE
  v_run uuid := gen_random_uuid();
  v_sig text; v_ctx text; v_prev afflux_audit.wave1b_runs%ROWTYPE;
  v_report jsonb; v_rights int; v_quota int; v_legacy int; v_src int; v_bad int;
BEGIN
  IF NOT p_apply THEN
    RETURN public.p0_property_rights_wave1b_dry_run();
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('wave1b_property_rights'));
  LOCK TABLE public.nota_simple_titulares, public.notas_simples,
             public.owners, public.companies, public.buildings IN SHARE MODE;
  LOCK TABLE public.building_property_rights, public.building_owners IN ACCESS EXCLUSIVE MODE;

  v_ctx := public.p0_wave1b_context_hash();
  v_sig := v_ctx;
  IF expected_signature IS NULL OR expected_signature <> v_sig THEN
    RAISE EXCEPTION 'WAVE1B_SIGNATURE_STALE: esperada=% actual=%', expected_signature, v_sig;
  END IF;

  -- IDEMPOTENCIA REAL: mismo contexto y estado ya materializado => no-op,
  -- sin nuevas filas, sin nuevos timestamps, sólo el contador idempotente.
  SELECT * INTO v_prev FROM afflux_audit.wave1b_runs
   WHERE applied AND rolled_back_at IS NULL AND context_hash = v_ctx
   ORDER BY created_at DESC LIMIT 1;
  IF FOUND AND v_prev.current_hash IS NOT NULL
     AND v_prev.current_hash = public.p0_wave1b_current_hash() THEN
    PERFORM afflux_audit.wave1b_ticket_open(v_prev.run_id);
    UPDATE afflux_audit.wave1b_runs
       SET idempotent_hits = idempotent_hits + 1 WHERE run_id = v_prev.run_id;
    PERFORM afflux_audit.wave1b_ticket_close();
    RETURN v_prev.dry_run || jsonb_build_object(
      'applied', true, 'idempotent', true, 'run_id', v_prev.run_id,
      'context_hash', v_ctx, 'current_hash', v_prev.current_hash,
      'checksums', v_prev.checksums);
  END IF;

  -- STAGING congelado bajo los locks.
  CREATE TEMP TABLE _w1b_stage ON COMMIT DROP AS SELECT * FROM public.v_p0_wave1b_rights;
  CREATE TEMP TABLE _w1b_quota ON COMMIT DROP AS SELECT * FROM public.v_p0_wave1b_quota;

  -- Unicidad 1:1 validada SOBRE STAGING, nunca sobre el histórico.
  CREATE UNIQUE INDEX _w1b_stage_titular ON _w1b_stage(titular_id);

  SELECT count(*) INTO v_src FROM public.nota_simple_titulares t
   JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
   WHERE ns.building_id IS NOT NULL AND ns.status = 'listo';
  SELECT count(*) INTO v_rights FROM _w1b_stage;
  IF v_rights <> v_src THEN
    RAISE EXCEPTION 'WAVE1B_NO_1A1: staging=% source=%', v_rights, v_src;
  END IF;

  -- ABORTO GLOBAL POR PAREJA AUSENTE: cualquier derecho que deba alimentar
  -- cuota exige exactamente una pareja building_owner ya existente.
  SELECT count(*) INTO v_bad
    FROM _w1b_stage s
   WHERE s.feeds_cuota
     AND (SELECT count(*) FROM public.building_owners bo
           WHERE bo.building_id = s.building_id AND bo.owner_id = s.owner_id) <> 1;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'WAVE1B_PAREJA_AUSENTE: % derechos sin pareja building_owner única; apply abortado sin cambios', v_bad;
  END IF;

  -- Gananciales y sociedades nunca proyectan cuota personal.
  SELECT count(*) INTO v_bad FROM _w1b_stage s
   WHERE s.feeds_cuota AND (coalesce(s.coownership_regime,'') = 'gananciales'
      OR coalesce((s.flags->>'es_sociedad')::boolean,false)
      OR s.company_id IS NOT NULL);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'WAVE1B_CUOTA_NO_APROBADA: % derechos gananciales/sociedad no pueden alimentar cuota', v_bad;
  END IF;

  SELECT count(*) INTO v_legacy FROM public.building_owners WHERE cuota IS NOT NULL;
  SELECT count(*) INTO v_quota FROM _w1b_quota;
  -- feeds=0 NO autoriza limpiar masivamente: NO-GO operativo salvo ACK explícito.
  IF v_quota = 0 AND v_legacy > 0 AND p_purge_ack IS DISTINCT FROM ('PURGE:' || v_ctx) THEN
    RAISE EXCEPTION 'WAVE1B_NOGO_OPERATIVO: % cuotas heredadas y 0 operativas; requiere revisión y ack explícito', v_legacy;
  END IF;

  v_report := public.p0_property_rights_wave1b_dry_run();

  PERFORM afflux_audit.wave1b_ticket_open(v_run);

  INSERT INTO afflux_audit.wave1b_runs(run_id, rules_version, applied, signature, counts,
                                       checksums, dry_run, context_hash)
  VALUES (v_run, public.p0_wave1b_rules_version(), true, v_sig,
          jsonb_build_object('rights', v_rights, 'source', v_src),
          '{}'::jsonb, v_report, v_ctx);

  INSERT INTO afflux_audit.wave1b_rights_snapshot(run_id, right_id, fila)
  SELECT v_run, b.id, to_jsonb(b) FROM public.building_property_rights b;

  INSERT INTO afflux_audit.wave1b_owner_snapshot(
    run_id, building_id, owner_id, cuota, cuota_estado, cuota_estado_motivo,
    cuota_auditada_at, metadatos)
  SELECT v_run, bo.building_id, bo.owner_id, bo.cuota, bo.cuota_estado,
         bo.cuota_estado_motivo, bo.cuota_auditada_at, bo.metadatos
  FROM public.building_owners bo;

  -- SWAP: la tabla destino se reconstruye desde staging ya validado.
  DELETE FROM public.building_property_rights;
  INSERT INTO public.building_property_rights(
    id, building_id, owner_id, company_id, note_simple_id, right_type, percentage,
    coownership_regime, source_type, source_ref, evidence_ref, confidence, valid_from,
    status, titular_id, titular_nombre, titular_dni, identity_match, feeds_cuota,
    blocked_reason, review_flag, review_reason, right_literal,
    ownership_unit_key, is_canonical, ownership_signature, unit_block_reason,
    wave1b_run_id, rules_version, flags, created_at, updated_at)
  SELECT r.id, r.building_id, r.owner_id, r.company_id, r.note_simple_id, r.right_type,
         r.percentage, r.coownership_regime, 'nota_simple', r.note_simple_id::text,
         r.evidence_ref, r.confidence, r.valid_from, r.status, r.titular_id,
         r.titular_nombre, r.titular_dni, r.identity_match, r.feeds_cuota,
         r.blocked_reason, r.review_flag, r.review_reason, r.right_literal,
         r.ownership_unit_key, r.is_canonical, r.ownership_signature, r.unit_block_reason,
         v_run, public.p0_wave1b_rules_version(), r.flags, now(), now()
  FROM _w1b_stage r;

  -- El índice 1:1 se crea DESPUÉS del swap, sobre datos ya validados.
  CREATE UNIQUE INDEX IF NOT EXISTS bpr_titular_unico_wave1b
    ON public.building_property_rights(titular_id) WHERE titular_id IS NOT NULL;

  UPDATE public.building_owners bo
     SET cuota = NULL, cuota_estado = 'review',
         cuota_estado_motivo = 'Wave 1B: cuota heredada sin titularidad registral demostrada',
         cuota_auditada_at = now(),
         metadatos = coalesce(bo.metadatos,'{}'::jsonb) || jsonb_build_object(
           'wave1b', jsonb_build_object('run_id', v_run, 'accion', 'cuota_heredada_anulada'))
   WHERE bo.cuota IS NOT NULL OR bo.cuota_estado = 'vigente';

  UPDATE public.building_owners bo
     SET cuota = q.cuota, cuota_estado = 'vigente',
         cuota_estado_motivo = 'Wave 1B: pleno dominio personal demostrado en nota registral',
         cuota_auditada_at = now(),
         metadatos = coalesce(bo.metadatos,'{}'::jsonb) || jsonb_build_object(
           'wave1b', jsonb_build_object('run_id', v_run, 'fuente', 'v_p0_rights_staging',
             'nota_simple_id', q.note_simple_id, 'ownership_signature', q.ownership_signature,
             'rules_version', public.p0_wave1b_rules_version()))
    FROM _w1b_quota q
   WHERE bo.building_id = q.building_id AND bo.owner_id = q.owner_id;

  -- INVARIANTES FINALES.
  SELECT count(*) INTO v_bad FROM public.building_property_rights
   WHERE feeds_cuota AND (right_type <> 'pleno_dominio' OR owner_id IS NULL
      OR company_id IS NOT NULL OR review_flag OR status <> 'active');
  IF v_bad > 0 THEN RAISE EXCEPTION 'WAVE1B_FEED_INSEGURO: % filas', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM public.building_owners bo
   WHERE bo.cuota IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM _w1b_quota q
                      WHERE q.building_id = bo.building_id AND q.owner_id = bo.owner_id);
  IF v_bad > 0 THEN RAISE EXCEPTION 'WAVE1B_CUOTA_SIN_FEED: % filas', v_bad; END IF;

  SELECT count(*) INTO v_bad FROM (
    SELECT building_id FROM public.building_owners WHERE cuota IS NOT NULL
     GROUP BY building_id HAVING abs(sum(cuota) - 100) > 0.01) z;
  IF v_bad > 0 THEN RAISE EXCEPTION 'WAVE1B_SUMA_NO_100: % edificios', v_bad; END IF;

  ALTER TABLE public.building_property_rights VALIDATE CONSTRAINT bpr_identity_match_wave1b;
  ALTER TABLE public.building_property_rights VALIDATE CONSTRAINT bpr_owner_company_wave1b;
  ALTER TABLE public.building_property_rights VALIDATE CONSTRAINT bpr_feeds_cuota_wave1b;

  UPDATE afflux_audit.wave1b_runs
     SET counts = jsonb_build_object('rights', v_rights, 'source', v_src,
                                     'cuotas_operativas', v_quota,
                                     'cuotas_heredadas_limpiadas', v_legacy),
         checksums = jsonb_build_object(
           'context', v_ctx,
           'current', public.p0_wave1b_current_hash(),
           'snapshot', md5(coalesce((SELECT string_agg(s.fila::text, '|' ORDER BY s.right_id)
                          FROM afflux_audit.wave1b_rights_snapshot s WHERE s.run_id = v_run), ''))),
         current_hash = public.p0_wave1b_current_hash(),
         snapshot_hash = md5(coalesce((SELECT string_agg(s.fila::text, '|' ORDER BY s.right_id)
                          FROM afflux_audit.wave1b_rights_snapshot s WHERE s.run_id = v_run), ''))
   WHERE run_id = v_run;

  PERFORM afflux_audit.wave1b_ticket_close();

  RETURN v_report || jsonb_build_object(
    'applied', true, 'idempotent', false, 'run_id', v_run,
    'context_hash', v_ctx,
    'rights_materializados', v_rights,
    'cuotas_operativas', v_quota,
    'cuotas_heredadas_limpiadas', v_legacy,
    'checksums', (SELECT checksums FROM afflux_audit.wave1b_runs WHERE run_id = v_run));
END $fn$;

REVOKE ALL ON FUNCTION public.p0_apply_property_rights_wave1b(text, boolean, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_apply_property_rights_wave1b(text, boolean, text) TO service_role;
DROP FUNCTION IF EXISTS public.p0_apply_property_rights_wave1b(text, boolean);

-- ---------------------------------------------------------------------
-- 7) ROLLBACK SEGURO: sólo el último run aplicado y no revertido
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_rollback_property_rights_wave1b(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public','afflux_audit' AS $fn$
DECLARE v_run afflux_audit.wave1b_runs%ROWTYPE; v_last uuid; v_rights int; v_owners int; v_bad int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('wave1b_property_rights'));
  LOCK TABLE public.building_property_rights, public.building_owners IN ACCESS EXCLUSIVE MODE;

  SELECT * INTO v_run FROM afflux_audit.wave1b_runs WHERE run_id = p_run_id;
  IF NOT FOUND OR NOT v_run.applied THEN
    RAISE EXCEPTION 'WAVE1B_RUN_DESCONOCIDO: %', p_run_id;
  END IF;
  IF v_run.rolled_back_at IS NOT NULL THEN
    RAISE EXCEPTION 'WAVE1B_RUN_YA_REVERTIDO: %', p_run_id;
  END IF;

  SELECT run_id INTO v_last FROM afflux_audit.wave1b_runs
   WHERE applied ORDER BY created_at DESC LIMIT 1;
  IF v_last IS DISTINCT FROM p_run_id THEN
    RAISE EXCEPTION 'WAVE1B_RUN_NO_ES_EL_ULTIMO: existe una ejecución posterior (%)', v_last;
  END IF;

  IF v_run.current_hash IS NULL OR v_run.current_hash <> public.p0_wave1b_current_hash() THEN
    RAISE EXCEPTION 'WAVE1B_ESTADO_CAMBIADO: el estado actual no coincide con el run; rollback rechazado';
  END IF;

  IF v_run.snapshot_hash IS DISTINCT FROM md5(coalesce((
        SELECT string_agg(s.fila::text, '|' ORDER BY s.right_id)
          FROM afflux_audit.wave1b_rights_snapshot s WHERE s.run_id = p_run_id), '')) THEN
    RAISE EXCEPTION 'WAVE1B_SNAPSHOT_INCOMPLETO: hash de snapshot no verificable';
  END IF;

  SELECT count(*) INTO v_bad FROM public.building_owners bo
   WHERE NOT EXISTS (SELECT 1 FROM afflux_audit.wave1b_owner_snapshot s
                      WHERE s.run_id = p_run_id AND s.building_id = bo.building_id
                        AND s.owner_id = bo.owner_id);
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'WAVE1B_SNAPSHOT_INCOMPLETO: % parejas posteriores al run', v_bad;
  END IF;

  PERFORM afflux_audit.wave1b_ticket_open(p_run_id);

  DELETE FROM public.building_property_rights;
  INSERT INTO public.building_property_rights
  SELECT (jsonb_populate_record(NULL::public.building_property_rights, s.fila)).*
  FROM afflux_audit.wave1b_rights_snapshot s WHERE s.run_id = p_run_id;
  GET DIAGNOSTICS v_rights = ROW_COUNT;

  UPDATE public.building_owners bo
     SET cuota = s.cuota, cuota_estado = s.cuota_estado,
         cuota_estado_motivo = s.cuota_estado_motivo,
         cuota_auditada_at = s.cuota_auditada_at, metadatos = s.metadatos
    FROM afflux_audit.wave1b_owner_snapshot s
   WHERE s.run_id = p_run_id AND bo.building_id = s.building_id AND bo.owner_id = s.owner_id;
  GET DIAGNOSTICS v_owners = ROW_COUNT;

  UPDATE afflux_audit.wave1b_runs SET rolled_back_at = now() WHERE run_id = p_run_id;
  PERFORM afflux_audit.wave1b_ticket_close();

  RETURN jsonb_build_object('run_id', p_run_id, 'rights_restaurados', v_rights,
                            'owners_restaurados', v_owners);
END $fn$;
REVOKE ALL ON FUNCTION public.p0_rollback_property_rights_wave1b(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_rollback_property_rights_wave1b(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 8) WRITERS RESTANTES DE CUOTA
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('volcar_cuotas_desde_notas','p0_mark_cuota_eligibility',
                         'recompute_building_owner_cuotas','audit_building_owner_cuotas',
                         'p0_rebuild_property_rights')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;

COMMIT;
