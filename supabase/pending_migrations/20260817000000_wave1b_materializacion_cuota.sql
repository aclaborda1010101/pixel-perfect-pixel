-- =====================================================================
-- RIGHTS WAVE 1B · MATERIALIZACIÓN DE DERECHOS Y CUOTA OPERATIVA SEGURA
-- =====================================================================
-- Forward-only. NO edita migraciones aplicadas. Parte del HEAD de 1A.3.
--
--  (1) RPC transaccional idempotente sobre v_p0_rights_staging:
--      p0_property_rights_wave1b_dry_run()  -> report, CERO writes
--      p0_apply_property_rights_wave1b(sig, p_apply default false)
--  (2) Contratos: un único CHECK de identity_match con el vocabulario
--      EXACTO emitido por staging; owner/company nunca simultáneos y
--      ambos NULL permitido (review). Mapeo de status sin blocked_conflict.
--  (3) Cuota fail-closed: sólo pleno dominio personal totalmente probado,
--      capa all-or-none, unidad/edificio 100 ± 0,01. Nunca se crean pares.
--  (4) Cierre de recontaminación: writers antiguos inejecutables y guard
--      de escritura sobre building_owners.cuota.
--  (5) v_rights_cuota_eligible: única fuente para scoring/UI.
--
-- feeds=0 es un resultado VÁLIDO: se materializan derechos auditables, se
-- limpian las cuotas heredadas inseguras y se reporta 0 operativas.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0) AUDITORÍA PRIVADA
-- ---------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS afflux_audit;
REVOKE ALL ON SCHEMA afflux_audit FROM PUBLIC;
GRANT USAGE ON SCHEMA afflux_audit TO service_role;

CREATE TABLE IF NOT EXISTS afflux_audit.wave1b_runs(
  run_id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  rules_version text NOT NULL,
  applied boolean NOT NULL,
  signature text NOT NULL,
  counts jsonb NOT NULL,
  checksums jsonb NOT NULL,
  dry_run jsonb NOT NULL,
  rolled_back_at timestamptz
);

CREATE TABLE IF NOT EXISTS afflux_audit.wave1b_rights_snapshot(
  run_id uuid NOT NULL REFERENCES afflux_audit.wave1b_runs(run_id) ON DELETE CASCADE,
  right_id uuid NOT NULL,
  fila jsonb NOT NULL,
  PRIMARY KEY (run_id, right_id)
);

-- Sólo los campos de cuota de building_owners: jamás roles, influencers,
-- asociaciones ni ningún otro dato.
CREATE TABLE IF NOT EXISTS afflux_audit.wave1b_owner_snapshot(
  run_id uuid NOT NULL REFERENCES afflux_audit.wave1b_runs(run_id) ON DELETE CASCADE,
  building_id uuid NOT NULL,
  owner_id uuid NOT NULL,
  cuota numeric,
  cuota_estado text,
  cuota_estado_motivo text,
  cuota_auditada_at timestamptz,
  metadatos jsonb,
  PRIMARY KEY (run_id, building_id, owner_id)
);

REVOKE ALL ON ALL TABLES IN SCHEMA afflux_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON afflux_audit.wave1b_runs,
      afflux_audit.wave1b_rights_snapshot, afflux_audit.wave1b_owner_snapshot TO service_role;

CREATE OR REPLACE FUNCTION public.p0_wave1b_rules_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ SELECT '1B.0'::text $$;

-- ---------------------------------------------------------------------
-- 1) CONTRATOS DE building_property_rights
-- ---------------------------------------------------------------------
-- 1.a) Columnas de materialización (idempotentes).
ALTER TABLE public.building_property_rights
  ADD COLUMN IF NOT EXISTS ownership_unit_key text,
  ADD COLUMN IF NOT EXISTS is_canonical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ownership_signature text,
  ADD COLUMN IF NOT EXISTS unit_block_reason text,
  ADD COLUMN IF NOT EXISTS coownership_regime_literal text,
  ADD COLUMN IF NOT EXISTS wave1b_run_id uuid,
  ADD COLUMN IF NOT EXISTS rules_version text,
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 1.b) TODOS los CHECK de identity_match, por conrelid + definición.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.building_property_rights'::regclass
       AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%identity_match%'
  LOOP
    EXECUTE format('ALTER TABLE public.building_property_rights DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_identity_match_wave1b CHECK (identity_match = ANY (ARRAY[
    'dni','cif','nombre_exacto','aproximado','ninguno','owner_preexistente',
    'company_preexistente','ambiguo','conflicto_owner_y_company',
    'nombre_sociedad_revisable','identity_conflict'
  ])) NOT VALID;

