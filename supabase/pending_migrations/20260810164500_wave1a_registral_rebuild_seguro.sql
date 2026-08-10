-- =====================================================================
-- WAVE 1A · Corrección registral: rebuild seguro, atómico y 1:1
-- MIGRACIÓN NO APLICADA. Posterior a 20260810145734.
-- Se deja fuera de supabase/migrations/ a propósito: esa carpeta solo la
-- escribe la herramienta de migración al ejecutar el SQL, y esta fase es
-- "solo código". Para aplicarla en el futuro, pasar este fichero tal cual.
-- No toca compute_score_total, v_v5_task_candidates, recompute, Vigía ni reparse.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Constraint: "como máximo uno" (owner_id / company_id), no XOR
-- ---------------------------------------------------------------------
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_owner_xor_company;

ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_owner_or_company_max_one;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_owner_or_company_max_one
  CHECK ((owner_id IS NOT NULL)::int + (company_id IS NOT NULL)::int <= 1);

-- Un titular sin conciliar (owner_id y company_id NULL) debe quedar en revisión,
-- nunca alimentar cuota y llevar motivo explícito.
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_unmatched_requires_review;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_unmatched_requires_review
  CHECK (
    owner_id IS NOT NULL
    OR company_id IS NOT NULL
    OR (review_flag = true AND feeds_cuota = false
        AND nullif(btrim(coalesce(review_reason,'')),'') IS NOT NULL)
  );

-- Ningún derecho no pleno puede alimentar cuota (invariante estructural).
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_only_pleno_feeds_cuota;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_only_pleno_feeds_cuota
  CHECK (feeds_cuota = false OR right_type = 'pleno_dominio');

-- ---------------------------------------------------------------------
-- 2) Unidad de titularidad y nota canónica
-- ---------------------------------------------------------------------
ALTER TABLE public.building_property_rights
  ADD COLUMN IF NOT EXISTS ownership_unit_key text,
  ADD COLUMN IF NOT EXISTS is_canonical       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nota_signature     text,
  ADD COLUMN IF NOT EXISTS unit_block_reason  text,
  ADD COLUMN IF NOT EXISTS evidence_ok        boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bpr_unit ON public.building_property_rights(ownership_unit_key);
CREATE INDEX IF NOT EXISTS idx_bpr_canonical ON public.building_property_rights(building_id, is_canonical);

-- 1:1 estricto: un titular registral aparece como máximo una vez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bpr_titular
  ON public.building_property_rights(titular_id) WHERE titular_id IS NOT NULL;

