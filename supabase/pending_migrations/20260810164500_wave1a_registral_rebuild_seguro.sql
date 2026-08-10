-- =====================================================================
-- WAVE 1A.2 · Corrección registral: staging + dry-run seguros
-- MIGRACIÓN NO APLICADA. Posterior a 20260810145734.
-- El rebuild REAL sigue DESHABILITADO: no existe ningún camino que
-- archive, borre o inserte en public.building_property_rights.
-- No toca compute_score_total, v_v5_task_candidates, recompute, Vigía,
-- reparse, UI, HubSpot, tareas, scores ni cuotas.
--
-- Correcciones de esta Wave frente a 1A.1:
--  1) DERECHO != RÉGIMEN: right_type solo pleno_dominio|nuda_propiedad|
--     usufructo|otro. ganancial/privativo/proindiviso van a
--     coownership_regime y nunca sustituyen al derecho.
--  2) CONFLICTO DE FUENTES: rol y rol_literal se parsean por separado;
--     si ambos son reconocibles y discrepan -> role_conflict.
--  3) EVIDENCIA REAL: marcador porcentual explícito, asociación
--     inequívoca titular+derecho+porcentaje, flags evidence_ambiguous y
--     bad_evidence.
--  4) FECHA REGISTRAL parseada a date (ISO y DD/MM/YYYY); processed_at
--     solo desempata copias de firma idéntica.
--  5) FIRMA canónica sin rol_literal crudo.
--  6) DIVISIÓN HORIZONTAL nunca alimenta cuota de edificio.
--  7) identity_match con vocabulario alineado al emitido por staging.
--  8) DRY-RUN coherente: gate y resumen sobre status='listo'.
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
  ADD COLUMN IF NOT EXISTS ownership_unit_key   text,
  ADD COLUMN IF NOT EXISTS is_canonical         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nota_signature       text,
  ADD COLUMN IF NOT EXISTS unit_block_reason    text,
  ADD COLUMN IF NOT EXISTS layer_complete       boolean,
  ADD COLUMN IF NOT EXISTS evidence_ok          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS coownership_regime   text,
  ADD COLUMN IF NOT EXISTS right_literal        text,
  ADD COLUMN IF NOT EXISTS role_conflict        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS evidence_ambiguous   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bad_evidence         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS nota_fecha_registral date;

-- (1) DERECHO != RÉGIMEN: vocabulario cerrado de derechos reales.
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_right_type_vocab;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_right_type_vocab
  CHECK (right_type IN ('pleno_dominio','nuda_propiedad','usufructo','otro'))
  NOT VALID;

-- (1) Régimen de cotitularidad: nunca ocupa el lugar del derecho.
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_coownership_regime_vocab;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_coownership_regime_vocab
  CHECK (coownership_regime IS NULL
         OR coownership_regime IN ('gananciales','privativo','proindiviso','desconocido'))
  NOT VALID;

-- (7) identity_match: vocabulario alineado 1:1 con lo que emite el staging.
--     El futuro rebuild no puede fallar por su propio CHECK.
ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_identity_match_vocab;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_identity_match_vocab
  CHECK (identity_match IS NULL OR identity_match IN (
    'dni',
    'cif',
    'nombre_exacto',
    'aproximado',
    'ninguno',
    'owner_preexistente',
    'company_preexistente',
    'ambiguo',
    'conflicto_owner_y_company',
    'nombre_sociedad_revisable'
  )) NOT VALID;

CREATE INDEX IF NOT EXISTS idx_bpr_unit ON public.building_property_rights(ownership_unit_key);
CREATE INDEX IF NOT EXISTS idx_bpr_canonical ON public.building_property_rights(building_id, is_canonical);

-- IMPORTANTE: NO se crea ningún UNIQUE INDEX sobre titular_id en la tabla real.
-- Los datos históricos pueden contener duplicados y la unicidad haría fallar la
-- propia migración. La unicidad de titular_id se valida SOLO en staging/dry-run
-- y se materializará en una fase de aplicación posterior, nunca aquí.
-- (9) NO se elimina ningún índice ni protección existente: cualquier
--     DROP INDEX queda expresamente prohibido en esta Wave.

-- ---------------------------------------------------------------------
-- 2) Helpers deterministas
-- ---------------------------------------------------------------------

-- (3) Regex de porcentaje con MARCADOR OBLIGATORIO (% o "por ciento").
-- Un número suelto (finca, folio, tomo) NUNCA es evidencia de porcentaje.
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
         || '\s*(%|por\s*cien(to)?)'
  END;
$$;

COMMENT ON FUNCTION public.p0_pct_regex(numeric) IS
  'Regex de porcentaje con marcador obligatorio (% o "por ciento"). Un número sin marcador (finca/folio) no es evidencia.';

-- Parseo seguro de porcentajes textuales. Nunca lanza excepción de cast.
CREATE OR REPLACE FUNCTION public.p0_parse_pct(p_txt text)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  WITH v AS (
    SELECT btrim(regexp_replace(coalesce(p_txt,''), '(%|por\s*cien(to)?|\s)', '', 'gi')) AS s
  ), n AS (
    SELECT replace(v.s, ',', '.') AS s FROM v
  )
  SELECT CASE WHEN n.s ~ '^[+-]?[0-9]+(\.[0-9]+)?$' THEN n.s::numeric ELSE NULL END
  FROM n;
$$;

COMMENT ON FUNCTION public.p0_parse_pct(text) IS
  'Parseo tolerante y seguro de porcentajes textuales (coma/punto/%/espacios). Devuelve NULL ante valor no numérico; nunca lanza excepción de cast.';

-- (3) Valores porcentuales REALES presentes en una cita: solo los que llevan
-- marcador (% / por ciento) o fracción semántica explícita (a/b). Se descartan
-- los valores fuera de (0,100]: un "15/01/2026" o un número de finca no cuentan.
CREATE OR REPLACE FUNCTION public.p0_cita_pct_values(p_txt text)
RETURNS numeric[] LANGUAGE sql IMMUTABLE AS $$
  WITH pct AS (
    SELECT round(public.p0_parse_pct(m[1]), 2) AS v
    FROM regexp_matches(coalesce(p_txt,''),
         '([0-9]{1,3}(?:[.,][0-9]{1,4})?)\s*(?:%|por\s*cien(?:to)?)', 'gi') AS m
  ), frac AS (
    SELECT round((m[1]::numeric / nullif(m[2]::numeric, 0)) * 100, 2) AS v
    FROM regexp_matches(coalesce(p_txt,''), '([0-9]{1,4})\s*/\s*([0-9]{1,4})', 'g') AS m
  ), todos AS (
    SELECT v FROM pct UNION ALL SELECT v FROM frac
  )
  SELECT coalesce(array_agg(DISTINCT v), '{}'::numeric[])
  FROM todos WHERE v IS NOT NULL AND v > 0 AND v <= 100;