-- 1.c) owner/company: nunca los dos; ambos NULL es legítimo (review).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
     WHERE conrelid = 'public.building_property_rights'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%owner_id%'
       AND pg_get_constraintdef(oid) ILIKE '%company_id%'
  LOOP
    EXECUTE format('ALTER TABLE public.building_property_rights DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_owner_company_wave1b
  CHECK (NOT (owner_id IS NOT NULL AND company_id IS NOT NULL)) NOT VALID;

-- 1.d) Sin cuota personal para sociedades ni proyección de DH a edificio.
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_feeds_cuota_wave1b;
ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_feeds_cuota_wave1b CHECK (
    NOT feeds_cuota OR (
      right_type = 'pleno_dominio' AND status = 'active'
      AND owner_id IS NOT NULL AND company_id IS NULL
      AND NOT review_flag AND is_canonical
    )
  ) NOT VALID;

-- 1:1 con nota_simple_titulares.
CREATE UNIQUE INDEX IF NOT EXISTS bpr_titular_unico_wave1b
  ON public.building_property_rights(titular_id) WHERE titular_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2) ID ESTABLE POR TITULAR (UUID v5, namespace fijo)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_wave1b_right_id(p_titular_id uuid)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT (
    overlay(
      overlay(md5('afflux:wave1b:rights:' || p_titular_id::text) placing '5' from 13)
      placing to_hex((('x' || substr(md5('afflux:wave1b:rights:' || p_titular_id::text),17,1))::bit(4)::int & 3) | 8)
      from 17
    )
  )::uuid
$$;

-- ---------------------------------------------------------------------
-- 3) PROYECCIÓN CANÓNICA staging -> derechos
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_p0_wave1b_rights AS
SELECT
  public.p0_wave1b_right_id(s.titular_id) AS id,
  s.building_id,
  -- Sociedad conciliada: se conserva el vínculo de company, jamás owner.
  CASE WHEN s.conflicto_ids THEN NULL ELSE s.owner_id END AS owner_id,
  CASE WHEN s.conflicto_ids THEN NULL ELSE s.company_id END AS company_id,
  s.note_simple_id,
  s.right_type,
  s.percentage,
  s.coownership_regime,
  s.right_literal,
  s.titular_id, s.titular_nombre, s.titular_dni,
  s.identity_match, s.confidence,
  s.evidence_ref,
  s.ownership_unit_key, s.is_canonical, s.ownership_signature,
  s.unit_block_reason,
  s.nota_fecha_registral AS valid_from,
  -- (2) Mapa de status: blocked_conflict NO existe en la tabla => review.
  CASE
    WHEN s.status = 'superseded' THEN 'superseded'
    WHEN s.feeds_cuota THEN 'active'
    ELSE 'review'
  END AS status,
  s.feeds_cuota,
  (s.review_flag OR NOT s.feeds_cuota) AS review_flag,
  s.review_reason,
  s.unit_block_reason AS blocked_reason,
  jsonb_build_object(
    'role_conflict', s.role_conflict,
    'date_conflict', s.date_conflict,
    'unidad_date_conflict', s.unidad_date_conflict,
    'regime_conflict', s.regime_conflict,
    'unidad_key_conflict', s.unidad_key_conflict,
    'identity_conflict', s.identity_conflict,
    'identidad_ambigua', s.identidad_ambigua,
    'structured_unverified', s.structured_unverified,
    'building_block', s.building_block,
    'es_sociedad', s.es_sociedad,
    'division_horizontal', s.division_horizontal,
    'evidence_ok', s.evidence_ok,
    'evidence_ambiguous', s.evidence_ambiguous,
    'bad_evidence', s.bad_evidence,
    'invalid_pct', s.invalid_pct,
    'layer_safe', s.layer_safe,
    'unidad_segura', s.unidad_segura,
    'row_safe_pre_layer', s.row_safe_pre_layer,
    'staging_status', s.status
  ) AS flags
FROM public.v_p0_rights_staging s;

REVOKE ALL ON public.v_p0_wave1b_rights FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_wave1b_rights TO service_role;

