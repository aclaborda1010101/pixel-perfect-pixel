-- =====================================================================
-- WAVE 1A.1 · Corrección registral: staging + dry-run seguros
-- MIGRACIÓN NO APLICADA. Posterior a 20260810145734.
-- En esta Wave el rebuild REAL está DESHABILITADO: no existe ningún camino
-- que archive, borre o inserte en public.building_property_rights.
-- No toca compute_score_total, v_v5_task_candidates, recompute, Vigía ni reparse.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Constraints: "como máximo uno" (owner_id / company_id), no XOR
-- ---------------------------------------------------------------------
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_owner_xor_company;

ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_owner_or_company_max_one;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_owner_or_company_max_one
  CHECK ((owner_id IS NOT NULL)::int + (company_id IS NOT NULL)::int <= 1)
  NOT VALID;

ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_unmatched_requires_review;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_unmatched_requires_review
  CHECK (
    owner_id IS NOT NULL
    OR company_id IS NOT NULL
    OR (review_flag = true AND feeds_cuota = false
        AND nullif(btrim(coalesce(review_reason,'')),'') IS NOT NULL)
  ) NOT VALID;

ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_only_pleno_feeds_cuota;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_only_pleno_feeds_cuota
  CHECK (feeds_cuota = false OR right_type = 'pleno_dominio')
  NOT VALID;

-- Columnas de apoyo (solo estructura; no se escribe nada en esta Wave).
ALTER TABLE public.building_property_rights
  ADD COLUMN IF NOT EXISTS ownership_unit_key text,
  ADD COLUMN IF NOT EXISTS is_canonical       boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nota_signature     text,
  ADD COLUMN IF NOT EXISTS unit_block_reason  text,
  ADD COLUMN IF NOT EXISTS layer_complete     boolean,
  ADD COLUMN IF NOT EXISTS evidence_ok        boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bpr_unit ON public.building_property_rights(ownership_unit_key);
CREATE INDEX IF NOT EXISTS idx_bpr_canonical ON public.building_property_rights(building_id, is_canonical);

-- IMPORTANTE: NO se crea ningún UNIQUE INDEX sobre titular_id en la tabla real.
-- Los datos históricos pueden contener duplicados y la unicidad haría fallar la
-- propia migración. La unicidad de titular_id se valida SOLO en staging/dry-run
-- y se materializará en una fase de aplicación posterior, nunca aquí.
DROP INDEX IF EXISTS public.uq_bpr_titular;

-- ---------------------------------------------------------------------
-- 2) Helpers deterministas
-- ---------------------------------------------------------------------