-- Clave de unidad registral fiable a partir de la propia nota.
-- NUNCA inventa fallback: en división horizontal, si la nota no aporta finca
-- registral / IDUFIR / referencia catastral / acto, devuelve NULL.
CREATE OR REPLACE FUNCTION public.p0_nota_unit_key(p_nota_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH n AS (
    SELECT ns.id, ns.building_id, ns.structured_json AS sj,
           coalesce(b.division_horizontal, false) AS dh
    FROM public.notas_simples ns
    LEFT JOIN public.buildings b ON b.id = ns.building_id
    WHERE ns.id = p_nota_id
  ), k AS (
    SELECT n.*,
      nullif(btrim(coalesce(
        n.sj ->> 'idufir',
        n.sj ->> 'idufir_cru',
        n.sj ->> 'cru',
        n.sj ->> 'finca_registral',
        n.sj ->> 'numero_finca',
        n.sj #>> '{finca,idufir}',
        n.sj #>> '{finca,numero}',
        n.sj #>> '{registro,finca}',
        n.sj ->> 'referencia_catastral',
        n.sj #>> '{finca,referencia_catastral}'
      )), '') AS clave_fiable
    FROM n
  )
  SELECT CASE
    WHEN k.building_id IS NULL THEN NULL
    WHEN NOT k.dh THEN 'building:' || k.building_id::text
    WHEN k.clave_fiable IS NOT NULL
      THEN 'dh:' || k.building_id::text || ':' || upper(regexp_replace(k.clave_fiable, '[^A-Za-z0-9]', '', 'g'))
    ELSE NULL
  END
  FROM k;
$$;

COMMENT ON FUNCTION public.p0_nota_unit_key(uuid) IS
  'Clave de unidad de titularidad. Sin DH: building:<id>. Con DH: solo clave registral fiable de la nota; si no existe devuelve NULL (dh_sin_unidad_registral).';

-- ---------------------------------------------------------------------
-- 3) Clasificación de derecho y firma de nota
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_right_type_from_rol(p_rol text, p_rol_literal text, p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(p_rol,'') = 'ganancial'
      OR coalesce(p_rol_literal,'') ~* '(car[áa]cter\s+ganancial|gananciales?|sociedad\s+conyugal)'
      OR coalesce(p_nombre,'') ~* '(SOCIEDAD\s+CONYUGAL|GANANCIAL)'      THEN 'ganancial'
    WHEN coalesce(p_rol,'') = 'nuda_propiedad'
      OR coalesce(p_rol_literal,'') ~* 'nuda\s*propiedad'                THEN 'nuda_propiedad'
    WHEN coalesce(p_rol,'') = 'usufructo'
      OR coalesce(p_rol_literal,'') ~* 'usufruct'                        THEN 'usufructo'
    WHEN coalesce(p_rol,'') = 'pleno'
      OR coalesce(p_rol_literal,'') ~* 'pleno\s*dominio'                 THEN 'pleno_dominio'
    ELSE 'otro'   -- desconocido NUNCA se convierte en pleno dominio
  END;
$$;

CREATE OR REPLACE FUNCTION public.p0_nota_signature(p_nota_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH n AS (
    SELECT ns.id,
           coalesce(ns.structured_json ->> 'fecha_emision_nota',
                    ns.structured_json ->> 'fecha_nota',
                    to_char(ns.processed_at, 'YYYY-MM-DD'),
                    to_char(ns.created_at, 'YYYY-MM-DD')) AS vigencia
    FROM public.notas_simples ns WHERE ns.id = p_nota_id
  ), t AS (
    SELECT
      coalesce(
        nullif(upper(regexp_replace(coalesce(x.cif_dni,''), '[^A-Za-z0-9]', '', 'g')), ''),
        public.norm_person_name(x.nombre_extraido),
        '(sin identidad)'
      ) AS ident,
      public.p0_right_type_from_rol(x.rol::text, x.metadatos ->> 'rol_literal', x.nombre_extraido) AS derecho,
      coalesce(round(x.porcentaje::numeric, 2)::text, 'NULL') AS pct,
      coalesce(nullif(btrim(coalesce(x.metadatos ->> 'regimen','')), ''), 'desconocido') AS regimen
    FROM public.nota_simple_titulares x WHERE x.nota_simple_id = p_nota_id
  )
  SELECT coalesce(
           (SELECT string_agg(t.ident || '|' || t.derecho || '|' || t.pct || '|' || t.regimen, ';'
                              ORDER BY t.ident, t.derecho, t.pct) FROM t),
           '(sin titulares)')
         || '@' || coalesce((SELECT n.vigencia FROM n), '(sin vigencia)');
$$;

COMMENT ON FUNCTION public.p0_nota_signature(uuid) IS
  'Firma de nota: identidad/nombre normalizado + derecho + porcentaje + régimen + vigencia. 60/40 y 50/50 con los mismos titulares dan firmas distintas; dos notas idénticas dan la MISMA firma (duplicado, no contradicción).';

-- ---------------------------------------------------------------------
-- 4) Staging read-only, 1:1 con nota_simple_titulares
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_p0_rights_staging AS
WITH tit AS (
  SELECT
    t.id AS titular_id, ns.id AS nota_id, ns.building_id, ns.status AS nota_status,
    t.nombre_extraido, t.company_id,
    nullif(upper(regexp_replace(coalesce(t.cif_dni,''), '[^A-Za-z0-9]', '', 'g')), '') AS dni,
    t.porcentaje,
    nullif(coalesce(t.metadatos ->> 'rol_literal',''), '') AS rol_literal,
    nullif(btrim(coalesce(t.metadatos ->> 'regimen','')), '') AS regimen_literal,
    public.norm_person_name(t.nombre_extraido) AS nn,
    public.p0_right_type_from_rol(t.rol::text, t.metadatos ->> 'rol_literal', t.nombre_extraido) AS right_type,
    public.p0_nota_unit_key(ns.id) AS unit_key,
    public.p0_nota_signature(ns.id) AS nota_signature,
    coalesce(b.division_horizontal, false) AS dh,
    ns.structured_json AS sj, ns.processed_at, ns.created_at
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  LEFT JOIN public.buildings b ON b.id = ns.building_id
  WHERE ns.building_id IS NOT NULL
), soc AS (
  SELECT tit.*,
    (tit.nombre_extraido ~* '(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|PATRIMONI|CAPITAL)\M'
     OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]') AS es_sociedad
  FROM tit
), nota_meta AS (
  SELECT nota_id, building_id, unit_key, nota_signature, nota_status, processed_at, created_at, sj,
         count(*) AS n_titulares,
         count(*) FILTER (WHERE porcentaje IS NOT NULL) AS n_con_pct,
         count(*) FILTER (WHERE dni IS NOT NULL) AS n_con_dni
  FROM soc
  GROUP BY nota_id, building_id, unit_key, nota_signature, nota_status, processed_at, created_at, sj
), canon AS (
  -- nota canónica por unidad: status listo, extracción más completa, fecha más reciente
  SELECT DISTINCT ON (unit_key) unit_key, nota_id
  FROM nota_meta
  WHERE unit_key IS NOT NULL AND nota_status = 'listo'
  ORDER BY unit_key,
           n_con_pct DESC, n_con_dni DESC, n_titulares DESC,
           coalesce(nullif(sj ->> 'fecha_emision_nota',''), nullif(sj ->> 'fecha_nota','')) DESC NULLS LAST,
           processed_at DESC NULLS LAST, created_at DESC, nota_id
), unit_state AS (
  SELECT unit_key,
         count(DISTINCT nota_signature) FILTER (WHERE nota_status = 'listo') AS n_firmas
  FROM nota_meta WHERE unit_key IS NOT NULL GROUP BY unit_key
), m_dni AS (
  SELECT s.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
  FROM soc s
  JOIN public.owners o
    ON nullif(upper(regexp_replace(coalesce(o.metadatos ->> 'dni__nif__cif',''), '[^A-Za-z0-9]', '', 'g')), '') = s.dni
  WHERE s.dni IS NOT NULL AND o.merged_into IS NULL AND NOT s.es_sociedad
  GROUP BY s.titular_id
), m_nom AS (
  SELECT s.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
  FROM soc s
  JOIN public.owners o ON public.norm_person_name(o.nombre) = s.nn
  WHERE s.nn IS NOT NULL AND o.merged_into IS NULL AND NOT s.es_sociedad
  GROUP BY s.titular_id
), m_comp AS (
  SELECT s.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
  FROM soc s
  JOIN public.companies k ON public.norm_person_name(k.nombre) = s.nn
  WHERE s.es_sociedad AND s.nn IS NOT NULL
  GROUP BY s.titular_id
), ev AS (
  SELECT s.titular_id, public.nota_evidence_snippet(s.nota_id, s.nombre_extraido) AS ev
  FROM soc s
), base AS (
  SELECT s.*,
    (c.nota_id IS NOT NULL) AS is_canonical,
    (coalesce(us.n_firmas, 0) > 1) AS unidad_contradictoria,
    (s.porcentaje IS NULL) AS percentage_null,
    CASE WHEN s.es_sociedad THEN coalesce(s.company_id, CASE WHEN mc.n = 1 THEN mc.company_id END) END AS f_company_id,
    CASE WHEN NOT s.es_sociedad
         THEN CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id END END AS f_owner_id,
    CASE
      WHEN s.es_sociedad THEN CASE WHEN s.company_id IS NOT NULL OR mc.n = 1 THEN 'nombre_exacto' ELSE 'ninguno' END
      WHEN md.n = 1 THEN 'dni'
      WHEN mn.n = 1 THEN 'nombre_exacto'
      WHEN coalesce(md.n, 0) > 1 OR coalesce(mn.n, 0) > 1 THEN 'aproximado'
      ELSE 'ninguno'
    END AS identity_match,
    CASE WHEN md.n = 1 THEN 1.0 WHEN mn.n = 1 THEN 0.8 ELSE 0.4 END AS confidence,
    e.ev
  FROM soc s
  LEFT JOIN canon c ON c.unit_key = s.unit_key AND c.nota_id = s.nota_id
  LEFT JOIN unit_state us ON us.unit_key = s.unit_key
  LEFT JOIN m_dni md ON md.titular_id = s.titular_id
  LEFT JOIN m_nom mn ON mn.titular_id = s.titular_id
  LEFT JOIN m_comp mc ON mc.titular_id = s.titular_id
  LEFT JOIN ev e ON e.titular_id = s.titular_id
), evaluada AS (
  SELECT b.*,
    -- Evidencia apta: la MISMA cita contiene titular + derecho + porcentaje,
    -- o structured_json con ruta/página trazable para ese titular.
    (
      (
        (b.ev ->> 'encontrado')::boolean IS TRUE
        AND NOT b.percentage_null
        AND coalesce(b.ev ->> 'cita','') ~* '(pleno\s*dominio|nuda\s*propiedad|usufruct|ganancial)'
        AND coalesce(b.ev ->> 'cita','') ~
            ('(^|[^0-9])' || regexp_replace(regexp_replace(round(b.porcentaje::numeric, 2)::text, '0+$', ''), '\.$', '') || '([^0-9]|$)')
      )
      OR (
        NOT b.percentage_null
        AND jsonb_typeof(b.sj -> 'titulares') = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(b.sj -> 'titulares') tj
          WHERE public.norm_person_name(tj ->> 'nombre') = b.nn
            AND nullif(coalesce(tj ->> 'derecho', tj ->> 'rol', ''), '') IS NOT NULL
            AND (tj ->> 'porcentaje') IS NOT NULL
            AND coalesce(tj ->> 'pagina', tj ->> 'page', tj ->> 'ruta', tj ->> 'path') IS NOT NULL
        )
      )
    ) AS evidence_ok
  FROM base b
)
SELECT
  e.titular_id, e.nota_id AS note_simple_id, e.building_id,
  e.unit_key AS ownership_unit_key, e.is_canonical, e.nota_signature,
  e.nombre_extraido AS titular_nombre, e.dni AS titular_dni,
  e.right_type, e.porcentaje AS percentage,
  CASE
    WHEN e.regimen_literal IS NOT NULL THEN e.regimen_literal
    WHEN e.right_type = 'ganancial' THEN 'gananciales'
    ELSE 'desconocido'
  END AS coownership_regime,
  e.f_owner_id AS owner_id, e.f_company_id AS company_id,
  e.identity_match, e.confidence, e.evidence_ok, e.ev AS evidence_ref,
  e.rol_literal AS right_literal,
  e.es_sociedad, e.dh, e.nota_status, e.unidad_contradictoria,
  CASE WHEN e.unit_key IS NULL AND e.dh THEN 'dh_sin_unidad_registral' END AS unit_block_reason,
  -- solo la nota canónica de la unidad es operativa
  CASE WHEN e.is_canonical THEN 'active' ELSE 'superseded' END AS status,
  (
    e.right_type IN ('otro','ganancial')
    OR NOT e.evidence_ok
    OR e.percentage_null
    OR (e.f_owner_id IS NULL AND e.f_company_id IS NULL)
    OR e.unit_key IS NULL
    OR e.unidad_contradictoria
    OR NOT e.is_canonical
  ) AS review_flag,
  nullif(concat_ws(' · ',
    CASE WHEN e.right_type = 'otro' THEN 'rol registral desconocido: se clasifica como "otro" (nunca pleno dominio)' END,
    CASE WHEN e.right_type = 'ganancial' THEN 'carácter ganancial: capa separada, no se reparte entre cónyuges' END,
    CASE WHEN NOT e.evidence_ok THEN 'evidencia insuficiente: falta titular + derecho + porcentaje en la misma cita o ruta trazable en structured_json' END,
    CASE WHEN e.percentage_null THEN 'porcentaje ausente en la nota' END,
    CASE WHEN e.f_owner_id IS NULL AND e.f_company_id IS NULL THEN 'titular registral sin conciliar con el CRM (sin owner ni company)' END,
    CASE WHEN e.unit_key IS NULL AND e.dh THEN 'división horizontal sin clave de unidad registral fiable (dh_sin_unidad_registral)' END,
    CASE WHEN e.unit_key IS NULL AND NOT e.dh THEN 'sin unidad de titularidad resoluble' END,
    CASE WHEN e.unidad_contradictoria THEN 'la unidad tiene notas con firmas registrales distintas (contradicción)' END,
    CASE WHEN NOT e.is_canonical THEN 'nota no canónica de la unidad: se conserva para auditoría, no opera' END
  ), '') AS review_reason,
  (
    e.is_canonical
    AND e.right_type = 'pleno_dominio'
    AND e.f_owner_id IS NOT NULL
    AND e.f_company_id IS NULL
    AND e.identity_match IN ('dni','nombre_exacto')
    AND e.evidence_ok
    AND NOT e.percentage_null
    AND e.unit_key IS NOT NULL
    AND NOT e.unidad_contradictoria
  ) AS feeds_cuota