-- Cuota operativa: SÓLO pleno dominio personal totalmente demostrado.
-- La capa se publica all-or-none y el edificio debe sumar 100 ± 0,01.
CREATE OR REPLACE VIEW public.v_p0_wave1b_quota AS
WITH elegibles AS (
  SELECT r.building_id, r.owner_id, r.percentage, r.note_simple_id,
         r.ownership_unit_key, r.ownership_signature, r.titular_id
  FROM public.v_p0_wave1b_rights r
  WHERE r.feeds_cuota
    AND r.status = 'active'
    AND r.is_canonical
    AND r.right_type = 'pleno_dominio'
    AND r.owner_id IS NOT NULL
    AND r.company_id IS NULL
    AND NOT r.review_flag
    AND coalesce((r.flags ->> 'evidence_ok')::boolean, false)
    AND NOT coalesce((r.flags ->> 'evidence_ambiguous')::boolean, true)
    AND NOT coalesce((r.flags ->> 'bad_evidence')::boolean, true)
    AND NOT coalesce((r.flags ->> 'division_horizontal')::boolean, true)
    AND NOT coalesce((r.flags ->> 'es_sociedad')::boolean, true)
    AND coalesce(r.coownership_regime, '') <> 'gananciales'
    AND r.percentage IS NOT NULL AND r.percentage > 0 AND r.percentage <= 100
), edificio AS (
  -- Nunca se suma entre notas ni entre unidades: una sola nota y una sola
  -- unidad por edificio, o el edificio entero queda fuera.
  SELECT building_id,
         count(DISTINCT note_simple_id) AS n_notas,
         count(DISTINCT ownership_unit_key) AS n_unidades,
         sum(percentage) AS suma
  FROM elegibles GROUP BY building_id
), validos AS (
  SELECT building_id FROM edificio
   WHERE n_notas = 1 AND n_unidades = 1 AND abs(suma - 100) <= 0.01
), pares AS (
  SELECT e.*, (bo.building_id IS NOT NULL) AS par_existe
  FROM elegibles e
  JOIN validos v ON v.building_id = e.building_id
  LEFT JOIN public.building_owners bo
    ON bo.building_id = e.building_id AND bo.owner_id = e.owner_id
), completos AS (
  -- Si falta cualquier par building/owner, el edificio entero es NO-GO:
  -- jamás se crea la pareja.
  SELECT building_id FROM pares GROUP BY building_id HAVING bool_and(par_existe)
)
SELECT p.building_id, p.owner_id, p.percentage AS cuota,
       p.note_simple_id, p.ownership_signature, p.ownership_unit_key, p.titular_id
FROM pares p JOIN completos c ON c.building_id = p.building_id;

REVOKE ALL ON public.v_p0_wave1b_quota FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_wave1b_quota TO service_role;

-- Edificios elegibles descartados: diagnóstico honesto, sin maquillar.
CREATE OR REPLACE VIEW public.v_p0_wave1b_quota_rechazos AS
WITH elegibles AS (
  SELECT r.building_id, r.owner_id, r.percentage, r.note_simple_id, r.ownership_unit_key
  FROM public.v_p0_wave1b_rights r
  WHERE r.feeds_cuota AND r.status = 'active' AND r.right_type = 'pleno_dominio'
    AND r.owner_id IS NOT NULL AND r.company_id IS NULL AND NOT r.review_flag
)
SELECT e.building_id,
       count(DISTINCT e.note_simple_id) AS n_notas,
       count(DISTINCT e.ownership_unit_key) AS n_unidades,
       sum(e.percentage) AS suma,
       bool_and(bo.building_id IS NOT NULL) AS pares_completos,
       nullif(concat_ws(' · ',
         CASE WHEN count(DISTINCT e.note_simple_id) > 1 THEN 'suma entre notas distintas: prohibido' END,
         CASE WHEN count(DISTINCT e.ownership_unit_key) > 1 THEN 'varias unidades: prohibido para cuota de edificio' END,
         CASE WHEN abs(coalesce(sum(e.percentage),0) - 100) > 0.01 THEN 'la capa no suma 100 ± 0,01' END,
         CASE WHEN NOT bool_and(bo.building_id IS NOT NULL) THEN 'falta la pareja building/owner: NO-GO, no se crea' END
       ), '') AS motivo
FROM elegibles e
LEFT JOIN public.building_owners bo
  ON bo.building_id = e.building_id AND bo.owner_id = e.owner_id