-- Regex tolerante de porcentaje: acepta coma o punto y símbolo % opcional.
CREATE OR REPLACE FUNCTION public.p0_pct_regex(p_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_pct IS NULL THEN NULL
    ELSE '(^|[^0-9,.])'
         || regexp_replace(trunc(p_pct)::text, '^-', '\-')
         || CASE
              WHEN (p_pct - trunc(p_pct)) = 0 THEN '(\s*[.,]\s*0+)?'
              ELSE '\s*[.,]\s*' ||
                   regexp_replace(regexp_replace(round(p_pct - trunc(p_pct), 2)::text, '^0[.,]', ''), '0+$', '')
            END
         || '\s*(%|por\s*cien(to)?)?([^0-9]|$)'
  END;
$$;

-- Regex del derecho EXACTO de la fila (no vale cualquier palabra de derecho).
CREATE OR REPLACE FUNCTION public.p0_right_regex(p_right_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_right_type
    WHEN 'pleno_dominio'  THEN 'pleno\s*dominio|plena\s*propiedad'
    WHEN 'nuda_propiedad' THEN 'nuda\s*propiedad|nudo\s*propietario'
    WHEN 'usufructo'      THEN 'usufruct'
    WHEN 'ganancial'      THEN 'ganancial|gananciales|sociedad\s*conyugal'
    ELSE NULL   -- 'otro' no tiene derecho citable: nunca da evidencia apta
  END;
$$;

-- Clasificación de derecho. Fuente principal: rol_literal real de la fila.
-- Desconocido -> 'otro'. Ganancial en capa separada. Nunca pleno por defecto.
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
      OR coalesce(p_rol_literal,'') ~* '(pleno\s*dominio|plena\s*propiedad)' THEN 'pleno_dominio'
    ELSE 'otro'
  END;
$$;

-- Vigencia EXPLÍCITA de la nota. Nunca processed_at/created_at: dos copias
-- idénticas procesadas en días distintos NO son contradictorias.
CREATE OR REPLACE FUNCTION public.p0_nota_vigencia(p_sj jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(
    nullif(btrim(coalesce(
      p_sj ->> 'fecha_emision_nota',
      p_sj ->> 'fecha_nota',
      p_sj ->> 'fecha_registral',
      p_sj ->> 'valid_from',
      p_sj #>> '{vigencia,desde}'
    )), '')
    || coalesce('/' || nullif(btrim(coalesce(p_sj ->> 'valid_to', p_sj #>> '{vigencia,hasta}')), ''), ''),
    'sin vigencia');
$$;

-- Clave de unidad registral fiable a partir de la propia nota.
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
        n.sj ->> 'idufir', n.sj ->> 'idufir_cru', n.sj ->> 'cru',
        n.sj ->> 'finca_registral', n.sj ->> 'numero_finca',
        n.sj #>> '{finca,idufir}', n.sj #>> '{finca,numero}',
        n.sj #>> '{registro,finca}',
        n.sj ->> 'referencia_catastral', n.sj #>> '{finca,referencia_catastral}'
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
  'Sin DH: building:<id>. Con DH: solo clave registral fiable de la nota; si no existe devuelve NULL (dh_sin_unidad_registral).';

-- ---------------------------------------------------------------------
-- 3) Firma de nota: rol_literal + derecho + porcentaje + régimen + vigencia
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_nota_signature(p_nota_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH n AS (
    SELECT public.p0_nota_vigencia(ns.structured_json) AS vigencia
    FROM public.notas_simples ns WHERE ns.id = p_nota_id
  ), t AS (
    SELECT
      coalesce(
        nullif(upper(regexp_replace(coalesce(x.cif_dni,''), '[^A-Za-z0-9]', '', 'g')), ''),
        public.norm_person_name(x.nombre_extraido),
        '(sin identidad)'
      ) AS ident,
      lower(btrim(coalesce(
        nullif(btrim(to_jsonb(x) ->> 'rol_literal'), ''),
        nullif(btrim(x.metadatos ->> 'rol_literal'), ''),
        '(sin rol literal)'
      ))) AS rol_literal,
      public.p0_right_type_from_rol(
        x.rol::text,
        coalesce(nullif(btrim(to_jsonb(x) ->> 'rol_literal'), ''), x.metadatos ->> 'rol_literal'),
        x.nombre_extraido) AS derecho,
      coalesce(round(x.porcentaje::numeric, 2)::text, 'NULL') AS pct,
      coalesce(nullif(btrim(coalesce(x.metadatos ->> 'regimen','')), ''), 'desconocido') AS regimen
    FROM public.nota_simple_titulares x WHERE x.nota_simple_id = p_nota_id
  )
  SELECT coalesce(
           (SELECT string_agg(t.ident || '|' || t.rol_literal || '|' || t.derecho || '|' || t.pct || '|' || t.regimen, ';'
                              ORDER BY t.ident, t.derecho, t.pct, t.rol_literal, t.regimen) FROM t),
           '(sin titulares)')
         || '@' || coalesce((SELECT n.vigencia FROM n), 'sin vigencia');
$$;

COMMENT ON FUNCTION public.p0_nota_signature(uuid) IS
  'Firma determinista: identidad + rol_literal + derecho + porcentaje + régimen + vigencia explícita. 60/40 y 50/50 difieren; dos copias idénticas procesadas otro día comparten firma (duplicado, no contradicción).';

-- ---------------------------------------------------------------------
-- 4) Evidencia triple real (flags separados, sin inventar página/offset)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_evidence_check(p_titular_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t          jsonb;
  v_nota     uuid;
  v_nombre   text;
  v_nn       text;
  v_pct      numeric;
  v_right    text;
  v_rx_right text;
  v_rx_pct   text;
  v_raw      text;
  v_sj       jsonb;
  v_evid     jsonb;
  v_cita     text;
  v_ok_tit   boolean := false;
  v_ok_der   boolean := false;
  v_ok_pct   boolean := false;
  v_traz     boolean := false;
  v_fuente   text := 'ninguna';
  v_ref      text := NULL;
  r          jsonb;
BEGIN
  SELECT to_jsonb(x) INTO t FROM public.nota_simple_titulares x WHERE x.id = p_titular_id;
  IF t IS NULL THEN
    RETURN jsonb_build_object('titular_ok', false, 'derecho_ok', false, 'porcentaje_ok', false,
                              'trazable', false, 'evidence_ok', false, 'fuente', 'ninguna', 'cita', NULL);
  END IF;

  v_nota   := (t ->> 'nota_simple_id')::uuid;
  v_nombre := t ->> 'nombre_extraido';
  v_nn     := public.norm_person_name(v_nombre);
  v_pct    := nullif(t ->> 'porcentaje','')::numeric;
  v_right  := public.p0_right_type_from_rol(
                t ->> 'rol',
                coalesce(nullif(btrim(t ->> 'rol_literal'), ''), (t -> 'metadatos') ->> 'rol_literal'),
                v_nombre);
  v_rx_right := public.p0_right_regex(v_right);
  v_rx_pct   := public.p0_pct_regex(v_pct);

  SELECT ns.raw_pdf_text, ns.structured_json INTO v_raw, v_sj
  FROM public.notas_simples ns WHERE ns.id = v_nota;

  -- (a) FUENTE PRINCIPAL: columna evidencia del propio titular.
  v_evid := CASE
              WHEN jsonb_typeof(t -> 'evidencia') = 'object' THEN t -> 'evidencia'
              WHEN jsonb_typeof(t -> 'evidencia') = 'string'
                THEN jsonb_build_object('cita', t ->> 'evidencia')
              ELSE NULL
            END;

  IF v_evid IS NOT NULL THEN
    v_cita := nullif(btrim(coalesce(v_evid ->> 'cita', v_evid ->> 'texto', v_evid ->> 'snippet','')), '');
    v_ref  := coalesce(v_evid ->> 'pagina', v_evid ->> 'page', v_evid ->> 'ruta', v_evid ->> 'path', v_evid ->> 'offset');
    IF v_cita IS NOT NULL THEN
      v_fuente := 'titular.evidencia';
      v_ok_tit := v_nn IS NOT NULL AND public.norm_person_name(v_cita) LIKE '%' || v_nn || '%';
      v_ok_der := v_rx_right IS NOT NULL AND v_cita ~* v_rx_right;
      v_ok_pct := v_rx_pct IS NOT NULL AND v_cita ~ v_rx_pct;
      v_traz   := true;  -- la propia cita es la traza
      -- coherencia opcional declarada dentro de la evidencia
      IF (v_evid ->> 'derecho') IS NOT NULL THEN
        v_ok_der := v_ok_der AND public.p0_right_type_from_rol(NULL, v_evid ->> 'derecho', NULL) = v_right;
      END IF;
      IF (v_evid ->> 'porcentaje') IS NOT NULL THEN
        v_ok_pct := v_ok_pct AND v_pct IS NOT NULL
                    AND abs((v_evid ->> 'porcentaje')::numeric - v_pct) <= 0.01;
      END IF;
    END IF;
  END IF;

  -- (b) FALLBACK 1: texto bruto. La MISMA cita debe traer titular + SU derecho + SU porcentaje.
  IF NOT (v_ok_tit AND v_ok_der AND v_ok_pct) AND v_raw IS NOT NULL AND v_nn IS NOT NULL
     AND v_rx_right IS NOT NULL AND v_rx_pct IS NOT NULL THEN
    SELECT frag INTO v_cita
    FROM (
      SELECT btrim(f) AS frag
      FROM regexp_split_to_table(v_raw, '(?<=[.;\n])\s+') AS f
    ) s
    WHERE public.norm_person_name(s.frag) LIKE '%' || v_nn || '%'
      AND s.frag ~* v_rx_right
      AND s.frag ~ v_rx_pct
    LIMIT 1;

    IF v_cita IS NOT NULL THEN
      v_fuente := 'raw_pdf_text';
      v_ok_tit := true; v_ok_der := true; v_ok_pct := true; v_traz := true;
      v_ref := NULL;  -- no se inventa página ni offset
    END IF;
  END IF;

  -- (c) FALLBACK 2: structured_json. El MISMO elemento del MISMO titular debe
  -- mapear al mismo right_type, al mismo porcentaje (<=0,01) y traer cita o ruta.
  IF NOT (v_ok_tit AND v_ok_der AND v_ok_pct) AND jsonb_typeof(v_sj -> 'titulares') = 'array' THEN
    SELECT jsonb_build_object(
             'cita', nullif(btrim(coalesce(tj ->> 'cita', tj ->> 'texto','')), ''),
             'ruta', coalesce(tj ->> 'pagina', tj ->> 'page', tj ->> 'ruta', tj ->> 'path'))
      INTO r
    FROM jsonb_array_elements(v_sj -> 'titulares') tj
    WHERE public.norm_person_name(tj ->> 'nombre') = v_nn
      AND v_right <> 'otro'
      AND public.p0_right_type_from_rol(NULL, coalesce(tj ->> 'derecho', tj ->> 'rol'), NULL) = v_right
      AND v_pct IS NOT NULL
      AND (tj ->> 'porcentaje') IS NOT NULL
      AND abs((tj ->> 'porcentaje')::numeric - v_pct) <= 0.01
      AND coalesce(nullif(btrim(coalesce(tj ->> 'cita', tj ->> 'texto','')), ''),
                   tj ->> 'pagina', tj ->> 'page', tj ->> 'ruta', tj ->> 'path') IS NOT NULL
    LIMIT 1;

    IF r IS NOT NULL THEN
      v_fuente := 'structured_json';
      v_ok_tit := true; v_ok_der := true; v_ok_pct := true; v_traz := true;
      v_cita := r ->> 'cita';
      v_ref  := r ->> 'ruta';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'titular_ok',    coalesce(v_ok_tit,false),
    'derecho_ok',    coalesce(v_ok_der,false),
    'porcentaje_ok', coalesce(v_ok_pct,false),
    'trazable',      coalesce(v_traz,false),
    'evidence_ok',   coalesce(v_ok_tit,false) AND coalesce(v_ok_der,false)
                     AND coalesce(v_ok_pct,false) AND coalesce(v_traz,false),
    'fuente',        v_fuente,
    'cita',          v_cita,
    'ruta',          v_ref,
    'right_type',    v_right,
    'porcentaje',    v_pct);
END $$;

COMMENT ON FUNCTION public.p0_evidence_check(uuid) IS
  'Evidencia triple: titular_ok + derecho_ok (el derecho de ESA fila) + porcentaje_ok (tolerando coma/punto y %) + trazable. Fuente: titular.evidencia > raw_pdf_text > structured_json. No inventa página ni offset.';

-- ---------------------------------------------------------------------
-- 5) Staging read-only, 1:1 con nota_simple_titulares
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_p0_rights_staging AS
WITH tit AS (
  SELECT
    t.id AS titular_id, ns.id AS nota_id, ns.building_id, ns.status AS nota_status,
    t.nombre_extraido,
    (to_jsonb(t) ->> 'owner_id')::uuid   AS pre_owner_id,
    (to_jsonb(t) ->> 'company_id')::uuid AS pre_company_id,
    nullif(upper(regexp_replace(coalesce(t.cif_dni,''), '[^A-Za-z0-9]', '', 'g')), '') AS dni,
    t.porcentaje,
    coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''),
             nullif(btrim(t.metadatos ->> 'rol_literal'), '')) AS rol_literal,
    nullif(btrim(coalesce(t.metadatos ->> 'regimen','')), '') AS regimen_literal,
    public.norm_person_name(t.nombre_extraido) AS nn,
    public.p0_right_type_from_rol(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal'),
      t.nombre_extraido) AS right_type,
    public.p0_nota_unit_key(ns.id)   AS unit_key,
    public.p0_nota_signature(ns.id)  AS nota_signature,
    public.p0_evidence_check(t.id)   AS ev,
    coalesce(b.division_horizontal, false) AS dh,
    ns.structured_json AS sj, ns.processed_at, ns.created_at
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  LEFT JOIN public.buildings b ON b.id = ns.building_id
  WHERE ns.building_id IS NOT NULL
), soc AS (
  SELECT tit.*,
    (tit.pre_company_id IS NOT NULL
     OR tit.nombre_extraido ~* '(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|PATRIMONI|CAPITAL)\M'
     OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]') AS es_sociedad
  FROM tit
), nota_meta AS (
  SELECT nota_id, unit_key, nota_signature, nota_status, processed_at, created_at, sj,
         count(*) AS n_titulares,
         count(*) FILTER (WHERE porcentaje IS NOT NULL) AS n_con_pct,
         count(*) FILTER (WHERE dni IS NOT NULL) AS n_con_dni
  FROM soc
  GROUP BY nota_id, unit_key, nota_signature, nota_status, processed_at, created_at, sj
), canon AS (
  SELECT DISTINCT ON (unit_key) unit_key, nota_id
  FROM nota_meta
  WHERE unit_key IS NOT NULL AND nota_status = 'listo'
  ORDER BY unit_key,
           n_con_pct DESC, n_con_dni DESC, n_titulares DESC,
           public.p0_nota_vigencia(sj) DESC NULLS LAST,
           processed_at DESC NULLS LAST, created_at DESC, nota_id
), unit_state AS (
  SELECT unit_key,
         count(DISTINCT nota_signature) FILTER (WHERE nota_status = 'listo') AS n_firmas
  FROM nota_meta WHERE unit_key IS NOT NULL GROUP BY unit_key
), m_dni AS (   -- DNI exacto e inequívoco: única vía que puede alimentar cuota
  SELECT s.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
  FROM soc s
  JOIN public.owners o
    ON nullif(upper(regexp_replace(coalesce(o.metadatos ->> 'dni__nif__cif',''), '[^A-Za-z0-9]', '', 'g')), '') = s.dni
  WHERE s.dni IS NOT NULL AND o.merged_into IS NULL AND NOT s.es_sociedad
  GROUP BY s.titular_id
), m_nom AS (   -- nombre exacto: conserva vínculo, NUNCA alimenta cuota
  SELECT s.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
  FROM soc s
  JOIN public.owners o ON public.norm_person_name(o.nombre) = s.nn
  WHERE s.nn IS NOT NULL AND o.merged_into IS NULL AND NOT s.es_sociedad
  GROUP BY s.titular_id
), m_cif AS (   -- sociedades: CIF exacto contra companies.cif
  SELECT s.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
  FROM soc s
  JOIN public.companies k
    ON nullif(upper(regexp_replace(coalesce(to_jsonb(k) ->> 'cif',''), '[^A-Za-z0-9]', '', 'g')), '') = s.dni
  WHERE s.es_sociedad AND s.dni IS NOT NULL
  GROUP BY s.titular_id
), m_comp AS ( -- sociedades por nombre único: match REVISABLE, nunca prueba
  SELECT s.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
  FROM soc s
  JOIN public.companies k ON public.norm_person_name(k.nombre) = s.nn
  WHERE s.es_sociedad AND s.nn IS NOT NULL
  GROUP BY s.titular_id
), base AS (
  SELECT s.*,
    (c.nota_id IS NOT NULL) AS is_canonical,
    (coalesce(us.n_firmas, 0) > 1) AS unidad_contradictoria,
    (s.porcentaje IS NULL) AS percentage_null,
    (s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL) AS conflicto_ids,
    -- Vínculos: se CONSERVAN los preexistentes; nunca se elige entre ambos.
    coalesce(s.pre_owner_id,
             CASE WHEN NOT s.es_sociedad THEN
               CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id END
             END) AS f_owner_id,
    coalesce(s.pre_company_id,
             CASE WHEN s.es_sociedad THEN
               CASE WHEN mf.n = 1 THEN mf.company_id WHEN mc.n = 1 THEN mc.company_id END
             END) AS f_company_id,
    -- Solo un DNI exacto e inequívoco habilita cuota personal.
    (md.n = 1 AND (s.pre_owner_id IS NULL OR s.pre_owner_id = md.owner_id)) AS dni_inequivoco,
    CASE
      WHEN s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL THEN 'conflicto_owner_y_company'
      WHEN s.es_sociedad AND s.pre_company_id IS NOT NULL THEN 'company_preexistente'
      WHEN s.es_sociedad AND mf.n = 1 THEN 'cif'
      WHEN s.es_sociedad AND mc.n = 1 THEN 'nombre_sociedad_revisable'
      WHEN s.es_sociedad THEN 'ninguno'
      WHEN md.n = 1 THEN 'dni'
      WHEN s.pre_owner_id IS NOT NULL THEN 'owner_preexistente'
      WHEN mn.n = 1 THEN 'nombre_exacto'
      WHEN coalesce(md.n,0) > 1 OR coalesce(mn.n,0) > 1 THEN 'ambiguo'
      ELSE 'ninguno'
    END AS identity_match,
    CASE WHEN md.n = 1 THEN 1.0 WHEN mf.n = 1 THEN 0.9
         WHEN s.pre_owner_id IS NOT NULL OR s.pre_company_id IS NOT NULL THEN 0.7
         WHEN mn.n = 1 OR mc.n = 1 THEN 0.6 ELSE 0.3 END AS confidence,
    jsonb_build_object('pre_owner_id', s.pre_owner_id, 'pre_company_id', s.pre_company_id,
                       'dni_matches', coalesce(md.n,0), 'nombre_matches', coalesce(mn.n,0),
                       'cif_matches', coalesce(mf.n,0), 'nombre_sociedad_matches', coalesce(mc.n,0)) AS audit_ids
  FROM soc s
  LEFT JOIN canon c ON c.unit_key = s.unit_key AND c.nota_id = s.nota_id
  LEFT JOIN unit_state us ON us.unit_key = s.unit_key
  LEFT JOIN m_dni md ON md.titular_id = s.titular_id
  LEFT JOIN m_nom mn ON mn.titular_id = s.titular_id
  LEFT JOIN m_cif mf ON mf.titular_id = s.titular_id
  LEFT JOIN m_comp mc ON mc.titular_id = s.titular_id
), capa AS (
  -- Cierre de capa: por unidad + nota canónica + right_type
  SELECT unit_key, nota_id, right_type,
         sum(porcentaje) AS capa_suma,
         count(*) FILTER (WHERE porcentaje IS NULL) AS capa_nulos,
         count(*) AS capa_filas,
         count(DISTINCT coalesce(dni, nn, titular_id::text)) AS capa_identidades
  FROM base
  WHERE is_canonical AND unit_key IS NOT NULL
  GROUP BY unit_key, nota_id, right_type
), evaluada AS (
  SELECT b.*,
    (b.ev ->> 'evidence_ok')::boolean AS evidence_ok,
    k.capa_suma, k.capa_nulos,
    (k.capa_nulos = 0
     AND k.capa_identidades = k.capa_filas
     AND abs(coalesce(k.capa_suma, -1) - 100) <= 0.01) AS layer_complete
  FROM base b
  LEFT JOIN capa k
    ON k.unit_key = b.unit_key AND k.nota_id = b.nota_id AND k.right_type = b.right_type
   AND b.is_canonical
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
  e.conflicto_ids, e.identity_match, e.confidence,
  e.evidence_ok, e.ev AS evidence_ref, e.audit_ids,
  e.rol_literal AS right_literal,
  e.es_sociedad, e.dh, e.nota_status, e.unidad_contradictoria,
  e.capa_suma, e.capa_nulos, coalesce(e.layer_complete, false) AS layer_complete,
  CASE WHEN e.unit_key IS NULL AND e.dh THEN 'dh_sin_unidad_registral' END AS unit_block_reason,
  CASE WHEN e.is_canonical THEN 'active' ELSE 'superseded' END AS status,
  (
    e.conflicto_ids
    OR e.right_type IN ('otro','ganancial')
    OR NOT (e.ev ->> 'evidence_ok')::boolean
    OR e.percentage_null
    OR (e.f_owner_id IS NULL AND e.f_company_id IS NULL)
    OR e.unit_key IS NULL
    OR e.unidad_contradictoria
    OR NOT e.is_canonical
    OR (e.right_type = 'pleno_dominio' AND e.is_canonical AND NOT coalesce(e.layer_complete,false))
    OR (NOT e.es_sociedad AND NOT e.dni_inequivoco)
  ) AS review_flag,
  nullif(concat_ws(' · ',
    CASE WHEN e.conflicto_ids THEN 'el titular trae owner_id y company_id a la vez: caso bloqueado, se conservan ambos IDs en auditoría' END,
    CASE WHEN e.right_type = 'otro' THEN 'rol registral desconocido: se clasifica como "otro" (nunca pleno dominio)' END,
    CASE WHEN e.right_type = 'ganancial' THEN 'carácter ganancial: capa separada, no se reparte entre cónyuges' END,
    CASE WHEN NOT (e.ev ->> 'evidence_ok')::boolean THEN
      'evidencia insuficiente (titular=' || (e.ev ->> 'titular_ok') ||
      ', derecho=' || (e.ev ->> 'derecho_ok') ||
      ', porcentaje=' || (e.ev ->> 'porcentaje_ok') ||
      ', trazable=' || (e.ev ->> 'trazable') || ')' END,
    CASE WHEN e.percentage_null THEN 'porcentaje ausente en la nota' END,
    CASE WHEN e.f_owner_id IS NULL AND e.f_company_id IS NULL THEN 'titular registral sin conciliar con el CRM (sin owner ni company)' END,
    CASE WHEN NOT e.es_sociedad AND e.f_owner_id IS NOT NULL AND NOT e.dni_inequivoco
         THEN 'vínculo conservado sin DNI exacto e inequívoco: no puede alimentar cuota' END,
    CASE WHEN e.identity_match = 'nombre_sociedad_revisable' THEN 'sociedad emparejada solo por nombre: match revisable, nunca prueba automática' END,
    CASE WHEN e.unit_key IS NULL AND e.dh THEN 'división horizontal sin clave de unidad registral fiable (dh_sin_unidad_registral)' END,
    CASE WHEN e.unit_key IS NULL AND NOT e.dh THEN 'sin unidad de titularidad resoluble' END,
    CASE WHEN e.unidad_contradictoria THEN 'la unidad tiene notas con firmas registrales distintas (contradicción)' END,
    CASE WHEN NOT e.is_canonical THEN 'nota no canónica de la unidad: se conserva para auditoría, no opera' END,
    CASE WHEN e.right_type = 'pleno_dominio' AND e.is_canonical AND NOT coalesce(e.layer_complete,false)
         THEN 'capa de pleno dominio no cierra al 100%' END
  ), '') AS review_reason,
  (
    e.is_canonical
    AND e.right_type = 'pleno_dominio'
    AND coalesce(e.layer_complete,false)
    AND NOT e.conflicto_ids
    AND e.f_owner_id IS NOT NULL
    AND e.f_company_id IS NULL
    AND e.dni_inequivoco
    AND (e.ev ->> 'evidence_ok')::boolean
    AND NOT e.percentage_null
    AND e.unit_key IS NOT NULL
    AND NOT e.unidad_contradictoria
  ) AS feeds_cuota
FROM evaluada e;

-- Derechos registrales crudos: NO se exponen a cualquier autenticado.
REVOKE ALL ON public.v_p0_rights_staging FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_rights_staging TO service_role;

COMMENT ON VIEW public.v_p0_rights_staging IS
  'Staging read-only 1:1 con nota_simple_titulares. Solo la nota canónica de cada ownership_unit_key queda active. Solo pleno dominio con capa completa (100% ±0,01), DNI inequívoco y evidencia triple alimenta cuota.';

-- ---------------------------------------------------------------------
-- 6) Dry-run sin escrituras
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
    count(*) FILTER (WHERE conflicto_ids) AS conflicto_owner_y_company,
    count(*) FILTER (WHERE unit_block_reason = 'dh_sin_unidad_registral') AS dh_sin_unidad,
    count(*) FILTER (WHERE evidence_ok) AS evidence_ok,
    count(*) FILTER (WHERE NOT evidence_ok) AS evidence_missing,
    count(*) FILTER (WHERE is_canonical) AS filas_canonicas,
    count(*) FILTER (WHERE feeds_cuota) AS feeds_cuota,
    count(*) FILTER (WHERE feeds_cuota AND right_type <> 'pleno_dominio') AS bad_no_pleno_feeds,
    count(*) FILTER (WHERE feeds_cuota AND owner_id IS NULL) AS bad_unmatched_feeds,
    count(*) FILTER (WHERE feeds_cuota AND conflicto_ids) AS bad_conflicto_feeds,
    count(*) FILTER (WHERE feeds_cuota AND unidad_contradictoria) AS bad_contradiccion_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT is_canonical) AS bad_no_canonica_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT layer_complete) AS bad_capa_incompleta_feeds
  FROM s
), capas AS (
  SELECT ownership_unit_key, note_simple_id, right_type, bool_or(layer_complete) AS ok
  FROM s WHERE is_canonical AND ownership_unit_key IS NOT NULL
  GROUP BY ownership_unit_key, note_simple_id, right_type
), c AS (
  SELECT count(*) FILTER (WHERE ok) AS capas_completas,
         count(*) FILTER (WHERE NOT ok) AS capas_incompletas
  FROM capas
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
  'conflicto_owner_y_company', agg.conflicto_owner_y_company,
  'dh_sin_unidad', agg.dh_sin_unidad,
  'evidence_ok', agg.evidence_ok,
  'evidence_missing', agg.evidence_missing,
  'unidades', u.unidades,
  'notas_canonicas', u.notas_canonicas,
  'filas_canonicas', agg.filas_canonicas,
  'duplicados_identicos', u.duplicados_identicos,
  'contradicciones', u.contradicciones,
  'capas_completas', c.capas_completas,
  'capas_incompletas', c.capas_incompletas,
  'bad_capa_incompleta_feeds', agg.bad_capa_incompleta_feeds,
  'feeds_cuota', agg.feeds_cuota,
  'por_derecho', coalesce(por_derecho.j, '{}'::jsonb),
  'invariants', jsonb_build_object(
    'staged_igual_source', agg.staged_rows = src.n,
    'todas_con_building_id', agg.staged_con_building = agg.staged_rows,
    'titular_unico', agg.titulares_unicos = agg.staged_rows,
    'conflicto_no_alimenta_cuota', agg.bad_conflicto_feeds = 0,
    'ningun_unmatched_alimenta_cuota', agg.bad_unmatched_feeds = 0,
    'solo_pleno_alimenta_cuota', agg.bad_no_pleno_feeds = 0,
    'solo_canonica_alimenta_cuota', agg.bad_no_canonica_feeds = 0,
    'solo_capa_completa_alimenta_cuota', agg.bad_capa_incompleta_feeds = 0,
    'max_una_canonica_por_unidad', u.unidades_multi_canonica = 0,
    'contradiccion_no_alimenta_cuota', agg.bad_contradiccion_feeds = 0
  ),
  'invariants_ok', (
    agg.staged_rows = src.n
    AND agg.staged_con_building = agg.staged_rows
    AND agg.titulares_unicos = agg.staged_rows
    AND agg.bad_conflicto_feeds = 0
    AND agg.bad_unmatched_feeds = 0
    AND agg.bad_no_pleno_feeds = 0
    AND agg.bad_no_canonica_feeds = 0
    AND agg.bad_capa_incompleta_feeds = 0
    AND u.unidades_multi_canonica = 0
    AND agg.bad_contradiccion_feeds = 0
  ),
  'applied', false,
  'real_rebuild', 'disabled'
) FROM src, agg, c, por_derecho, u;
$$;