FROM evaluada e;

GRANT SELECT ON public.v_p0_rights_staging TO authenticated;
GRANT SELECT ON public.v_p0_rights_staging TO service_role;

COMMENT ON VIEW public.v_p0_rights_staging IS
  'Staging read-only 1:1 con nota_simple_titulares. Conserva TODAS las notas: solo la canónica de cada ownership_unit_key queda active; el resto superseded y sin alimentar cuota (dos notas idénticas no suman 200%).';

-- ---------------------------------------------------------------------
-- 5) Dry-run sin escrituras
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_property_rights_dry_run()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH src AS (
  SELECT count(*) AS n
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  WHERE ns.building_id IS NOT NULL
), s AS (
  SELECT * FROM public.v_p0_rights_staging
), agg AS (
  SELECT
    count(*) AS staged_rows,
    count(*) FILTER (WHERE building_id IS NOT NULL) AS staged_con_building,
    count(DISTINCT titular_id) AS titulares_unicos,
    count(*) FILTER (WHERE owner_id IS NULL AND company_id IS NULL) AS unmatched,
    count(*) FILTER (WHERE owner_id IS NOT NULL AND company_id IS NOT NULL) AS mezcla_owner_company,
    count(*) FILTER (WHERE unit_block_reason = 'dh_sin_unidad_registral') AS dh_sin_unidad,
    count(*) FILTER (WHERE evidence_ok) AS evidence_ok,
    count(*) FILTER (WHERE NOT evidence_ok) AS evidence_missing,
    count(*) FILTER (WHERE is_canonical) AS filas_canonicas,
    count(*) FILTER (WHERE feeds_cuota) AS feeds_cuota,
    count(*) FILTER (WHERE feeds_cuota AND right_type <> 'pleno_dominio') AS bad_no_pleno_feeds,
    count(*) FILTER (WHERE feeds_cuota AND owner_id IS NULL) AS bad_unmatched_feeds,
    count(*) FILTER (WHERE feeds_cuota AND unidad_contradictoria) AS bad_contradiccion_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT is_canonical) AS bad_no_canonica_feeds
  FROM s
), por_derecho AS (
  SELECT jsonb_object_agg(right_type, n) AS j
  FROM (SELECT right_type, count(*) AS n FROM s GROUP BY right_type) x
), unidades AS (
  SELECT ownership_unit_key,
         count(DISTINCT nota_signature) AS n_firmas,
         count(DISTINCT note_simple_id) AS n_notas,
         count(DISTINCT note_simple_id) FILTER (WHERE is_canonical) AS n_canon
  FROM s WHERE ownership_unit_key IS NOT NULL
  GROUP BY ownership_unit_key
), u AS (
  SELECT
    count(*) AS unidades,
    count(*) FILTER (WHERE n_canon = 1) AS notas_canonicas,
    count(*) FILTER (WHERE n_firmas > 1) AS contradicciones,
    count(*) FILTER (WHERE n_notas > 1 AND n_firmas = 1) AS duplicados_identicos,
    count(*) FILTER (WHERE n_canon > 1) AS unidades_multi_canonica
  FROM unidades
)
SELECT jsonb_build_object(
  'source_titulares', src.n,
  'staged_rows', agg.staged_rows,
  'titulares_unicos', agg.titulares_unicos,
  'paridad_1a1', (agg.staged_rows = src.n AND agg.titulares_unicos = agg.staged_rows),
  'unmatched', agg.unmatched,
  'dh_sin_unidad', agg.dh_sin_unidad,
  'evidence_ok', agg.evidence_ok,
  'evidence_missing', agg.evidence_missing,
  'unidades', u.unidades,
  'notas_canonicas', u.notas_canonicas,
  'filas_canonicas', agg.filas_canonicas,
  'duplicados_identicos', u.duplicados_identicos,
  'contradicciones', u.contradicciones,
  'feeds_cuota', agg.feeds_cuota,
  'por_derecho', coalesce(por_derecho.j, '{}'::jsonb),
  'invariants', jsonb_build_object(
    'staged_igual_source', agg.staged_rows = src.n,
    'todas_con_building_id', agg.staged_con_building = agg.staged_rows,
    'titular_unico', agg.titulares_unicos = agg.staged_rows,
    'sin_mezcla_owner_company', agg.mezcla_owner_company = 0,
    'ningun_unmatched_alimenta_cuota', agg.bad_unmatched_feeds = 0,
    'solo_pleno_alimenta_cuota', agg.bad_no_pleno_feeds = 0,
    'solo_canonica_alimenta_cuota', agg.bad_no_canonica_feeds = 0,
    'max_una_canonica_por_unidad', u.unidades_multi_canonica = 0,
    'contradiccion_no_alimenta_cuota', agg.bad_contradiccion_feeds = 0
  ),
  'invariants_ok', (
    agg.staged_rows = src.n
    AND agg.staged_con_building = agg.staged_rows
    AND agg.titulares_unicos = agg.staged_rows
    AND agg.mezcla_owner_company = 0
    AND agg.bad_unmatched_feeds = 0
    AND agg.bad_no_pleno_feeds = 0
    AND agg.bad_no_canonica_feeds = 0
    AND u.unidades_multi_canonica = 0
    AND agg.bad_contradiccion_feeds = 0
  )
) FROM src, agg, por_derecho, u;
$$;