GROUP BY e.building_id;

REVOKE ALL ON public.v_p0_wave1b_quota_rechazos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_wave1b_quota_rechazos TO service_role;

-- ---------------------------------------------------------------------
-- 4) FIRMA DE CONTEXTO
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_wave1b_signature()
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT md5(
    public.p0_wave1b_rules_version() || '|' ||
    coalesce((SELECT string_agg(x, ',' ORDER BY x) FROM (
      SELECT r.titular_id::text || ':' || r.right_type || ':' ||
             coalesce(r.percentage::text,'-') || ':' || coalesce(r.owner_id::text,'-') || ':' ||
             coalesce(r.company_id::text,'-') || ':' || r.status || ':' || r.feeds_cuota::text ||
             ':' || coalesce(r.ownership_signature,'-') AS x
      FROM public.v_p0_wave1b_rights r
    ) q), '') || '|' ||
    (SELECT count(*) FROM public.buildings)::text || '|' ||
    (SELECT count(*) FROM public.notas_simples WHERE status = 'listo')::text || '|' ||
    (SELECT count(*) FROM public.building_owners)::text
  )
$$;

-- ---------------------------------------------------------------------
-- 5) DRY-RUN (CERO writes)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_property_rights_wave1b_dry_run()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH r AS (SELECT * FROM public.v_p0_wave1b_rights),
q AS (SELECT * FROM public.v_p0_wave1b_quota),
src AS (
  SELECT count(*) AS n FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  WHERE ns.building_id IS NOT NULL AND ns.status = 'listo'
),
legacy AS (
  SELECT count(*) AS n FROM public.building_owners WHERE cuota IS NOT NULL
),
rech AS (
  SELECT count(*) AS n FROM public.v_p0_wave1b_quota_rechazos x
  WHERE x.motivo IS NOT NULL
)
SELECT jsonb_build_object(
  'wave', '1B',
  'rules_version', public.p0_wave1b_rules_version(),
  'applied', false,
  'signature', public.p0_wave1b_signature(),
  'source_titulares', (SELECT n FROM src),
  'rights_planificados', (SELECT count(*) FROM r),
  'rights_uno_a_uno', ((SELECT count(*) FROM r) = (SELECT n FROM src)),
  'por_status', (SELECT jsonb_object_agg(status, n) FROM (
      SELECT status, count(*) AS n FROM r GROUP BY status) z),
  'por_right_type', (SELECT jsonb_object_agg(right_type, n) FROM (
      SELECT right_type, count(*) AS n FROM r GROUP BY right_type) z),
  'feeds', (SELECT count(*) FROM r WHERE feeds_cuota),
  'feeds_no_pleno', (SELECT count(*) FROM r WHERE feeds_cuota AND right_type <> 'pleno_dominio'),
  'feeds_sin_owner', (SELECT count(*) FROM r WHERE feeds_cuota AND owner_id IS NULL),
  'feeds_con_company', (SELECT count(*) FROM r WHERE feeds_cuota AND company_id IS NOT NULL),
  'feeds_en_review', (SELECT count(*) FROM r WHERE feeds_cuota AND review_flag),
  'unmatched', (SELECT count(*) FROM r WHERE owner_id IS NULL AND company_id IS NULL),
  'cuotas_operativas', (SELECT count(*) FROM q),
  'cuotas_edificios', (SELECT count(DISTINCT building_id) FROM q),
  'cuotas_heredadas_a_limpiar', (SELECT n FROM legacy),
  'edificios_descartados_para_cuota', (SELECT n FROM rech),
  'readiness_ok', false,
  'nota', 'feeds=0 es un resultado válido: derechos auditables + cuotas heredadas limpiadas + 0 operativas'
)
$$;