$$;

COMMENT ON FUNCTION public.p0_cita_pct_values(text) IS
  'Porcentajes REALES de una cita: exige % , "por ciento" o fracción semántica a/b. Ignora números sin marcador y valores fuera de (0,100].';

-- (1) Derechos reales canónicos citables. "ganancial" NO es un derecho.
CREATE OR REPLACE FUNCTION public.p0_right_regex(p_right_type text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_right_type
    WHEN 'pleno_dominio'  THEN 'pleno\s*dominio|plena\s*propiedad'
    WHEN 'nuda_propiedad' THEN 'nuda\s*propiedad|nudo\s*propietario'
    WHEN 'usufructo'      THEN 'usufruct'
    ELSE NULL   -- 'otro' no tiene derecho citable: nunca da evidencia apta
  END;
$$;

-- (1)(2) Derechos mencionados en un texto libre, SIN resolver por orden de
-- palabras: se devuelven TODOS los candidatos distintos encontrados.
CREATE OR REPLACE FUNCTION public.p0_right_candidates(p_txt text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_agg(DISTINCT c ORDER BY c), '{}'::text[])
  FROM (
    SELECT 'pleno_dominio'::text AS c WHERE coalesce(p_txt,'') ~* '(pleno\s*dominio|plena\s*propiedad|pleno\s*propietario)'
    UNION ALL
    SELECT 'nuda_propiedad'      WHERE coalesce(p_txt,'') ~* '(nuda\s*propiedad|nudo\s*propietario)'
    UNION ALL
    SELECT 'usufructo'           WHERE coalesce(p_txt,'') ~* 'usufruct'
  ) x;
$$;

-- (2) Derecho declarado por la columna enum t.rol, por separado.
-- 'ganancial' y 'otro' NO informan de derecho real: devuelven NULL.
CREATE OR REPLACE FUNCTION public.p0_right_from_rol(p_rol text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(coalesce(p_rol,'')))
    WHEN 'pleno'           THEN 'pleno_dominio'
    WHEN 'pleno_dominio'   THEN 'pleno_dominio'
    WHEN 'plena_propiedad' THEN 'pleno_dominio'
    WHEN 'nuda_propiedad'  THEN 'nuda_propiedad'
    WHEN 'nuda'            THEN 'nuda_propiedad'
    WHEN 'usufructo'       THEN 'usufructo'
    ELSE NULL
  END;
$$;

-- (2) Derecho declarado por el literal registral, por separado.
-- Varios derechos distintos en el mismo literal => 'ambiguo' (nunca se elige
-- por el orden de aparición de las palabras).
CREATE OR REPLACE FUNCTION public.p0_right_from_literal(p_literal text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN array_length(public.p0_right_candidates(p_literal), 1) IS NULL THEN NULL
    WHEN array_length(public.p0_right_candidates(p_literal), 1) = 1
      THEN (public.p0_right_candidates(p_literal))[1]
    ELSE 'ambiguo'
  END;
$$;

-- (1) Régimen de cotitularidad. Jamás sustituye al derecho.
CREATE OR REPLACE FUNCTION public.p0_canon_regime(p_rol text, p_literal text, p_regimen text, p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH t AS (
    SELECT concat_ws(' ', coalesce(p_rol,''), coalesce(p_literal,''),
                          coalesce(p_regimen,''), coalesce(p_nombre,'')) AS s
  )
  SELECT CASE
    WHEN (SELECT s FROM t) ~* '(ganancial|gananciales|sociedad\s+conyugal)' THEN 'gananciales'
    WHEN (SELECT s FROM t) ~* 'proindiviso'                                  THEN 'proindiviso'
    WHEN (SELECT s FROM t) ~* 'privativ'                                     THEN 'privativo'
    ELSE 'desconocido'
  END;
$$;

COMMENT ON FUNCTION public.p0_canon_regime(text, text, text, text) IS
  'Régimen de cotitularidad canónico: gananciales|privativo|proindiviso|desconocido. Nunca sustituye a right_type.';

-- (1)(2) Derecho canónico definitivo de la fila.
-- Literal registral primario; enum rol como respaldo. Conflicto o ambigüedad
-- => 'otro'. Solo régimen sin derecho real => 'otro'.
CREATE OR REPLACE FUNCTION public.p0_right_type_canonico(p_rol text, p_literal text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (
    SELECT public.p0_right_from_rol(p_rol)         AS r_rol,
           public.p0_right_from_literal(p_literal) AS r_lit
  )
  SELECT CASE
    WHEN (SELECT r_lit FROM d) = 'ambiguo' THEN 'otro'
    WHEN (SELECT r_rol FROM d) IS NOT NULL
     AND (SELECT r_lit FROM d) IS NOT NULL
     AND (SELECT r_rol FROM d) <> (SELECT r_lit FROM d) THEN 'otro'
    WHEN (SELECT r_lit FROM d) IS NOT NULL THEN (SELECT r_lit FROM d)
    WHEN (SELECT r_rol FROM d) IS NOT NULL THEN (SELECT r_rol FROM d)
    ELSE 'otro'
  END;
$$;

-- (2) ¿Discrepan las dos fuentes de rol?
CREATE OR REPLACE FUNCTION public.p0_role_conflict(p_rol text, p_literal text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  WITH d AS (
    SELECT public.p0_right_from_rol(p_rol)         AS r_rol,
           public.p0_right_from_literal(p_literal) AS r_lit
  )
  SELECT COALESCE(
    (SELECT r_lit FROM d) = 'ambiguo'
    OR ((SELECT r_rol FROM d) IS NOT NULL
        AND (SELECT r_lit FROM d) IS NOT NULL
        AND (SELECT r_rol FROM d) <> (SELECT r_lit FROM d)),
    false);
$$;

COMMENT ON FUNCTION public.p0_role_conflict(text, text) IS
  'true si t.rol y rol_literal son ambos reconocibles y discrepan, o si el literal menciona varios derechos. Nunca se resuelve por orden de palabras.';

-- (4) Parser seguro de fecha registral: ISO (YYYY-MM-DD) y DD/MM/YYYY o
-- DD-MM-YYYY. Cualquier otra cosa => NULL. Nunca lanza excepción.
CREATE OR REPLACE FUNCTION public.p0_parse_fecha_registral(p_txt text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; m text[];
BEGIN
  s := btrim(coalesce(p_txt,''));
  IF s = '' THEN RETURN NULL; END IF;

  m := regexp_match(s, '^([0-9]{4})-([0-9]{2})-([0-9]{2})');
  IF m IS NOT NULL THEN
    BEGIN
      RETURN make_date(m[1]::int, m[2]::int, m[3]::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  m := regexp_match(s, '^([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})');
  IF m IS NOT NULL THEN
    BEGIN
      RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.p0_parse_fecha_registral(text) IS
  'Normaliza fechas registrales explícitas (ISO y DD/MM/YYYY o DD-MM-YYYY) a date. Inválida o ausente => NULL. Nunca lanza excepción.';

-- (4) Fecha registral EXPLÍCITA de la nota, ya parseada.
-- NUNCA processed_at/created_at: esos solo desempatan copias idénticas.
CREATE OR REPLACE FUNCTION public.p0_nota_fecha_registral(p_sj jsonb)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT public.p0_parse_fecha_registral(
    coalesce(
      nullif(btrim(coalesce(p_sj ->> 'fecha_emision_nota','')), ''),
      nullif(btrim(coalesce(p_sj ->> 'fecha_nota','')), ''),
      nullif(btrim(coalesce(p_sj ->> 'fecha_registral','')), ''),
      nullif(btrim(coalesce(p_sj ->> 'valid_from','')), ''),
      nullif(btrim(coalesce(p_sj #>> '{vigencia,desde}','')), '')
    ));
$$;

-- Vigencia normalizada para la firma: fecha parseada o 'sin fecha'.
CREATE OR REPLACE FUNCTION public.p0_nota_vigencia(p_sj jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(to_char(public.p0_nota_fecha_registral(p_sj), 'YYYY-MM-DD'), 'sin fecha');
$$;

COMMENT ON FUNCTION public.p0_nota_vigencia(jsonb) IS
  'Vigencia normalizada (fecha registral parseada) para la firma. Nunca usa processed_at/created_at.';

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
    -- NULLIF por CADA candidato antes del COALESCE: una cadena vacía o de solo
    -- espacios NO puede ocultar una clave válida posterior. Se conserva el
    -- namespace de la fuente para que valores iguales de tipos distintos
    -- (idufir 12345 vs finca 12345) no colisionen.
    SELECT n.*, c.ns_fuente, c.clave_norm
    FROM n
    LEFT JOIN LATERAL (
      SELECT v.ns_fuente,
             nullif(upper(regexp_replace(v.valor, '[^A-Za-z0-9]', '', 'g')), '') AS clave_norm
      FROM (
        VALUES
          (1, 'idufir', nullif(btrim(coalesce(n.sj ->> 'idufir','')), '')),
          (2, 'idufir', nullif(btrim(coalesce(n.sj ->> 'idufir_cru','')), '')),
          (3, 'idufir', nullif(btrim(coalesce(n.sj ->> 'cru','')), '')),
          (4, 'idufir', nullif(btrim(coalesce(n.sj #>> '{finca,idufir}','')), '')),
          (5, 'finca',  nullif(btrim(coalesce(n.sj ->> 'finca_registral','')), '')),
          (6, 'finca',  nullif(btrim(coalesce(n.sj ->> 'numero_finca','')), '')),
          (7, 'finca',  nullif(btrim(coalesce(n.sj #>> '{finca,numero}','')), '')),
          (8, 'finca',  nullif(btrim(coalesce(n.sj #>> '{registro,finca}','')), '')),
          (9, 'refcat', nullif(btrim(coalesce(n.sj ->> 'referencia_catastral','')), '')),
          (10,'refcat', nullif(btrim(coalesce(n.sj #>> '{finca,referencia_catastral}','')), ''))
      ) AS v(prioridad, ns_fuente, valor)
      WHERE v.valor IS NOT NULL
        AND nullif(upper(regexp_replace(v.valor, '[^A-Za-z0-9]', '', 'g')), '') IS NOT NULL
      ORDER BY v.prioridad
      LIMIT 1
    ) c ON true
  )
  SELECT CASE
    WHEN k.building_id IS NULL THEN NULL
    WHEN NOT k.dh THEN 'building:' || k.building_id::text
    WHEN k.clave_norm IS NOT NULL
      THEN 'dh:' || k.building_id::text || ':' || k.ns_fuente || ':' || k.clave_norm
    ELSE NULL
  END
  FROM k;
$$;

COMMENT ON FUNCTION public.p0_nota_unit_key(uuid) IS
  'Sin DH: building:<id>. Con DH: dh:<building>:<idufir|finca|refcat>:<clave normalizada>. La unidad DH se conserva y audita, pero NUNCA se proyecta a la cuota del edificio.';

-- ---------------------------------------------------------------------
-- 3) (5) Firma de nota: identidad + derecho canónico + porcentaje
--        normalizado + régimen canónico + vigencia parseada.
--        NO entra el rol_literal crudo: "pleno dominio" y "plena propiedad"
--        firman igual. 60/40 y 50/50 difieren.
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
      public.p0_right_type_canonico(
        x.rol::text,
        coalesce(nullif(btrim(to_jsonb(x) ->> 'rol_literal'), ''), x.metadatos ->> 'rol_literal')
      ) AS derecho,
      coalesce(round(x.porcentaje::numeric, 2)::text, 'NULL') AS pct,
      public.p0_canon_regime(
        x.rol::text,
        coalesce(nullif(btrim(to_jsonb(x) ->> 'rol_literal'), ''), x.metadatos ->> 'rol_literal'),
        x.metadatos ->> 'regimen',
        x.nombre_extraido) AS regimen
    FROM public.nota_simple_titulares x WHERE x.nota_simple_id = p_nota_id
  )
  SELECT coalesce(
           (SELECT string_agg(t.ident || '|' || t.derecho || '|' || t.pct || '|' || t.regimen, ';'
                              ORDER BY t.ident, t.derecho, t.pct, t.regimen) FROM t),
           '(sin titulares)')
         || '@' || coalesce((SELECT n.vigencia FROM n), 'sin fecha');
$$;

COMMENT ON FUNCTION public.p0_nota_signature(uuid) IS
  'Firma determinista: identidad normalizada + right_type canónico + porcentaje normalizado + coownership_regime canónico + fecha registral parseada. Excluye rol_literal crudo.';

-- ---------------------------------------------------------------------
-- 4) (3) Evidencia real: marcador porcentual explícito, asociación
--        inequívoca titular+derecho+porcentaje, sin inventar localizador.
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
  v_lit      text;
  v_rx_right text;
  v_raw      text;
  v_sj       jsonb;
  v_evid     jsonb;
  v_cita     text;
  v_vals     numeric[];
  v_n_nombres int;
  v_n_derechos int;
  v_ok_tit   boolean := false;
  v_ok_der   boolean := false;
  v_ok_pct   boolean := false;
  v_traz     boolean := false;
  v_amb      boolean := false;
  v_bad      boolean := false;
  v_evid_presente boolean := false;
  v_fuente   text := 'ninguna';
  v_ref      text := NULL;
  r          jsonb;
BEGIN
  SELECT to_jsonb(x) INTO t FROM public.nota_simple_titulares x WHERE x.id = p_titular_id;
  IF t IS NULL THEN
    RETURN jsonb_build_object('titular_ok', false, 'derecho_ok', false, 'porcentaje_ok', false,
                              'trazable', false, 'evidence_ok', false,
                              'evidence_ambiguous', false, 'bad_evidence', true,
                              'fuente', 'ninguna', 'cita', NULL);
  END IF;

  v_nota   := (t ->> 'nota_simple_id')::uuid;
  v_nombre := t ->> 'nombre_extraido';
  v_nn     := public.norm_person_name(v_nombre);
  v_pct    := public.p0_parse_pct(t ->> 'porcentaje');
  v_lit    := coalesce(nullif(btrim(t ->> 'rol_literal'), ''), (t -> 'metadatos') ->> 'rol_literal');
  v_right  := public.p0_right_type_canonico(t ->> 'rol', v_lit);
  v_rx_right := public.p0_right_regex(v_right);

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
    v_ref  := coalesce(
                nullif(btrim(coalesce(v_evid ->> 'pagina','')), ''),
                nullif(btrim(coalesce(v_evid ->> 'page','')), ''),
                nullif(btrim(coalesce(v_evid ->> 'ruta','')), ''),
                nullif(btrim(coalesce(v_evid ->> 'path','')), ''),
                nullif(btrim(coalesce(v_evid ->> 'offset','')), ''));
    v_evid_presente := v_cita IS NOT NULL
                       OR nullif(btrim(coalesce(v_evid ->> 'derecho','')), '') IS NOT NULL
                       OR nullif(btrim(coalesce(v_evid ->> 'porcentaje','')), '') IS NOT NULL;

    IF v_cita IS NOT NULL THEN
      v_fuente := 'titular.evidencia';
      v_traz   := true;  -- la propia cita es la traza
      v_ok_tit := v_nn IS NOT NULL AND public.norm_person_name(v_cita) LIKE '%' || v_nn || '%';
      v_ok_der := v_rx_right IS NOT NULL AND v_cita ~* v_rx_right;

      -- Porcentaje: exige marcador real en la MISMA cita.
      v_vals   := public.p0_cita_pct_values(v_cita);
      v_ok_pct := v_pct IS NOT NULL
                  AND EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE abs(x - v_pct) <= 0.01);

      -- Ambigüedad: la cita menciona a varios titulares de la nota, varios
      -- porcentajes o varios derechos distintos.
      SELECT count(*) INTO v_n_nombres
      FROM public.nota_simple_titulares o
      WHERE o.nota_simple_id = v_nota
        AND public.norm_person_name(o.nombre_extraido) IS NOT NULL
        AND public.norm_person_name(v_cita) LIKE '%' || public.norm_person_name(o.nombre_extraido) || '%';
      v_n_derechos := coalesce(array_length(public.p0_right_candidates(v_cita), 1), 0);
      v_amb := coalesce(array_length(v_vals, 1), 0) > 1
               OR v_n_nombres > 1
               OR v_n_derechos > 1;

      -- Coherencia de lo declarado dentro de la propia evidencia.
      IF (v_evid ->> 'derecho') IS NOT NULL THEN
        IF public.p0_right_type_canonico(NULL, v_evid ->> 'derecho') IS DISTINCT FROM v_right THEN
          v_ok_der := false; v_bad := true;
        END IF;
      END IF;
      IF (v_evid ->> 'porcentaje') IS NOT NULL THEN
        IF v_pct IS NULL
           OR public.p0_parse_pct(v_evid ->> 'porcentaje') IS NULL
           OR abs(public.p0_parse_pct(v_evid ->> 'porcentaje') - v_pct) > 0.01 THEN
          v_ok_pct := false; v_bad := true;
        END IF;
      END IF;
      IF NOT (v_ok_tit AND v_ok_der AND v_ok_pct) THEN
        v_bad := true;
      END IF;
    ELSE
      -- Hay evidencia declarada pero sin cita: no es trazable y no se rescata.
      IF v_evid_presente THEN
        v_fuente := 'titular.evidencia';
        v_bad := true;
      END IF;
    END IF;
  END IF;

  -- (b) FALLBACK 1: texto bruto. Solo si la fuente principal está REALMENTE
  -- ausente. La MISMA cita debe traer titular + SU derecho + SU porcentaje con
  -- marcador real, y no puede mezclar titulares ni porcentajes.
  IF NOT v_evid_presente AND v_raw IS NOT NULL AND v_nn IS NOT NULL
     AND v_rx_right IS NOT NULL AND v_pct IS NOT NULL THEN
    SELECT frag INTO v_cita
    FROM (
      SELECT btrim(f) AS frag
      FROM regexp_split_to_table(v_raw, '(?<=[.;\n])\s+') AS f
    ) s
    WHERE public.norm_person_name(s.frag) LIKE '%' || v_nn || '%'
      AND s.frag ~* v_rx_right
      AND EXISTS (SELECT 1 FROM unnest(public.p0_cita_pct_values(s.frag)) x
                  WHERE abs(x - v_pct) <= 0.01)
    LIMIT 1;

    IF v_cita IS NOT NULL THEN
      v_fuente := 'raw_pdf_text';
      v_vals := public.p0_cita_pct_values(v_cita);
      SELECT count(*) INTO v_n_nombres
      FROM public.nota_simple_titulares o
      WHERE o.nota_simple_id = v_nota
        AND public.norm_person_name(o.nombre_extraido) IS NOT NULL
        AND public.norm_person_name(v_cita) LIKE '%' || public.norm_person_name(o.nombre_extraido) || '%';
      v_n_derechos := coalesce(array_length(public.p0_right_candidates(v_cita), 1), 0);
      v_amb := coalesce(array_length(v_vals, 1), 0) > 1
               OR v_n_nombres > 1
               OR v_n_derechos > 1;
      v_ok_tit := true; v_ok_der := true; v_ok_pct := true; v_traz := true;
      v_ref := NULL;  -- no se inventa página ni offset
    END IF;
  END IF;

  -- (c) FALLBACK 2: structured_json. El MISMO elemento del MISMO titular debe
  -- mapear al mismo right_type, al mismo porcentaje (<=0,01) y traer un
  -- localizador NO vacío (página, ruta u offset) o una cita real.
  IF NOT v_evid_presente
     AND NOT (v_ok_tit AND v_ok_der AND v_ok_pct) AND jsonb_typeof(v_sj -> 'titulares') = 'array' THEN
    SELECT jsonb_build_object(
             'cita', coalesce(nullif(btrim(coalesce(tj ->> 'cita','')), ''),
                              nullif(btrim(coalesce(tj ->> 'texto','')), '')),
             'ruta', coalesce(nullif(btrim(coalesce(tj ->> 'pagina','')), ''),
                              nullif(btrim(coalesce(tj ->> 'page','')), ''),
                              nullif(btrim(coalesce(tj ->> 'ruta','')), ''),
                              nullif(btrim(coalesce(tj ->> 'path','')), ''),
                              nullif(btrim(coalesce(tj ->> 'offset','')), '')))
      INTO r
    FROM jsonb_array_elements(v_sj -> 'titulares') tj
    WHERE public.norm_person_name(tj ->> 'nombre') = v_nn
      AND v_right <> 'otro'
      AND public.p0_right_type_canonico(NULL, coalesce(tj ->> 'derecho', tj ->> 'rol')) = v_right
      AND v_pct IS NOT NULL
      AND public.p0_parse_pct(tj ->> 'porcentaje') IS NOT NULL
      AND abs(public.p0_parse_pct(tj ->> 'porcentaje') - v_pct) <= 0.01
      AND coalesce(nullif(btrim(coalesce(tj ->> 'cita','')), ''),
                   nullif(btrim(coalesce(tj ->> 'texto','')), ''),
                   nullif(btrim(coalesce(tj ->> 'pagina','')), ''),
                   nullif(btrim(coalesce(tj ->> 'page','')), ''),
                   nullif(btrim(coalesce(tj ->> 'ruta','')), ''),
                   nullif(btrim(coalesce(tj ->> 'path','')), ''),
                   nullif(btrim(coalesce(tj ->> 'offset','')), '')) IS NOT NULL
    LIMIT 1;

    IF r IS NOT NULL THEN
      v_fuente := 'structured_json';
      v_cita := r ->> 'cita';
      v_ref  := r ->> 'ruta';
      -- El elemento debe referir al MISMO titular y aportar localizador real.
      IF v_cita IS NOT NULL THEN
        v_vals := public.p0_cita_pct_values(v_cita);
        SELECT count(*) INTO v_n_nombres
        FROM public.nota_simple_titulares o
        WHERE o.nota_simple_id = v_nota
          AND public.norm_person_name(o.nombre_extraido) IS NOT NULL
          AND public.norm_person_name(v_cita) LIKE '%' || public.norm_person_name(o.nombre_extraido) || '%';
        v_n_derechos := coalesce(array_length(public.p0_right_candidates(v_cita), 1), 0);
        v_amb := coalesce(array_length(v_vals, 1), 0) > 1
                 OR v_n_nombres > 1
                 OR v_n_derechos > 1;
        v_ok_pct := EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE abs(x - v_pct) <= 0.01);
        IF NOT v_ok_pct THEN v_bad := true; END IF;
      ELSE
        -- Sin cita pero con localizador declarado: el elemento estructurado ya
        -- asocia titular + derecho + porcentaje de forma inequívoca.
        v_ok_pct := true;
      END IF;
      v_ok_tit := true; v_ok_der := true; v_traz := v_ref IS NOT NULL OR v_cita IS NOT NULL;
    END IF;
  END IF;

  IF v_fuente = 'ninguna' THEN
    v_bad := true;
  END IF;

  RETURN jsonb_build_object(
    'titular_ok',    coalesce(v_ok_tit,false),
    'derecho_ok',    coalesce(v_ok_der,false),
    'porcentaje_ok', coalesce(v_ok_pct,false),
    'trazable',      coalesce(v_traz,false),
    'evidence_ambiguous', coalesce(v_amb,false),
    'bad_evidence',  coalesce(v_bad,false),
    'evidence_ok',   coalesce(v_ok_tit,false) AND coalesce(v_ok_der,false)
                     AND coalesce(v_ok_pct,false) AND coalesce(v_traz,false)
                     AND NOT coalesce(v_amb,false) AND NOT coalesce(v_bad,false),
    'fuente',        v_fuente,
    'cita',          v_cita,
    'ruta',          v_ref,
    'right_type',    v_right,
    'porcentaje',    v_pct);
END $$;

COMMENT ON FUNCTION public.p0_evidence_check(uuid) IS
  'Evidencia real: titular + SU derecho + SU porcentaje con marcador explícito (%, "por ciento" o fracción) en la MISMA cita, con localizador no inventado. Flags evidence_ambiguous (varios titulares/porcentajes/derechos) y bad_evidence (contradicción o ausencia). Ninguno de los dos puede alimentar cuota.';

-- ---------------------------------------------------------------------
-- 5) Staging read-only, 1:1 con nota_simple_titulares de notas 'listo'
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
    public.norm_person_name(t.nombre_extraido) AS nn,
    public.p0_right_type_canonico(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal')
    ) AS right_type,
    public.p0_role_conflict(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal')
    ) AS role_conflict,
    public.p0_canon_regime(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal'),
      t.metadatos ->> 'regimen',
      t.nombre_extraido) AS coownership_regime,
    public.p0_nota_unit_key(ns.id)   AS unit_key,
    public.p0_nota_signature(ns.id)  AS nota_signature,
    public.p0_nota_fecha_registral(ns.structured_json) AS fecha_registral,
    public.p0_evidence_check(t.id)   AS ev,
    coalesce(b.division_horizontal, false) AS dh,
    ns.structured_json AS sj, ns.processed_at, ns.created_at
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  LEFT JOIN public.buildings b ON b.id = ns.building_id
  WHERE ns.building_id IS NOT NULL
    -- (8) Un solo universo: gate y resumen operan sobre notas 'listo'.
    AND ns.status = 'listo'
), soc AS (
  SELECT tit.*,
    (tit.pre_company_id IS NOT NULL
     OR tit.nombre_extraido ~* '(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|PATRIMONI|CAPITAL)\M'
     OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]') AS es_sociedad
  FROM tit
), nota_meta AS (
  SELECT nota_id, unit_key, nota_signature, nota_status, fecha_registral,
         processed_at, created_at,
         count(*) AS n_titulares,
         count(*) FILTER (WHERE porcentaje IS NOT NULL) AS n_con_pct,
         count(*) FILTER (WHERE dni IS NOT NULL) AS n_con_dni
  FROM soc
  GROUP BY nota_id, unit_key, nota_signature, nota_status, fecha_registral,
           processed_at, created_at
), unit_dates AS (
  -- (4) La cronología SOLO puede resolverse con fechas registrales parseadas.
  SELECT unit_key,
         count(DISTINCT nota_signature) AS n_firmas,
         max(fecha_registral)           AS max_fecha
  FROM nota_meta WHERE unit_key IS NOT NULL GROUP BY unit_key
), top_sig AS (
  -- Firma(s) de las notas con la fecha registral máxima de cada unidad.
  SELECT nm.unit_key,
         count(DISTINCT nm.nota_signature) AS n_top_firmas,
         min(nm.nota_signature)            AS top_signature
  FROM nota_meta nm
  JOIN unit_dates ud ON ud.unit_key = nm.unit_key
  WHERE nm.unit_key IS NOT NULL
    AND ud.max_fecha IS NOT NULL
    AND nm.fecha_registral = ud.max_fecha
  GROUP BY nm.unit_key
), unit_state AS (
  SELECT ud.unit_key, ud.n_firmas, ud.max_fecha, ts.top_signature,
    -- Resuelta por cronología si: hay una única firma en la fecha máxima y
    -- TODA nota con firma distinta tiene fecha parseada estrictamente anterior.
    (ud.n_firmas = 1)
    OR (
      ud.max_fecha IS NOT NULL
      AND ts.n_top_firmas = 1
      AND NOT EXISTS (
        SELECT 1 FROM nota_meta x
        WHERE x.unit_key = ud.unit_key
          AND x.nota_signature IS DISTINCT FROM ts.top_signature
          AND (x.fecha_registral IS NULL OR x.fecha_registral >= ud.max_fecha)
      )
    ) AS resuelta
  FROM unit_dates ud
  LEFT JOIN top_sig ts ON ts.unit_key = ud.unit_key
), canon AS (
  -- Nota canónica: dentro de la firma ganadora (si la hay), la de fecha
  -- registral más reciente; processed_at/created_at SOLO desempatan copias.
  SELECT DISTINCT ON (nm.unit_key) nm.unit_key, nm.nota_id
  FROM nota_meta nm
  JOIN unit_state us ON us.unit_key = nm.unit_key
  WHERE nm.unit_key IS NOT NULL
  ORDER BY nm.unit_key,
           (us.resuelta AND us.top_signature IS NOT NULL
            AND nm.nota_signature = us.top_signature) DESC,
           nm.fecha_registral DESC NULLS LAST,
           nm.n_con_pct DESC, nm.n_con_dni DESC, nm.n_titulares DESC,
           nm.processed_at DESC NULLS LAST, nm.created_at DESC, nm.nota_id
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
    (coalesce(us.n_firmas, 0) > 1 AND NOT coalesce(us.resuelta, false)) AS unidad_contradictoria,
    (coalesce(us.n_firmas, 0) > 1 AND coalesce(us.resuelta, false)) AS unidad_resuelta_por_fecha,
    (s.porcentaje IS NULL
     OR s.porcentaje <= 0 OR s.porcentaje > 100) AS invalid_pct,
    (s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL) AS conflicto_ids,
    CASE
      WHEN s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL THEN NULL
      WHEN s.pre_owner_id IS NOT NULL THEN s.pre_owner_id
      WHEN s.pre_company_id IS NOT NULL THEN NULL
      WHEN NOT s.es_sociedad THEN
        CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id END
    END AS f_owner_id,
    CASE
      WHEN s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL THEN NULL
      WHEN s.pre_company_id IS NOT NULL THEN s.pre_company_id
      WHEN s.pre_owner_id IS NOT NULL THEN NULL
      WHEN s.es_sociedad THEN
        CASE WHEN mf.n = 1 THEN mf.company_id WHEN mc.n = 1 THEN mc.company_id END
    END AS f_company_id,
    (md.n = 1 AND s.pre_company_id IS NULL
     AND (s.pre_owner_id IS NULL OR s.pre_owner_id = md.owner_id)) AS dni_inequivoco,
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
    (b.ev ->> 'evidence_ok')::boolean       AS evidence_ok,
    (b.ev ->> 'evidence_ambiguous')::boolean AS evidence_ambiguous,
    (b.ev ->> 'bad_evidence')::boolean       AS bad_evidence,
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
  e.fecha_registral AS nota_fecha_registral,
  e.nombre_extraido AS titular_nombre, e.dni AS titular_dni,
  e.right_type, e.porcentaje AS percentage,
  e.coownership_regime,
  e.role_conflict,
  e.f_owner_id AS owner_id, e.f_company_id AS company_id,
  e.conflicto_ids, e.identity_match, e.confidence,
  e.evidence_ok, e.evidence_ambiguous, e.bad_evidence,
  e.ev AS evidence_ref, e.audit_ids,
  e.rol_literal AS right_literal,
  e.es_sociedad, e.dh AS division_horizontal, e.dh, e.nota_status,
  e.unidad_contradictoria, e.unidad_resuelta_por_fecha, e.invalid_pct,
  e.capa_suma, e.capa_nulos, coalesce(e.layer_complete, false) AS layer_complete,
  CASE
    WHEN e.unit_key IS NULL AND e.dh THEN 'dh_sin_unidad_registral'
    WHEN e.dh THEN 'dh_no_proyectable_a_cuota_edificio'
  END AS unit_block_reason,
  CASE WHEN e.is_canonical THEN 'active' ELSE 'superseded' END AS status,
  (
    e.conflicto_ids
    OR e.role_conflict
    OR e.right_type = 'otro'
    OR (e.right_type = 'pleno_dominio' AND e.coownership_regime = 'gananciales')
    OR NOT coalesce(e.evidence_ok, false)
    OR coalesce(e.evidence_ambiguous, false)
    OR coalesce(e.bad_evidence, false)
    OR e.invalid_pct
    OR (e.f_owner_id IS NULL AND e.f_company_id IS NULL)
    OR e.unit_key IS NULL
    OR e.dh
    OR e.unidad_contradictoria
    OR NOT e.is_canonical
    OR (e.right_type = 'pleno_dominio' AND e.is_canonical AND NOT coalesce(e.layer_complete,false))
    OR (NOT e.es_sociedad AND NOT e.dni_inequivoco)
  ) AS review_flag,
  nullif(concat_ws(' · ',
    CASE WHEN e.conflicto_ids THEN 'el titular trae owner_id y company_id a la vez: caso bloqueado, se conservan ambos IDs en auditoría' END,
    CASE WHEN e.role_conflict THEN 'conflicto de fuentes: t.rol y rol_literal declaran derechos distintos (o el literal menciona varios): se clasifica como "otro"' END,
    CASE WHEN e.right_type = 'otro' AND e.coownership_regime = 'gananciales'
         THEN 'solo consta carácter ganancial sin derecho real: régimen registrado, derecho "otro", cero cuota' END,
    CASE WHEN e.right_type = 'otro' AND e.coownership_regime <> 'gananciales'
         THEN 'rol registral desconocido: se clasifica como "otro" (nunca pleno dominio)' END,
    CASE WHEN e.right_type = 'pleno_dominio' AND e.coownership_regime = 'gananciales'
         THEN 'pleno dominio con carácter ganancial: sin representación segura de la comunidad/cotitulares no alimenta cuota' END,
    CASE WHEN coalesce(e.bad_evidence,false) THEN 'evidencia contradictoria o ausente (bad_evidence)' END,
    CASE WHEN coalesce(e.evidence_ambiguous,false) THEN 'cita con varios titulares, porcentajes o derechos: evidencia ambigua' END,
    CASE WHEN NOT coalesce(e.evidence_ok,false) THEN
      'evidencia insuficiente (titular=' || (e.ev ->> 'titular_ok') ||
      ', derecho=' || (e.ev ->> 'derecho_ok') ||
      ', porcentaje=' || (e.ev ->> 'porcentaje_ok') ||
      ', trazable=' || (e.ev ->> 'trazable') || ')' END,
    CASE WHEN e.invalid_pct THEN 'porcentaje ausente o fuera de rango (0,100]' END,
    CASE WHEN e.f_owner_id IS NULL AND e.f_company_id IS NULL THEN 'titular registral sin conciliar con el CRM (sin owner ni company)' END,
    CASE WHEN NOT e.es_sociedad AND e.f_owner_id IS NOT NULL AND NOT e.dni_inequivoco
         THEN 'vínculo conservado sin DNI exacto e inequívoco: no puede alimentar cuota' END,
    CASE WHEN e.identity_match = 'nombre_sociedad_revisable' THEN 'sociedad emparejada solo por nombre: match revisable, nunca prueba automática' END,
    CASE WHEN e.unit_key IS NULL AND e.dh THEN 'división horizontal sin clave de unidad registral fiable (dh_sin_unidad_registral)' END,
    CASE WHEN e.dh AND e.unit_key IS NOT NULL
         THEN 'división horizontal: la unidad se conserva y audita, pero building_owners.cuota es por edificio y no admite proyección por unidad' END,
    CASE WHEN e.unit_key IS NULL AND NOT e.dh THEN 'sin unidad de titularidad resoluble' END,
    CASE WHEN e.unidad_contradictoria THEN 'la unidad tiene notas con firmas registrales distintas sin cronología fiable (misma fecha, ausente o no parseable)' END,
    CASE WHEN NOT e.is_canonical THEN 'nota no canónica de la unidad: se conserva para auditoría, no opera' END,
    CASE WHEN e.right_type = 'pleno_dominio' AND e.is_canonical AND NOT coalesce(e.layer_complete,false)
         THEN 'capa de pleno dominio no cierra al 100%' END
  ), '') AS review_reason,
  (
    e.is_canonical
    AND e.right_type = 'pleno_dominio'
    AND NOT e.role_conflict
    AND e.coownership_regime <> 'gananciales'
    AND coalesce(e.layer_complete,false)
    AND NOT e.conflicto_ids
    AND e.f_owner_id IS NOT NULL
    AND e.f_company_id IS NULL
    AND e.dni_inequivoco
    AND coalesce(e.evidence_ok,false)
    AND NOT coalesce(e.evidence_ambiguous,false)
    AND NOT coalesce(e.bad_evidence,false)
    AND NOT e.invalid_pct
    AND e.unit_key IS NOT NULL
    -- (6) DH: building_owners.cuota es por edificio -> jamás alimenta cuota.
    AND NOT e.dh
    AND NOT e.unidad_contradictoria
  ) AS feeds_cuota
FROM evaluada e;

-- Derechos registrales crudos: NO se exponen a cualquier autenticado.
REVOKE ALL ON public.v_p0_rights_staging FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_rights_staging TO service_role;

COMMENT ON VIEW public.v_p0_rights_staging IS
  'Staging read-only 1:1 con nota_simple_titulares de notas status=listo. Derecho y régimen son campos distintos. Solo pleno dominio no ganancial, sin conflicto de rol, con capa completa (100% ±0,01), DNI inequívoco, evidencia real no ambigua, unidad no contradictoria y edificio SIN división horizontal puede alimentar cuota.';

-- ---------------------------------------------------------------------
-- 6) Dry-run sin escrituras (mismo universo status='listo')
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_property_rights_dry_run()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH src AS (
  SELECT count(*) AS n
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  WHERE ns.building_id IS NOT NULL
    AND ns.status = 'listo'
), s AS (
  SELECT * FROM public.v_p0_rights_staging
), agg AS (
  SELECT
    count(*) AS staged_rows,
    count(*) FILTER (WHERE building_id IS NOT NULL) AS staged_con_building,
    count(DISTINCT titular_id) AS titulares_unicos,
    count(*) FILTER (WHERE owner_id IS NULL AND company_id IS NULL) AS unmatched,
    count(*) FILTER (WHERE conflicto_ids) AS conflicto_owner_y_company,
    count(*) FILTER (WHERE owner_id IS NOT NULL AND company_id IS NOT NULL) AS mezcla_owner_company,
    count(*) FILTER (WHERE unit_block_reason = 'dh_sin_unidad_registral') AS dh_sin_unidad,
    count(*) FILTER (WHERE evidence_ok) AS evidence_ok,
    count(*) FILTER (WHERE NOT evidence_ok) AS evidence_missing,
    count(*) FILTER (WHERE role_conflict) AS role_conflicts,
    count(*) FILTER (WHERE invalid_pct) AS invalid_pct,
    count(*) FILTER (WHERE evidence_ambiguous) AS evidence_ambiguous,
    count(*) FILTER (WHERE bad_evidence) AS bad_evidence,
    count(*) FILTER (WHERE is_canonical) AS filas_canonicas,
    count(*) FILTER (WHERE feeds_cuota) AS feeds_cuota,
    count(*) FILTER (WHERE feeds_cuota AND right_type <> 'pleno_dominio') AS bad_no_pleno_feeds,
    count(*) FILTER (WHERE feeds_cuota AND owner_id IS NULL) AS bad_unmatched_feeds,
    count(*) FILTER (WHERE feeds_cuota AND conflicto_ids) AS bad_conflicto_feeds,
    count(*) FILTER (WHERE feeds_cuota AND unidad_contradictoria) AS bad_contradiccion_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT is_canonical) AS bad_no_canonica_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT layer_complete) AS bad_capa_incompleta_feeds,
    count(*) FILTER (WHERE feeds_cuota AND role_conflict) AS bad_role_conflict_feeds,
    count(*) FILTER (WHERE feeds_cuota AND invalid_pct) AS bad_invalid_pct_feeds,
    count(*) FILTER (WHERE feeds_cuota AND coownership_regime = 'gananciales') AS bad_ganancial_feeds,
    count(*) FILTER (WHERE feeds_cuota AND (bad_evidence OR evidence_ambiguous OR NOT evidence_ok)) AS bad_evidence_feeds,
    count(*) FILTER (WHERE feeds_cuota AND division_horizontal) AS dh_feeds
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
), por_regimen AS (
  SELECT jsonb_object_agg(coownership_regime, n) AS j
  FROM (SELECT coownership_regime, count(*) AS n FROM s GROUP BY coownership_regime) x
), unidades AS (
  SELECT ownership_unit_key,
         count(DISTINCT nota_signature) AS n_firmas,
         count(DISTINCT note_simple_id) AS n_notas,
         count(DISTINCT note_simple_id) FILTER (WHERE is_canonical) AS n_canon,
         bool_or(unidad_contradictoria) AS contradictoria,
         bool_or(unidad_resuelta_por_fecha) AS resuelta_por_fecha
  FROM s WHERE ownership_unit_key IS NOT NULL
  GROUP BY ownership_unit_key
), u AS (
  SELECT
    count(*) AS unidades,
    count(*) FILTER (WHERE n_canon = 1) AS notas_canonicas,
    count(*) FILTER (WHERE contradictoria) AS contradicciones,
    count(*) FILTER (WHERE resuelta_por_fecha) AS supersedidas_por_fecha,
    count(*) FILTER (WHERE n_notas > 1 AND n_firmas = 1) AS duplicados_identicos,
    count(*) FILTER (WHERE n_canon > 1) AS unidades_multi_canonica
  FROM unidades
)
SELECT jsonb_build_object(
  'universo', 'notas_simples.status = listo',
  'source_titulares', src.n,
  'staged_rows', agg.staged_rows,
  'titulares_unicos', agg.titulares_unicos,
  'paridad_1a1', (agg.staged_rows = src.n AND agg.titulares_unicos = agg.staged_rows),
  'unmatched', agg.unmatched,
  'conflicto_owner_y_company', agg.conflicto_owner_y_company,
  'mezcla_owner_company', agg.mezcla_owner_company,
  'dh_sin_unidad', agg.dh_sin_unidad,
  'dh_feeds', agg.dh_feeds,
  'evidence_ok', agg.evidence_ok,
  'evidence_missing', agg.evidence_missing,
  'evidence_ambiguous', agg.evidence_ambiguous,
  'bad_evidence', agg.bad_evidence,
  'bad_evidence_feeds', agg.bad_evidence_feeds,
  'role_conflicts', agg.role_conflicts,
  'invalid_pct', agg.invalid_pct,
  'unidades', u.unidades,
  'notas_canonicas', u.notas_canonicas,
  'filas_canonicas', agg.filas_canonicas,
  'duplicados_identicos', u.duplicados_identicos,
  'contradicciones', u.contradicciones,
  'supersedidas_por_fecha', u.supersedidas_por_fecha,
  'capas_completas', c.capas_completas,
  'capas_incompletas', c.capas_incompletas,
  'bad_capa_incompleta_feeds', agg.bad_capa_incompleta_feeds,
  'feeds_cuota', agg.feeds_cuota,
  'por_derecho', coalesce(por_derecho.j, '{}'::jsonb),
  'por_regimen', coalesce(por_regimen.j, '{}'::jsonb),
  'invariants', jsonb_build_object(
    'staged_igual_source', agg.staged_rows = src.n,
    'todas_con_building_id', agg.staged_con_building = agg.staged_rows,
    'titular_unico', agg.titulares_unicos = agg.staged_rows,
    'conflicto_no_alimenta_cuota', agg.bad_conflicto_feeds = 0,
    'sin_mezcla_owner_company', agg.mezcla_owner_company = 0,
    'ningun_unmatched_alimenta_cuota', agg.bad_unmatched_feeds = 0,
    'solo_pleno_alimenta_cuota', agg.bad_no_pleno_feeds = 0,
    'solo_canonica_alimenta_cuota', agg.bad_no_canonica_feeds = 0,
    'solo_capa_completa_alimenta_cuota', agg.bad_capa_incompleta_feeds = 0,
    'max_una_canonica_por_unidad', u.unidades_multi_canonica = 0,
    'contradiccion_no_alimenta_cuota', agg.bad_contradiccion_feeds = 0,
    'role_conflict_no_alimenta_cuota', agg.bad_role_conflict_feeds = 0,
    'pct_invalido_no_alimenta_cuota', agg.bad_invalid_pct_feeds = 0,
    'ganancial_no_alimenta_cuota', agg.bad_ganancial_feeds = 0,
    'evidencia_mala_o_ambigua_no_alimenta_cuota', agg.bad_evidence_feeds = 0,
    'dh_no_alimenta_cuota', agg.dh_feeds = 0
  ),
  'invariants_ok', (
    agg.staged_rows = src.n
    AND agg.staged_con_building = agg.staged_rows
    AND agg.titulares_unicos = agg.staged_rows
    AND agg.bad_conflicto_feeds = 0
    AND agg.mezcla_owner_company = 0
    AND agg.bad_unmatched_feeds = 0
    AND agg.bad_no_pleno_feeds = 0
    AND agg.bad_no_canonica_feeds = 0
    AND agg.bad_capa_incompleta_feeds = 0
    AND u.unidades_multi_canonica = 0
    AND agg.bad_contradiccion_feeds = 0
    AND agg.bad_role_conflict_feeds = 0
    AND agg.bad_invalid_pct_feeds = 0
    AND agg.bad_ganancial_feeds = 0
    AND agg.bad_evidence_feeds = 0
    AND agg.dh_feeds = 0
  ),
  'applied', false,
  'real_rebuild', 'disabled'
) FROM src, agg, c, por_derecho, por_regimen, u;
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
                               'motivo', 'Wave 1A.2: rebuild real deshabilitado, solo dry-run');
END $$;

REVOKE ALL ON FUNCTION public.p0_rebuild_property_rights(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_rebuild_property_rights(text, boolean) TO service_role;

COMMENT ON FUNCTION public.p0_rebuild_property_rights(text, boolean) IS
  'Wave 1A.2: p_apply=false devuelve el dry-run; p_apply=true lanza REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL. No escribe en building_property_rights.';

REVOKE ALL ON FUNCTION public.p0_nota_unit_key(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_signature(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_evidence_check(uuid)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_vigencia(jsonb)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_fecha_registral(jsonb)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_parse_fecha_registral(text)     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_pct_regex(numeric)              FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_parse_pct(text)                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_cita_pct_values(text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_regex(text)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_candidates(text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_from_rol(text)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_from_literal(text)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_right_type_canonico(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_role_conflict(text, text)       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_canon_regime(text, text, text, text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.p0_nota_unit_key(uuid)             TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_signature(uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_evidence_check(uuid)            TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_vigencia(jsonb)            TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_fecha_registral(jsonb)     TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_parse_fecha_registral(text)     TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_pct_regex(numeric)              TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_parse_pct(text)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_cita_pct_values(text)           TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_regex(text)               TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_candidates(text)          TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_from_rol(text)            TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_from_literal(text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_right_type_canonico(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_role_conflict(text, text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_canon_regime(text, text, text, text) TO service_role;

-- Función obsoleta de la Wave 1A.1 (derecho y régimen mezclados).
DROP FUNCTION IF EXISTS public.p0_right_type_from_rol(text, text, text);