REVOKE ALL ON FUNCTION public.p0_property_rights_dry_run() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.p0_property_rights_dry_run() TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6) Rebuild: staging + validación; reemplazo real solo con p_apply = true
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.p0_rebuild_property_rights(text);

CREATE OR REPLACE FUNCTION public.p0_rebuild_property_rights(
  p_reason text DEFAULT 'wave1a',
  p_apply  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_dry jsonb;
  v_arch int := 0;
  v_ins  int := 0;
  v_post jsonb;
BEGIN
  v_dry := public.p0_property_rights_dry_run();

  IF NOT p_apply THEN
    RETURN v_dry || jsonb_build_object('applied', false, 'motivo', 'dry-run por defecto (p_apply=false)');
  END IF;

  IF (v_dry ->> 'invariants_ok')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Rebuild abortado antes de escribir: invariantes fallidas %', v_dry -> 'invariants'
      USING ERRCODE = 'check_violation';
  END IF;

  -- Materializa el staging ANTES de tocar la tabla real (misma transacción)
  CREATE TEMP TABLE _bpr_stage ON COMMIT DROP AS
  SELECT * FROM public.v_p0_rights_staging;

  IF (SELECT count(*) FROM _bpr_stage) <> (v_dry ->> 'staged_rows')::int THEN
    RAISE EXCEPTION 'Rebuild abortado: el staging cambió durante la ejecución'
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM _bpr_stage WHERE building_id IS NULL) THEN
    RAISE EXCEPTION 'Rebuild abortado: filas de staging sin building_id'
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.building_property_rights_archive(reason, row_data)
  SELECT p_reason, to_jsonb(r) FROM public.building_property_rights r;
  GET DIAGNOSTICS v_arch = ROW_COUNT;

  DELETE FROM public.building_property_rights;

  INSERT INTO public.building_property_rights (
    building_id, owner_id, company_id, note_simple_id, titular_id, titular_nombre, titular_dni,
    right_type, percentage, coownership_regime,
    ownership_unit_key, is_canonical, nota_signature, unit_block_reason,
    source_type, source_ref, evidence, evidence_ref, right_literal,
    identity_match, confidence, evidence_ok, status, review_flag, review_reason, feeds_cuota, blocked_reason
  )
  SELECT
    s.building_id, s.owner_id, s.company_id, s.note_simple_id, s.titular_id, s.titular_nombre, s.titular_dni,
    s.right_type, s.percentage, s.coownership_regime,
    s.ownership_unit_key, s.is_canonical, s.nota_signature, s.unit_block_reason,
    'nota_simple',
    'titular:' || s.titular_id::text || '|nota:' || s.note_simple_id::text,
    'Nota simple ' || s.note_simple_id::text || ' · titular literal: "' || coalesce(s.titular_nombre,'(sin nombre)') ||
      '" · derecho: ' || s.right_type || coalesce(' ("' || s.right_literal || '")', '') ||
      ' · porcentaje declarado: ' || coalesce(s.percentage::text, '(sin dato)') ||
      CASE WHEN s.evidence_ok
           THEN ' · cita registral: «' || coalesce(s.evidence_ref ->> 'cita', '(structured_json trazable)') || '»'
           ELSE ' · SIN evidencia apta (titular + derecho + porcentaje en la misma cita)' END,
    s.evidence_ref, s.right_literal,
    s.identity_match, s.confidence, s.evidence_ok, s.status, s.review_flag,
    coalesce(s.review_reason,
             CASE WHEN s.owner_id IS NULL AND s.company_id IS NULL
                  THEN 'titular registral sin conciliar con el CRM' END),
    s.feeds_cuota,
    CASE WHEN s.feeds_cuota THEN NULL
         ELSE coalesce(s.review_reason,
                       'no cumple pleno dominio canónico con identidad, evidencia y unidad sin contradicción') END
  FROM _bpr_stage s;
  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- Invariantes POST-escritura: cualquier fallo revierte la transacción entera
  SELECT jsonb_build_object(
    'rows', count(*),
    'titulares_unicos', count(DISTINCT titular_id),
    'mezcla', count(*) FILTER (WHERE owner_id IS NOT NULL AND company_id IS NOT NULL),
    'unmatched_feeds', count(*) FILTER (WHERE feeds_cuota AND owner_id IS NULL),
    'no_pleno_feeds', count(*) FILTER (WHERE feeds_cuota AND right_type <> 'pleno_dominio'),
    'no_canonica_feeds', count(*) FILTER (WHERE feeds_cuota AND NOT is_canonical)
  ) INTO v_post FROM public.building_property_rights;

  IF (v_post ->> 'rows')::int <> (v_dry ->> 'staged_rows')::int
     OR (v_post ->> 'titulares_unicos')::int <> (v_post ->> 'rows')::int
     OR (v_post ->> 'mezcla')::int <> 0
     OR (v_post ->> 'unmatched_feeds')::int <> 0
     OR (v_post ->> 'no_pleno_feeds')::int <> 0
     OR (v_post ->> 'no_canonica_feeds')::int <> 0
     OR EXISTS (
          SELECT 1 FROM public.building_property_rights
          WHERE ownership_unit_key IS NOT NULL AND is_canonical
          GROUP BY ownership_unit_key
          HAVING count(DISTINCT note_simple_id) > 1)
  THEN
    RAISE EXCEPTION 'Rebuild abortado tras escribir: invariantes post-escritura fallidas % (transacción revertida, sin DELETE parcial)', v_post
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN v_dry || jsonb_build_object(
    'applied', true, 'reason', p_reason,
    'archivadas', v_arch, 'insertadas', v_ins, 'post', v_post);
END $$;

REVOKE ALL ON FUNCTION public.p0_rebuild_property_rights(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_rebuild_property_rights(text, boolean) TO service_role;

COMMENT ON FUNCTION public.p0_rebuild_property_rights(text, boolean) IS
  'Por defecto p_apply=false (dry-run). Con p_apply=true archiva y reemplaza dentro de la misma transacción; cualquier invariante fallida aborta sin DELETE parcial.';