-- ---------------------------------------------------------------------
-- 6) APPLY TRANSACCIONAL IDEMPOTENTE
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_apply_property_rights_wave1b(
  expected_signature text,
  p_apply boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE
  v_run uuid := gen_random_uuid();
  v_sig text;
  v_report jsonb;
  v_rights int; v_quota int; v_legacy int; v_src int;
  v_bad int;
BEGIN
  IF NOT p_apply THEN
    -- Contrato exacto: el modo report devuelve EXACTAMENTE el dry-run.
    RETURN public.p0_property_rights_wave1b_dry_run();
  END IF;

  -- Serialización global de la materialización.
  PERFORM pg_advisory_xact_lock(hashtext('wave1b_property_rights'));
  LOCK TABLE public.nota_simple_titulares, public.notas_simples,
             public.owners, public.companies, public.buildings IN SHARE MODE;
  LOCK TABLE public.building_property_rights, public.building_owners IN ACCESS EXCLUSIVE MODE;

  -- Congela staging bajo los locks: el resto del apply lee SIEMPRE la foto.
  CREATE TEMP TABLE _w1b_rights ON COMMIT DROP AS SELECT * FROM public.v_p0_wave1b_rights;
  CREATE TEMP TABLE _w1b_quota  ON COMMIT DROP AS SELECT * FROM public.v_p0_wave1b_quota;

  v_sig := public.p0_wave1b_signature();
  IF expected_signature IS NULL OR expected_signature <> v_sig THEN
    RAISE EXCEPTION 'WAVE1B_SIGNATURE_STALE: esperada=% actual=%', expected_signature, v_sig;
  END IF;

  SELECT count(*) INTO v_src FROM public.nota_simple_titulares t
   JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
   WHERE ns.building_id IS NOT NULL AND ns.status = 'listo';
  SELECT count(*) INTO v_rights FROM _w1b_rights;
  IF v_rights <> v_src THEN
    RAISE EXCEPTION 'WAVE1B_NO_1A1: staging=% source=%', v_rights, v_src;
  END IF;

  v_report := public.p0_property_rights_wave1b_dry_run();

  INSERT INTO afflux_audit.wave1b_runs(run_id, rules_version, applied, signature, counts, checksums, dry_run)
  VALUES (v_run, public.p0_wave1b_rules_version(), true, v_sig,
          jsonb_build_object('rights', v_rights, 'source', v_src),
          '{}'::jsonb, v_report);

  -- SNAPSHOT ANTES de tocar nada.
  INSERT INTO afflux_audit.wave1b_rights_snapshot(run_id, right_id, fila)
  SELECT v_run, b.id, to_jsonb(b) FROM public.building_property_rights b;

  INSERT INTO afflux_audit.wave1b_owner_snapshot(
    run_id, building_id, owner_id, cuota, cuota_estado, cuota_estado_motivo, cuota_auditada_at, metadatos)
  SELECT v_run, bo.building_id, bo.owner_id, bo.cuota, bo.cuota_estado,
         bo.cuota_estado_motivo, bo.cuota_auditada_at, bo.metadatos
  FROM public.building_owners bo;

  -- MATERIALIZACIÓN: id estable por titular => reintento converge.
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
  FROM _w1b_rights r;

  -- CUOTA: primero TODA la herencia insegura a NULL/review; después sólo
  -- las cuotas demostradas. Ningún otro campo se toca.
  PERFORM set_config('afflux.wave1b_writer', 'on', true);

  UPDATE public.building_owners bo
     SET cuota = NULL,
         cuota_estado = 'review',
         cuota_estado_motivo = 'Wave 1B: cuota heredada sin titularidad registral demostrada',
         cuota_auditada_at = now(),
         metadatos = coalesce(bo.metadatos,'{}'::jsonb) || jsonb_build_object(
           'wave1b', jsonb_build_object('run_id', v_run, 'accion', 'cuota_heredada_anulada'))
   WHERE bo.cuota IS NOT NULL OR bo.cuota_estado = 'vigente';

  UPDATE public.building_owners bo
     SET cuota = q.cuota,
         cuota_estado = 'vigente',
         cuota_estado_motivo = 'Wave 1B: pleno dominio personal demostrado en nota registral',
         cuota_auditada_at = now(),
         metadatos = coalesce(bo.metadatos,'{}'::jsonb) || jsonb_build_object(
           'wave1b', jsonb_build_object(
             'run_id', v_run,
             'fuente', 'v_p0_rights_staging',
             'nota_simple_id', q.note_simple_id,
             'ownership_signature', q.ownership_signature,
             'rules_version', public.p0_wave1b_rules_version()))
    FROM _w1b_quota q
   WHERE bo.building_id = q.building_id AND bo.owner_id = q.owner_id;

  PERFORM set_config('afflux.wave1b_writer', 'off', true);

  -- INVARIANTES FINALES: cualquier fallo => rollback total.
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
    SELECT building_id, sum(cuota) AS s FROM public.building_owners
     WHERE cuota IS NOT NULL GROUP BY building_id HAVING abs(sum(cuota) - 100) > 0.01) z;
  IF v_bad > 0 THEN RAISE EXCEPTION 'WAVE1B_SUMA_NO_100: % edificios', v_bad; END IF;

  ALTER TABLE public.building_property_rights VALIDATE CONSTRAINT bpr_identity_match_wave1b;
  ALTER TABLE public.building_property_rights VALIDATE CONSTRAINT bpr_owner_company_wave1b;
  ALTER TABLE public.building_property_rights VALIDATE CONSTRAINT bpr_feeds_cuota_wave1b;

  SELECT count(*) INTO v_quota FROM _w1b_quota;
  SELECT count(*) INTO v_legacy FROM afflux_audit.wave1b_owner_snapshot
   WHERE run_id = v_run AND cuota IS NOT NULL;

  UPDATE afflux_audit.wave1b_runs
     SET counts = jsonb_build_object('rights', v_rights, 'source', v_src,
                                     'cuotas_operativas', v_quota,
                                     'cuotas_heredadas_limpiadas', v_legacy),
         checksums = jsonb_build_object(
           'rights', (SELECT md5(coalesce(string_agg(t, '|' ORDER BY t), '')) FROM (
              SELECT b.id::text || b.status || coalesce(b.percentage::text,'-') ||
                     b.feeds_cuota::text AS t FROM public.building_property_rights b) x),
           'cuotas', (SELECT md5(coalesce(string_agg(t, '|' ORDER BY t), '')) FROM (
              SELECT bo.building_id::text || bo.owner_id::text || coalesce(bo.cuota::text,'-')
              FROM public.building_owners bo WHERE bo.cuota IS NOT NULL) y(t)))
   WHERE run_id = v_run;

  RETURN v_report || jsonb_build_object(
    'applied', true, 'run_id', v_run,
    'rights_materializados', v_rights,
    'cuotas_operativas', v_quota,
    'cuotas_heredadas_limpiadas', v_legacy,
    'checksums', (SELECT checksums FROM afflux_audit.wave1b_runs WHERE run_id = v_run));