REVOKE ALL ON FUNCTION public.p0_property_rights_dry_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_property_rights_dry_run() TO service_role;

-- ---------------------------------------------------------------------
-- 7) Rebuild REAL deshabilitado en esta Wave
--    No hay ningún camino que archive, borre o inserte en la tabla real.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.p0_rebuild_property_rights(text);

CREATE OR REPLACE FUNCTION public.p0_rebuild_property_rights(
  p_reason text DEFAULT 'wave1a',
  p_apply  boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF p_apply THEN
    RAISE EXCEPTION 'REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL'
      USING ERRCODE = 'raise_exception';
  END IF;

  RETURN public.p0_property_rights_dry_run()
         || jsonb_build_object('applied', false, 'reason', p_reason,
                               'motivo', 'Wave 1A.1: rebuild real deshabilitado, solo dry-run');
END $$;

REVOKE ALL ON FUNCTION public.p0_rebuild_property_rights(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_rebuild_property_rights(text, boolean) TO service_role;

COMMENT ON FUNCTION public.p0_rebuild_property_rights(text, boolean) IS
  'Wave 1A.1: p_apply=false devuelve el dry-run; p_apply=true lanza REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL. No escribe en building_property_rights.';

REVOKE ALL ON FUNCTION public.p0_nota_unit_key(uuid)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_signature(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_evidence_check(uuid)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_vigencia(jsonb)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_pct_regex(numeric)         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_regex(text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_type_from_rol(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_nota_unit_key(uuid)      TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_signature(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_evidence_check(uuid)     TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_vigencia(jsonb)     TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_pct_regex(numeric)       TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_regex(text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_type_from_rol(text, text, text) TO service_role;