END $fn$;

REVOKE ALL ON FUNCTION public.p0_property_rights_wave1b_dry_run() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_apply_property_rights_wave1b(text, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_wave1b_signature() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_property_rights_wave1b_dry_run() TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_apply_property_rights_wave1b(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_wave1b_signature() TO service_role;

-- ---------------------------------------------------------------------
-- 7) ROLLBACK POR run_id (restaura EXACTAMENTE lo snapshotado)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_rollback_property_rights_wave1b(p_run_id uuid)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path TO 'public' AS $fn$
DECLARE v_rights int; v_owners int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM afflux_audit.wave1b_runs WHERE run_id = p_run_id AND applied) THEN
    RAISE EXCEPTION 'WAVE1B_RUN_DESCONOCIDO: %', p_run_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('wave1b_property_rights'));
  LOCK TABLE public.building_property_rights, public.building_owners IN ACCESS EXCLUSIVE MODE;

  DELETE FROM public.building_property_rights;
  INSERT INTO public.building_property_rights
  SELECT (jsonb_populate_record(NULL::public.building_property_rights, s.fila)).*
  FROM afflux_audit.wave1b_rights_snapshot s WHERE s.run_id = p_run_id;
  GET DIAGNOSTICS v_rights = ROW_COUNT;

  PERFORM set_config('afflux.wave1b_writer', 'on', true);
  UPDATE public.building_owners bo
     SET cuota = s.cuota, cuota_estado = s.cuota_estado,
         cuota_estado_motivo = s.cuota_estado_motivo,
         cuota_auditada_at = s.cuota_auditada_at, metadatos = s.metadatos
    FROM afflux_audit.wave1b_owner_snapshot s
   WHERE s.run_id = p_run_id AND bo.building_id = s.building_id AND bo.owner_id = s.owner_id;
  GET DIAGNOSTICS v_owners = ROW_COUNT;
  PERFORM set_config('afflux.wave1b_writer', 'off', true);

  UPDATE afflux_audit.wave1b_runs SET rolled_back_at = now() WHERE run_id = p_run_id;
  RETURN jsonb_build_object('run_id', p_run_id, 'rights_restaurados', v_rights,
                            'owners_restaurados', v_owners);
END $fn$;

REVOKE ALL ON FUNCTION public.p0_rollback_property_rights_wave1b(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_rollback_property_rights_wave1b(uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 8) CIERRE DE RECONTAMINACIÓN
-- ---------------------------------------------------------------------
-- 8.a) Guard de escritura: NADIE escribe cuota fuera del apply Wave 1B.
CREATE OR REPLACE FUNCTION public.building_owners_cuota_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $t$
BEGIN
  IF coalesce(current_setting('afflux.wave1b_writer', true), 'off') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.cuota IS NOT NULL THEN
    RAISE EXCEPTION 'WAVE1B_CUOTA_BLOQUEADA: la cuota sólo la escribe p0_apply_property_rights_wave1b';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.cuota IS DISTINCT FROM OLD.cuota THEN
    RAISE EXCEPTION 'WAVE1B_CUOTA_BLOQUEADA: la cuota sólo la escribe p0_apply_property_rights_wave1b';
  END IF;
  RETURN NEW;
END $t$;

DROP TRIGGER IF EXISTS building_owners_cuota_guard ON public.building_owners;
CREATE TRIGGER building_owners_cuota_guard
  BEFORE INSERT OR UPDATE ON public.building_owners
  FOR EACH ROW EXECUTE FUNCTION public.building_owners_cuota_guard();

-- 8.b) Writers antiguos: inejecutables y con error claro.
DROP FUNCTION IF EXISTS public.p0_rebuild_property_rights(text);

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('volcar_cuotas_desde_notas', 'p0_mark_cuota_eligibility')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.volcar_cuotas_desde_notas()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'WAVE1B: volcar_cuotas_desde_notas está retirado. Use p0_apply_property_rights_wave1b.';
END $$;
REVOKE ALL ON FUNCTION public.volcar_cuotas_desde_notas() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.p0_mark_cuota_eligibility()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'WAVE1B: p0_mark_cuota_eligibility está retirado. La elegibilidad vive en v_rights_cuota_eligible.';
END $$;
REVOKE ALL ON FUNCTION public.p0_mark_cuota_eligibility() FROM PUBLIC, anon, authenticated, service_role;

-- 8.c) Merges destructivos automáticos: sin EXECUTE para nadie (el histórico
-- se conserva intacto; sólo se retira la capacidad de ejecutarlos).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('_merge_owner_pair', 'merge_duplicate_owners', 'dedup_owners_fuzzy')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 9) CONSUMIDORES: única fuente de cuota elegible
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_rights_cuota_eligible AS
SELECT b.building_id, b.owner_id, b.note_simple_id, b.titular_id,
       b.percentage AS cuota, b.ownership_unit_key, b.ownership_signature,
       b.right_type, b.evidence_ref, b.confidence, b.rules_version, b.wave1b_run_id
FROM public.building_property_rights b
WHERE b.feeds_cuota AND b.status = 'active' AND b.right_type = 'pleno_dominio'
  AND b.owner_id IS NOT NULL AND b.company_id IS NULL AND NOT b.review_flag;

REVOKE ALL ON public.v_rights_cuota_eligible FROM PUBLIC, anon;
GRANT SELECT ON public.v_rights_cuota_eligible TO authenticated, service_role;

-- Gate de titularidad para scoring/UI: sin titularidad segura no hay score
-- de propietarios fiable. Nunca cae a porcentaje crudo ni a suma plana.
CREATE OR REPLACE VIEW public.v_building_ownership_gate AS
SELECT bl.id AS building_id,
       coalesce(e.n, 0) AS derechos_operativos,
       coalesce(r.n, 0) AS derechos_en_review,
       (coalesce(e.n, 0) > 0) AS titularidad_segura,
       CASE WHEN coalesce(e.n,0) > 0 THEN 'operativa' ELSE 'pendiente de titularidad' END AS etiqueta
FROM public.buildings bl
LEFT JOIN (SELECT building_id, count(*) n FROM public.v_rights_cuota_eligible GROUP BY building_id) e
  ON e.building_id = bl.id
LEFT JOIN (SELECT building_id, count(*) n FROM public.building_property_rights
            WHERE status = 'review' GROUP BY building_id) r
  ON r.building_id = bl.id;

REVOKE ALL ON public.v_building_ownership_gate FROM PUBLIC, anon;
GRANT SELECT ON public.v_building_ownership_gate TO authenticated, service_role;

COMMIT;
