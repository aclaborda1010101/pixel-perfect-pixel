-- =====================================================================
-- WAVE 1A.3 · Corrección FORWARD registral. MIGRACIÓN NO APLICADA.
-- =====================================================================
-- Posterior a 20260810164500_wave1a_registral_rebuild_seguro.sql (1A.2),
-- que NO se edita. Esta migración sólo avanza: CREATE OR REPLACE de los
-- helpers p0_*, del staging y del dry-run.
--
-- El rebuild REAL sigue DESHABILITADO: p_apply=true lanza excepción y no
-- existe ningún camino que inserte, archive o borre en
-- public.building_property_rights. No toca cuotas, score, tareas, UI,
-- HubSpot, WhatsApp ni cron.
--
-- Correcciones frente a 1A.2:
--  1) CAPA INDIVISIBLE: row_safe_pre_layer y layer_safe separados.
--     feeds_cuota = row_safe_pre_layer AND layer_safe. Si una fila de la
--     capa falla, NINGUNA fila de la capa alimenta cuota.
--  2) UNIVERSO COMPLETO: nota_meta parte de TODAS las notas 'listo', no
--     del INNER JOIN con titulares. Nota 'listo' sin titulares bloquea la
--     unidad y la nota anterior (nota_lista_sin_titulares).
--  3) FECHAS: cada fuente candidata se parsea por separado con patrón
--     completo; dos fechas válidas distintas => date_conflict.
--     ownership_signature = identidad+derecho+porcentaje+régimen SIN fecha.
--  4) DERECHO != RÉGIMEN: régimen sólo desde campos registrales, nunca
--     desde el nombre; varios candidatos distintos => regime_conflict.
--  5) EVIDENCIA CONSERVADORA: cita anclada en raw_pdf_text con
--     normalización tolerante, exactamente UN candidato (sin LIMIT 1),
--     localizadores validados, fracción desnuda rechazada.
--  6) DH/IDENTIDAD: DH jamás alimenta cuota; localizadores de finca
--     validados; sociedad conciliada por CIF se conserva pero bloquea la
--     capa personal.
--  7) DRY-RUN: safety_invariants_ok y readiness_ok separados.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0) Vocabulario y columnas de apoyo (idempotente, sin datos)
-- ---------------------------------------------------------------------
ALTER TABLE public.building_property_rights
  ADD COLUMN IF NOT EXISTS layer_safe            boolean,
  ADD COLUMN IF NOT EXISTS row_safe_pre_layer    boolean,
  ADD COLUMN IF NOT EXISTS ownership_signature   text,
  ADD COLUMN IF NOT EXISTS date_conflict         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS regime_conflict       boolean NOT NULL DEFAULT false;

ALTER TABLE public.building_property_rights
  DROP CONSTRAINT IF EXISTS bpr_right_type_vocab;

ALTER TABLE public.building_property_rights
  ADD CONSTRAINT bpr_right_type_vocab
  CHECK (right_type IN ('pleno_dominio','nuda_propiedad','usufructo','otro'))
  NOT VALID;

-- ---------------------------------------------------------------------
-- 1) Normalización tolerante de texto (para anclaje de citas)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_norm_text(p_txt text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT nullif(
    btrim(regexp_replace(
      lower(translate(coalesce(p_txt,''),
        'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
        'AAAAAEEEEIIIIOOOOOUUUUNCaaaaaeeeeiiiiooooouuuunc')),
      '[^a-z0-9]+', ' ', 'g')), '');
$$;

COMMENT ON FUNCTION public.p0_norm_text(text) IS
  'Normalización tolerante (minúsculas, sin acentos, sin puntuación, espacios colapsados) para anclar citas en raw_pdf_text.';

-- ---------------------------------------------------------------------
-- 2) FECHAS: patrón COMPLETO por fuente candidata
-- ---------------------------------------------------------------------
-- Patrón completo y anclado: la cadena entera debe ser una fecha.
-- "01/02/2026 finca 1/2", "finca 1", "2026" o basura => NULL.
CREATE OR REPLACE FUNCTION public.p0_parse_fecha_registral(p_txt text)
RETURNS date LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; m text[];
BEGIN
  s := btrim(coalesce(p_txt,''));
  IF s = '' THEN RETURN NULL; END IF;

  m := regexp_match(s, '^([0-9]{4})-([0-9]{2})-([0-9]{2})$');
  IF m IS NOT NULL THEN
    BEGIN RETURN make_date(m[1]::int, m[2]::int, m[3]::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  m := regexp_match(s, '^([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})$');
  IF m IS NOT NULL THEN
    BEGIN RETURN make_date(m[3]::int, m[2]::int, m[1]::int);
    EXCEPTION WHEN others THEN RETURN NULL; END;
  END IF;

  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.p0_parse_fecha_registral(text) IS
  'Fecha registral con patrón COMPLETO y anclado (ISO o DD/MM/YYYY). Cualquier texto adicional o basura => NULL. Nunca lanza excepción.';

-- Todas las fechas VÁLIDAS y distintas de la nota. Cada fuente candidata se
-- parsea por separado: una fuente basura no invalida a las demás, y dos
-- fuentes válidas distintas quedan ambas en el array (=> date_conflict).
CREATE OR REPLACE FUNCTION public.p0_fecha_candidatos(p_sj jsonb)
RETURNS date[] LANGUAGE sql IMMUTABLE AS $$
  WITH c(valor) AS (
    VALUES
      (nullif(btrim(coalesce(p_sj ->> 'fecha_emision_nota','')), '')),
      (nullif(btrim(coalesce(p_sj ->> 'fecha_nota','')), '')),
      (nullif(btrim(coalesce(p_sj ->> 'fecha_registral','')), '')),
      (nullif(btrim(coalesce(p_sj ->> 'valid_from','')), '')),
      (nullif(btrim(coalesce(p_sj #>> '{vigencia,desde}','')), ''))
  ), p AS (
    SELECT public.p0_parse_fecha_registral(c.valor) AS d FROM c WHERE c.valor IS NOT NULL
  )
  SELECT coalesce(array_agg(DISTINCT p.d ORDER BY p.d), '{}'::date[])
  FROM p WHERE p.d IS NOT NULL;
$$;

COMMENT ON FUNCTION public.p0_fecha_candidatos(jsonb) IS
  'Fechas registrales válidas y distintas, parseando CADA fuente candidata por separado. Basura descartada sin contaminar al resto.';

-- Fecha registral efectiva: exactamente UNA fecha válida. Ninguna o varias
-- contradictorias => NULL (la cronología no puede resolverse).
CREATE OR REPLACE FUNCTION public.p0_nota_fecha_registral(p_sj jsonb)
RETURNS date LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(array_length(public.p0_fecha_candidatos(p_sj), 1), 0) = 1
      THEN (public.p0_fecha_candidatos(p_sj))[1]
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.p0_nota_date_conflict(p_sj jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_length(public.p0_fecha_candidatos(p_sj), 1), 0) > 1;
$$;

COMMENT ON FUNCTION public.p0_nota_date_conflict(jsonb) IS
  'true si la nota declara dos o más fechas registrales válidas y distintas: cronología no fiable, bloquea.';

CREATE OR REPLACE FUNCTION public.p0_nota_vigencia(p_sj jsonb)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.p0_nota_date_conflict(p_sj) THEN 'fecha en conflicto'
    ELSE coalesce(to_char(public.p0_nota_fecha_registral(p_sj), 'YYYY-MM-DD'), 'sin fecha')
  END;
$$;

-- ---------------------------------------------------------------------
-- 3) RÉGIMEN: sólo desde campos registrales, nunca desde el nombre
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_regime_candidates(p_rol text, p_literal text, p_regimen text)
RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  WITH s AS (
    SELECT concat_ws(' ', coalesce(p_rol,''), coalesce(p_literal,''), coalesce(p_regimen,'')) AS t
  )
  SELECT coalesce(array_agg(DISTINCT c ORDER BY c), '{}'::text[])
  FROM (
    SELECT 'gananciales'::text AS c FROM s WHERE s.t ~* '(ganancial|gananciales|sociedad\s+conyugal)'
    UNION ALL
    SELECT 'proindiviso'       FROM s WHERE s.t ~* 'proindiviso'
    UNION ALL
    SELECT 'privativo'         FROM s WHERE s.t ~* 'privativ'
  ) x;
$$;

COMMENT ON FUNCTION public.p0_regime_candidates(text, text, text) IS
  'Candidatos de régimen desde campos REGISTRALES (rol, literal, metadatos.regimen). El nombre del titular NUNCA se inspecciona.';

-- Firma de 1A.2 conservada (4 argumentos) pero el nombre se IGNORA: una
-- sociedad llamada "Gananciales S.L." no tiene régimen ganancial.
CREATE OR REPLACE FUNCTION public.p0_canon_regime(p_rol text, p_literal text, p_regimen text, p_nombre text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN coalesce(array_length(public.p0_regime_candidates(p_rol, p_literal, p_regimen), 1), 0) = 1
      THEN (public.p0_regime_candidates(p_rol, p_literal, p_regimen))[1]
    ELSE 'desconocido'
  END;
$$;

COMMENT ON FUNCTION public.p0_canon_regime(text, text, text, text) IS
  'Régimen canónico desde campos registrales. El cuarto argumento (nombre) se ignora por diseño. Varios candidatos distintos => desconocido + regime_conflict.';

CREATE OR REPLACE FUNCTION public.p0_regime_conflict(p_rol text, p_literal text, p_regimen text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(array_length(public.p0_regime_candidates(p_rol, p_literal, p_regimen), 1), 0) > 1;
$$;

-- ---------------------------------------------------------------------
-- 4) PORCENTAJES: marcador obligatorio; fracción sólo con contexto registral
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_frac_contexto_ok(p_txt text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(p_txt,'') ~* '(cuota|parte\s+indivisa|participacion\s+indivisa|participación\s+indivisa|mitad\s+indivisa)'
     AND coalesce(p_txt,'') !~* '(finca|tomo|folio|inscripci|fecha|libro|hoja|referencia\s+catastral|idufir)'
     AND coalesce(p_txt,'') !~ '[0-9]{1,2}[/-][0-9]{1,2}[/-][0-9]{4}';
$$;

COMMENT ON FUNCTION public.p0_frac_contexto_ok(text) IS
  'Una fracción a/b sólo vale como cuota si el texto la enmarca explícitamente (cuota / parte indivisa) y no hay contexto de fecha, finca, tomo, folio o inscripción.';

CREATE OR REPLACE FUNCTION public.p0_cita_pct_values(p_txt text)
RETURNS numeric[] LANGUAGE sql IMMUTABLE AS $$
  WITH pct AS (
    SELECT round(public.p0_parse_pct(m[1]), 2) AS v
    FROM regexp_matches(coalesce(p_txt,''),
         '([0-9]{1,3}(?:[.,][0-9]{1,4})?)\s*(?:%|por\s*cien(?:to)?)', 'gi') AS m
  ), frac AS (
    SELECT round((m[1]::numeric / nullif(m[2]::numeric, 0)) * 100, 2) AS v
    FROM regexp_matches(coalesce(p_txt,''), '([0-9]{1,4})\s*/\s*([0-9]{1,4})', 'g') AS m
    WHERE public.p0_frac_contexto_ok(p_txt)
  ), todos AS (
    SELECT v FROM pct UNION ALL SELECT v FROM frac
  )
  SELECT coalesce(array_agg(DISTINCT v), '{}'::numeric[])
  FROM todos WHERE v IS NOT NULL AND v > 0 AND v <= 100;
$$;

COMMENT ON FUNCTION public.p0_cita_pct_values(text) IS
  'Porcentajes reales: % o "por ciento" siempre; fracción a/b SÓLO con contexto registral de cuota/parte indivisa. Fracción desnuda y fechas rechazadas.';

-- ---------------------------------------------------------------------
-- 5) LOCALIZADORES: página entero positivo, offset entero >= 0, ruta cerrada
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_locator_valid(p_pagina text, p_offset text, p_ruta text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    (btrim(coalesce(p_pagina,'')) ~ '^[0-9]+$' AND btrim(coalesce(p_pagina,''))::numeric >= 1)
    OR (btrim(coalesce(p_offset,'')) ~ '^[0-9]+$')
    -- Ruta con sintaxis cerrada: $.a.b, $.a[0].b o titulares[2].porcentaje
    OR (btrim(coalesce(p_ruta,'')) ~ '^(\$\.)?[A-Za-z_][A-Za-z0-9_]*(\[[0-9]+\])?(\.[A-Za-z_][A-Za-z0-9_]*(\[[0-9]+\])?)*$');
$$;

COMMENT ON FUNCTION public.p0_locator_valid(text, text, text) IS
  'Localizador válido: página entero >=1, offset entero >=0 o ruta con sintaxis cerrada. "x", "foo", "0" como página y negativos se rechazan.';

-- P0.2: el OR anterior permitía que UNA página válida tapase una ruta u
-- offset mal formados. Ahora CADA localizador aportado debe ser válido por
-- separado, y debe haber al menos uno.
CREATE OR REPLACE FUNCTION public.p0_locator_all_valid(p_pagina text, p_offset text, p_ruta text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT
    (nullif(btrim(coalesce(p_pagina,'')),'') IS NOT NULL
     OR nullif(btrim(coalesce(p_offset,'')),'') IS NOT NULL
     OR nullif(btrim(coalesce(p_ruta,'')),'') IS NOT NULL)
    AND (nullif(btrim(coalesce(p_pagina,'')),'') IS NULL
         OR (btrim(p_pagina) ~ '^[0-9]+$' AND btrim(p_pagina)::numeric >= 1))
    AND (nullif(btrim(coalesce(p_offset,'')),'') IS NULL
         OR btrim(p_offset) ~ '^[0-9]+$')
    AND (nullif(btrim(coalesce(p_ruta,'')),'') IS NULL
         OR btrim(p_ruta) ~ '^(\$\.)?[A-Za-z_][A-Za-z0-9_]*(\[[0-9]+\])?(\.[A-Za-z_][A-Za-z0-9_]*(\[[0-9]+\])?)*$');
$$;

COMMENT ON FUNCTION public.p0_locator_all_valid(text, text, text) IS
  'Wave 1A.3 P0.2: TODOS los localizadores aportados deben ser sintácticamente válidos; una página correcta NO rescata una ruta u offset erróneos.';

-- Resolución REAL de una ruta JSON dentro de structured_json. Devuelve el
-- nodo apuntado o NULL si la ruta no existe. Sin json_path para no depender
-- de la versión del servidor y para rechazar sintaxis abierta.
CREATE OR REPLACE FUNCTION public.p0_json_path_resolve(p_sj jsonb, p_ruta text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text; seg text; cur jsonb; m text[];
BEGIN
  IF p_sj IS NULL THEN RETURN NULL; END IF;
  s := btrim(coalesce(p_ruta,''));
  IF s = '' THEN RETURN NULL; END IF;
  s := regexp_replace(s, '^\$\.?', '');
  IF s = '' THEN RETURN p_sj; END IF;
  cur := p_sj;
  FOREACH seg IN ARRAY string_to_array(s, '.') LOOP
    m := regexp_match(seg, '^([A-Za-z_][A-Za-z0-9_]*)(\[([0-9]+)\])?$');
    IF m IS NULL THEN RETURN NULL; END IF;
    IF cur IS NULL OR jsonb_typeof(cur) <> 'object' THEN RETURN NULL; END IF;
    cur := cur -> m[1];
    IF cur IS NULL THEN RETURN NULL; END IF;
    IF m[3] IS NOT NULL THEN
      IF jsonb_typeof(cur) <> 'array' THEN RETURN NULL; END IF;
      cur := cur -> (m[3]::int);
      IF cur IS NULL THEN RETURN NULL; END IF;
    END IF;
  END LOOP;
  RETURN cur;
END $$;

-- Elemento (objeto titular) al que pertenece la ruta: si la ruta apunta a
-- un escalar (p. ej. ".porcentaje") se sube al objeto contenedor.
CREATE OR REPLACE FUNCTION public.p0_ruta_elemento(p_sj jsonb, p_ruta text)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE nodo jsonb; padre text;
BEGIN
  nodo := public.p0_json_path_resolve(p_sj, p_ruta);
  IF nodo IS NOT NULL AND jsonb_typeof(nodo) = 'object' THEN RETURN nodo; END IF;
  padre := regexp_replace(btrim(coalesce(p_ruta,'')), '\.[A-Za-z_][A-Za-z0-9_]*(\[[0-9]+\])?$', '');
  IF padre = btrim(coalesce(p_ruta,'')) THEN RETURN NULL; END IF;
  nodo := public.p0_json_path_resolve(p_sj, padre);
  IF nodo IS NOT NULL AND jsonb_typeof(nodo) = 'object' THEN RETURN nodo; END IF;
  RETURN NULL;
END $$;

-- VÍNCULO EXACTO: si se aporta ruta u offset, debe resolver al MISMO
-- titular / derecho / porcentaje que la cita. La página no es demostrable
-- en SQL: es auditoría neutra (nunca rescata, nunca inventa vínculo).
CREATE OR REPLACE FUNCTION public.p0_locator_link_ok(
  p_sj jsonb, p_raw text, p_cita text,
  p_pagina text, p_offset text, p_ruta text,
  p_nn text, p_right text, p_pct numeric)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE el jsonb; off int; frag text;
BEGIN
  -- RUTA: debe existir y describir exactamente a este titular.
  IF nullif(btrim(coalesce(p_ruta,'')),'') IS NOT NULL THEN
    el := public.p0_ruta_elemento(p_sj, p_ruta);
    IF el IS NULL THEN RETURN false; END IF;
    IF p_nn IS NULL OR public.norm_person_name(el ->> 'nombre') IS DISTINCT FROM p_nn THEN
      RETURN false;
    END IF;
    IF p_right IS NULL
       OR public.p0_right_type_canonico(NULL, coalesce(el ->> 'derecho', el ->> 'rol'))
          IS DISTINCT FROM p_right THEN
      RETURN false;
    END IF;
    IF p_pct IS NULL
       OR public.p0_parse_pct(el ->> 'porcentaje') IS NULL
       OR abs(public.p0_parse_pct(el ->> 'porcentaje') - p_pct) > 0.01 THEN
      RETURN false;
    END IF;
  END IF;

  -- OFFSET: debe apuntar al arranque real de la cita en raw_pdf_text.
  IF nullif(btrim(coalesce(p_offset,'')),'') IS NOT NULL THEN
    IF p_cita IS NULL OR p_raw IS NULL OR btrim(p_offset) !~ '^[0-9]+$' THEN RETURN false; END IF;
    off := btrim(p_offset)::int;
    frag := substr(p_raw, off + 1, char_length(p_cita) + 40);
    IF frag IS NULL OR public.p0_norm_text(frag) IS NULL
       OR public.p0_norm_text(p_cita) IS NULL
       OR position(public.p0_norm_text(p_cita) IN public.p0_norm_text(frag)) <> 1 THEN
      RETURN false;
    END IF;
  END IF;

  RETURN true;
END $$;

COMMENT ON FUNCTION public.p0_locator_link_ok(jsonb, text, text, text, text, text, text, text, numeric) IS
  'Wave 1A.3 P0.2: ruta y offset deben resolver EXACTAMENTE al mismo titular/derecho/porcentaje de la cita. Si no se puede probar el vínculo, la evidencia estructurada es solo auditoría (structured_unverified).';

-- ---------------------------------------------------------------------
-- 6) EVIDENCIA CONSERVADORA
-- ---------------------------------------------------------------------
-- P0.1 · REGLA ÚNICA E INNEGOCIABLE DE ESTA WAVE:
--   La ÚNICA evidencia que puede alimentar cuota es una CITA NO VACÍA,
--   realmente ANCLADA en raw_pdf_text (normalización tolerante), y esa
--   MISMA cita debe contener titular inequívoco + SU derecho + SU
--   porcentaje. Exactamente UN candidato coherente (nunca LIMIT 1).
--
--   structured_json, ruta, pagina y offset son SOLO AUDITORÍA. Por sí
--   solos NUNCA producen evidence_ok ni feeds_cuota: sintaxis válida no
--   es evidencia. Un localizador no demuestra, en SQL, que apunta al
--   MISMO elemento/titular; cuando no puede probarse se marca
--   structured_unverified y se BLOQUEA.
CREATE OR REPLACE FUNCTION public.p0_evidence_check(p_titular_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  t            jsonb;
  v_nota       uuid;
  v_nn         text;
  v_pct        numeric;
  v_right      text;
  v_lit        text;
  v_rx_right   text;
  v_raw        text;
  v_raw_norm   text;
  v_sj         jsonb;
  v_evid       jsonb;
  v_cita       text;
  v_vals       numeric[];
  v_n_nombres  int;
  v_n_derechos int;
  v_n_cand     int := 0;
  v_ok_tit     boolean := false;
  v_ok_der     boolean := false;
  v_ok_pct     boolean := false;
  v_anclada    boolean := false;
  v_traz       boolean := false;
  v_amb        boolean := false;
  v_bad        boolean := false;
  v_struct_unv boolean := false;
  v_evid_presente boolean := false;
  v_fuente     text := 'ninguna';
  v_ref        text := NULL;
  v_pagina     text;
  v_offset     text;
  v_ruta       text;
  r            jsonb;
BEGIN
  SELECT to_jsonb(x) INTO t FROM public.nota_simple_titulares x WHERE x.id = p_titular_id;
  IF t IS NULL THEN
    RETURN jsonb_build_object('titular_ok', false, 'derecho_ok', false, 'porcentaje_ok', false,
                              'anclada', false, 'trazable', false, 'evidence_ok', false,
                              'evidence_ambiguous', false, 'bad_evidence', true,
                              'structured_unverified', false,
                              'fuente', 'ninguna', 'cita', NULL, 'candidatos', 0);
  END IF;

  v_nota  := (t ->> 'nota_simple_id')::uuid;
  v_nn    := public.norm_person_name(t ->> 'nombre_extraido');
  v_pct   := public.p0_parse_pct(t ->> 'porcentaje');
  v_lit   := coalesce(nullif(btrim(t ->> 'rol_literal'), ''), (t -> 'metadatos') ->> 'rol_literal');
  v_right := public.p0_right_type_canonico(t ->> 'rol', v_lit);
  v_rx_right := public.p0_right_regex(v_right);

  SELECT ns.raw_pdf_text, ns.structured_json INTO v_raw, v_sj
  FROM public.notas_simples ns WHERE ns.id = v_nota;
  v_raw_norm := public.p0_norm_text(v_raw);

  -- (a) FUENTE PRINCIPAL: columna evidencia del titular.
  v_evid := CASE
              WHEN jsonb_typeof(t -> 'evidencia') = 'object' THEN t -> 'evidencia'
              WHEN jsonb_typeof(t -> 'evidencia') = 'string' THEN jsonb_build_object('cita', t ->> 'evidencia')
              ELSE NULL
            END;

  IF v_evid IS NOT NULL THEN
    v_cita   := nullif(btrim(coalesce(v_evid ->> 'cita', v_evid ->> 'texto', v_evid ->> 'snippet','')), '');
    v_pagina := coalesce(nullif(btrim(coalesce(v_evid ->> 'pagina','')), ''), nullif(btrim(coalesce(v_evid ->> 'page','')), ''));
    v_offset := nullif(btrim(coalesce(v_evid ->> 'offset','')), '');
    v_ruta   := coalesce(nullif(btrim(coalesce(v_evid ->> 'ruta','')), ''), nullif(btrim(coalesce(v_evid ->> 'path','')), ''));
    v_ref    := coalesce(v_pagina, v_offset, v_ruta);
    v_evid_presente := v_cita IS NOT NULL
                       OR nullif(btrim(coalesce(v_evid ->> 'derecho','')), '') IS NOT NULL
                       OR nullif(btrim(coalesce(v_evid ->> 'porcentaje','')), '') IS NOT NULL
                       OR v_ref IS NOT NULL;

    IF v_cita IS NOT NULL THEN
      v_fuente  := 'titular.evidencia';
      v_ok_tit  := v_nn IS NOT NULL AND public.norm_person_name(v_cita) LIKE '%' || v_nn || '%';
      v_ok_der  := v_rx_right IS NOT NULL AND v_cita ~* v_rx_right;
      v_vals    := public.p0_cita_pct_values(v_cita);
      v_ok_pct  := v_pct IS NOT NULL
                   AND EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE abs(x - v_pct) <= 0.01);

      -- ANCLAJE OBLIGATORIO en el texto real de la nota (tolerante).
      v_anclada := v_raw_norm IS NOT NULL
                   AND public.p0_norm_text(v_cita) IS NOT NULL
                   AND position(public.p0_norm_text(v_cita) IN v_raw_norm) > 0;
      -- El localizador, si viene, debe ser válido EN TODAS sus partes y
      -- resolver al MISMO elemento que la cita. Una página válida no tapa
      -- una ruta u offset erróneos.
      IF v_ref IS NOT NULL THEN
        IF NOT public.p0_locator_all_valid(v_pagina, v_offset, v_ruta) THEN
          v_bad := true; v_struct_unv := true;
        ELSIF NOT public.p0_locator_link_ok(v_sj, v_raw, v_cita, v_pagina, v_offset, v_ruta,
                                            v_nn, v_right, v_pct) THEN
          v_bad := true; v_struct_unv := true;
        END IF;
      END IF;
      v_traz := v_anclada;

      SELECT count(*) INTO v_n_nombres
      FROM public.nota_simple_titulares o
      WHERE o.nota_simple_id = v_nota
        AND public.norm_person_name(o.nombre_extraido) IS NOT NULL
        AND public.norm_person_name(v_cita) LIKE '%' || public.norm_person_name(o.nombre_extraido) || '%';
      v_n_derechos := coalesce(array_length(public.p0_right_candidates(v_cita), 1), 0);
      v_amb := coalesce(array_length(v_vals, 1), 0) > 1 OR v_n_nombres > 1 OR v_n_derechos > 1;

      IF (v_evid ->> 'derecho') IS NOT NULL
         AND public.p0_right_type_canonico(NULL, v_evid ->> 'derecho') IS DISTINCT FROM v_right THEN
        v_ok_der := false; v_bad := true;
      END IF;
      IF (v_evid ->> 'porcentaje') IS NOT NULL THEN
        IF v_pct IS NULL
           OR public.p0_parse_pct(v_evid ->> 'porcentaje') IS NULL
           OR abs(public.p0_parse_pct(v_evid ->> 'porcentaje') - v_pct) > 0.01 THEN
          v_ok_pct := false; v_bad := true;
        END IF;
      END IF;
      IF NOT (v_ok_tit AND v_ok_der AND v_ok_pct AND v_anclada) THEN
        v_bad := true;   -- cita inventada o incompleta: nunca se rescata
      END IF;
      v_n_cand := 1;
    ELSE
      IF v_evid_presente THEN
        v_fuente := 'titular.evidencia';
        v_bad := true;   -- evidencia declarada sin cita: no prueba nada
      END IF;
    END IF;
  END IF;

  -- (b) FALLBACK 1: raw_pdf_text. EXACTAMENTE UN fragmento candidato.
  IF NOT v_evid_presente AND v_raw IS NOT NULL AND v_nn IS NOT NULL
     AND v_rx_right IS NOT NULL AND v_pct IS NOT NULL THEN
    WITH frags AS (
      SELECT btrim(f) AS frag
      FROM regexp_split_to_table(v_raw, '(?<=[.;\n])\s+') AS f
    ), cand AS (
      SELECT s.frag
      FROM frags s
      WHERE public.norm_person_name(s.frag) LIKE '%' || v_nn || '%'
        AND s.frag ~* v_rx_right
        AND EXISTS (SELECT 1 FROM unnest(public.p0_cita_pct_values(s.frag)) x
                    WHERE abs(x - v_pct) <= 0.01)
    )
    SELECT count(*), min(frag) INTO v_n_cand, v_cita FROM cand;

    IF v_n_cand = 1 THEN
      v_fuente := 'raw_pdf_text';
      v_vals   := public.p0_cita_pct_values(v_cita);
      SELECT count(*) INTO v_n_nombres
      FROM public.nota_simple_titulares o
      WHERE o.nota_simple_id = v_nota
        AND public.norm_person_name(o.nombre_extraido) IS NOT NULL
        AND public.norm_person_name(v_cita) LIKE '%' || public.norm_person_name(o.nombre_extraido) || '%';
      v_n_derechos := coalesce(array_length(public.p0_right_candidates(v_cita), 1), 0);
      v_amb := coalesce(array_length(v_vals, 1), 0) > 1 OR v_n_nombres > 1 OR v_n_derechos > 1;
      v_ok_tit := true; v_ok_der := true; v_ok_pct := true;
      v_anclada := true; v_traz := true; v_ref := NULL;
    ELSIF v_n_cand > 1 THEN
      v_fuente := 'raw_pdf_text';
      v_cita := NULL; v_amb := true; v_bad := true;
    ELSE
      v_cita := NULL;
    END IF;
  END IF;

  -- (c) FALLBACK 2: structured_json. SOLO AUDITORÍA.
  --     Un elemento estructurado con ruta/página/offset "bien formados" NO
  --     demuestra vínculo con ESTE titular: en SQL no podemos comprobar que
  --     la ruta apunte al mismo elemento. Por eso:
  --       - sólo se acepta si el elemento trae una CITA no vacía, ANCLADA en
  --         raw_pdf_text, y esa misma cita contiene titular + derecho + pct;
  --       - cualquier otro caso (ruta válida a otro titular, offset sin cita,
  --         mismo 50 % en otro elemento, página sin vínculo) se marca
  --         structured_unverified y BLOQUEA.
  IF NOT v_evid_presente AND NOT (v_ok_tit AND v_ok_der AND v_ok_pct)
     AND jsonb_typeof(v_sj -> 'titulares') = 'array' THEN
    WITH cand AS (
      SELECT
        nullif(btrim(coalesce(tj ->> 'cita', tj ->> 'texto','')), '') AS cita,
        coalesce(nullif(btrim(coalesce(tj ->> 'pagina','')), ''), nullif(btrim(coalesce(tj ->> 'page','')), '')) AS pagina,
        nullif(btrim(coalesce(tj ->> 'offset','')), '') AS off,
        coalesce(nullif(btrim(coalesce(tj ->> 'ruta','')), ''), nullif(btrim(coalesce(tj ->> 'path','')), '')) AS ruta
      FROM jsonb_array_elements(v_sj -> 'titulares') tj
      WHERE public.norm_person_name(tj ->> 'nombre') = v_nn
        AND v_right <> 'otro'
        AND public.p0_right_type_canonico(NULL, coalesce(tj ->> 'derecho', tj ->> 'rol')) = v_right
        AND v_pct IS NOT NULL
        AND public.p0_parse_pct(tj ->> 'porcentaje') IS NOT NULL
        AND abs(public.p0_parse_pct(tj ->> 'porcentaje') - v_pct) <= 0.01
    ), valida AS (
      -- El localizador NO habilita nada: sólo cuenta la cita anclada.
      SELECT * FROM cand
      WHERE cita IS NOT NULL
        AND v_raw_norm IS NOT NULL
        AND public.p0_norm_text(cita) IS NOT NULL
        AND position(public.p0_norm_text(cita) IN v_raw_norm) > 0
        -- Y si el elemento aporta ruta/offset, deben resolver a ESTE titular.
        AND (
          (pagina IS NULL AND off IS NULL AND ruta IS NULL)
          OR (public.p0_locator_all_valid(pagina, off, ruta)
              AND public.p0_locator_link_ok(v_sj, v_raw, cita, pagina, off, ruta, v_nn, v_right, v_pct))
        )
    )
    SELECT count(*),
           jsonb_build_object('cita', min(cita), 'ruta', coalesce(min(pagina), min(off), min(ruta)))
      INTO v_n_cand, r
    FROM valida;

    IF v_n_cand = 1 THEN
      v_fuente  := 'structured_json';
      v_cita    := r ->> 'cita';
      v_ref     := r ->> 'ruta';
      -- La traza es SIEMPRE el anclaje; ruta/página/offset son auditoría.
      v_anclada := true;
      v_traz    := true;
      v_vals    := public.p0_cita_pct_values(v_cita);
      v_ok_pct  := EXISTS (SELECT 1 FROM unnest(v_vals) x WHERE abs(x - v_pct) <= 0.01);
      v_ok_tit  := v_nn IS NOT NULL AND public.norm_person_name(v_cita) LIKE '%' || v_nn || '%';
      v_ok_der  := v_rx_right IS NOT NULL AND v_cita ~* v_rx_right;
      -- El titular debe ser INEQUÍVOCO dentro de la propia cita.
      SELECT count(*) INTO v_n_nombres
      FROM public.nota_simple_titulares o
      WHERE o.nota_simple_id = v_nota
        AND public.norm_person_name(o.nombre_extraido) IS NOT NULL
        AND public.norm_person_name(v_cita) LIKE '%' || public.norm_person_name(o.nombre_extraido) || '%';
      v_n_derechos := coalesce(array_length(public.p0_right_candidates(v_cita), 1), 0);
      v_amb := coalesce(array_length(v_vals, 1), 0) > 1 OR v_n_nombres > 1 OR v_n_derechos > 1;
      IF NOT (v_ok_pct AND v_ok_tit AND v_ok_der) THEN
        v_bad := true; v_struct_unv := true;
      END IF;
    ELSIF v_n_cand > 1 THEN
      v_fuente := 'structured_json'; v_amb := true; v_bad := true; v_struct_unv := true;
    ELSE
      -- Había elementos estructurados coherentes en metadatos, pero NINGUNO
      -- con cita anclada: auditoría, jamás evidencia.
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_sj -> 'titulares') tj
                 WHERE public.norm_person_name(tj ->> 'nombre') IS NOT NULL) THEN
        v_fuente := 'structured_json_sin_anclaje';
        v_struct_unv := true;
        v_bad := true;
      END IF;
    END IF;
  END IF;

  -- CIERRE FAIL-CLOSED: sin cita anclada no hay evidencia posible.
  IF v_cita IS NULL OR NOT coalesce(v_anclada, false) THEN
    v_traz := false;
    v_bad  := true;
  END IF;

  IF v_fuente = 'ninguna' THEN
    v_bad := true;
  END IF;

  RETURN jsonb_build_object(
    'titular_ok',    coalesce(v_ok_tit,false),
    'derecho_ok',    coalesce(v_ok_der,false),
    'porcentaje_ok', coalesce(v_ok_pct,false),
    'anclada',       coalesce(v_anclada,false),
    'trazable',      coalesce(v_traz,false),
    'candidatos',    coalesce(v_n_cand,0),
    'evidence_ambiguous', coalesce(v_amb,false),
    'bad_evidence',  coalesce(v_bad,false),
    'structured_unverified', coalesce(v_struct_unv,false),
    'evidence_ok',   coalesce(v_ok_tit,false) AND coalesce(v_ok_der,false)
                     AND coalesce(v_ok_pct,false) AND coalesce(v_traz,false)
                     AND coalesce(v_anclada,false) AND v_cita IS NOT NULL
                     AND NOT coalesce(v_struct_unv,false)
                     AND NOT coalesce(v_amb,false) AND NOT coalesce(v_bad,false),
    'fuente',        v_fuente,
    'cita',          v_cita,
    'ruta',          v_ref,
    'right_type',    v_right,
    'porcentaje',    v_pct);
END $$;

COMMENT ON FUNCTION public.p0_evidence_check(uuid) IS
  'Wave 1A.3 P0.1: SOLO una cita no vacía ANCLADA en raw_pdf_text que contenga titular inequívoco + SU derecho + SU porcentaje puede dar evidence_ok, y con exactamente un candidato coherente. structured_json/ruta/pagina/offset son auditoría: por sí solos marcan structured_unverified y bloquean.';

-- ---------------------------------------------------------------------
-- 7) FIRMAS: contenido (sin fecha) y fecha por separado
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_nota_ownership_signature(p_nota_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH t AS (
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
        NULL) AS regimen
    FROM public.nota_simple_titulares x WHERE x.nota_simple_id = p_nota_id
  )
  SELECT coalesce(
    (SELECT string_agg(t.ident || '|' || t.derecho || '|' || t.pct || '|' || t.regimen, ';'
                       ORDER BY t.ident, t.derecho, t.pct, t.regimen) FROM t),
    '(sin titulares)');
$$;

COMMENT ON FUNCTION public.p0_nota_ownership_signature(uuid) IS
  'ownership_signature = identidad + derecho + porcentaje + régimen. SIN fecha: mismo contenido con fechas distintas NO es contradicción.';

-- nota_signature se conserva por compatibilidad, pero ya no mezcla la fecha
-- en la comparación de contenido: delega en la firma de contenido.
CREATE OR REPLACE FUNCTION public.p0_nota_signature(p_nota_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.p0_nota_ownership_signature(p_nota_id);
$$;

-- ---------------------------------------------------------------------
-- 8) UNIDAD: validación mínima de localizador registral
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_unit_locator_valid(p_fuente text, p_clave text)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_fuente
    WHEN 'idufir' THEN coalesce(p_clave,'') ~ '^[0-9]{8,14}$'
    WHEN 'finca'  THEN coalesce(p_clave,'') ~ '^[0-9]{1,8}[A-Z]?$'
    WHEN 'refcat' THEN coalesce(p_clave,'') ~ '^[A-Z0-9]{14,20}$'
    ELSE false
  END;
$$;

COMMENT ON FUNCTION public.p0_unit_locator_valid(text, text) IS
  'Formato mínimo de IDUFIR (8-14 dígitos), finca (hasta 8 dígitos + letra opcional) y referencia catastral (14-20 alfanuméricos). Clave dudosa => la unidad va a revisión.';

-- Todas las claves registrales VÁLIDAS declaradas por la nota, normalizadas
-- y desduplicadas, como 'fuente:clave'. Sirve para detectar contradicción.
CREATE OR REPLACE FUNCTION public.p0_nota_unit_claves(p_nota_id uuid)
RETURNS text[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH n AS (
    SELECT ns.structured_json AS sj FROM public.notas_simples ns WHERE ns.id = p_nota_id
  ), v AS (
    SELECT DISTINCT x.ns_fuente,
           nullif(upper(regexp_replace(x.valor, '[^A-Za-z0-9]', '', 'g')), '') AS clave
    FROM n
    CROSS JOIN LATERAL (
      VALUES
        ('idufir', nullif(btrim(coalesce(n.sj ->> 'idufir','')), '')),
        ('idufir', nullif(btrim(coalesce(n.sj ->> 'idufir_cru','')), '')),
        ('idufir', nullif(btrim(coalesce(n.sj ->> 'cru','')), '')),
        ('idufir', nullif(btrim(coalesce(n.sj #>> '{finca,idufir}','')), '')),
        ('finca',  nullif(btrim(coalesce(n.sj ->> 'finca_registral','')), '')),
        ('finca',  nullif(btrim(coalesce(n.sj ->> 'numero_finca','')), '')),
        ('finca',  nullif(btrim(coalesce(n.sj #>> '{finca,numero}','')), '')),
        ('finca',  nullif(btrim(coalesce(n.sj #>> '{registro,finca}','')), '')),
        ('refcat', nullif(btrim(coalesce(n.sj ->> 'referencia_catastral','')), '')),
        ('refcat', nullif(btrim(coalesce(n.sj #>> '{finca,referencia_catastral}','')), ''))
    ) AS x(ns_fuente, valor)
    WHERE x.valor IS NOT NULL
      AND public.p0_unit_locator_valid(
            x.ns_fuente, nullif(upper(regexp_replace(x.valor, '[^A-Za-z0-9]', '', 'g')), ''))
  )
  SELECT coalesce(array_agg(v.ns_fuente || ':' || v.clave ORDER BY v.ns_fuente, v.clave), '{}'::text[])
  FROM v WHERE v.clave IS NOT NULL;
$$;

-- (5) DOS localizadores VÁLIDOS y DISTINTOS de la misma clase (dos IDUFIR,
-- dos fincas, dos refcat) => unit_key_conflict. NO se elige el primero.
-- P0.2: el CONJUNTO COMPLETO de localizadores jurídicos de la nota se trata
-- como un todo. Dos valores inequívocos distintos son conflicto AUNQUE sean
-- de tipos distintos (IDUFIR vs finca, IDUFIR vs refcat). No se agrupa por
-- tipo ni se elige el primero. Un mismo valor repetido/sinónimo es válido.
CREATE OR REPLACE FUNCTION public.p0_nota_unit_key_conflict(p_nota_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((
    SELECT count(DISTINCT split_part(c.v, ':', 2))
    FROM unnest(public.p0_nota_unit_claves(p_nota_id)) AS c(v)
  ), 0) > 1;
$$;

COMMENT ON FUNCTION public.p0_nota_unit_key_conflict(uuid) IS
  'true si la nota declara DOS localizadores registrales válidos y distintos, del tipo que sean (IDUFIR, finca o refcat): la unidad NO puede identificarse y jamás se elige el primero.';

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
        -- (6) Sólo claves con FORMATO MÍNIMO válido pueden identificar unidad.
        AND public.p0_unit_locator_valid(
              v.ns_fuente,
              nullif(upper(regexp_replace(v.valor, '[^A-Za-z0-9]', '', 'g')), ''))
      ORDER BY v.prioridad
      LIMIT 1
    ) c ON true
  )
  SELECT CASE
    WHEN k.building_id IS NULL THEN NULL
    -- (4) No-DH: la unidad SIEMPRE es el edificio. Nunca NULL.
    WHEN NOT k.dh THEN 'building:' || k.building_id::text
    -- (5) DH con localizadores contradictorios: no hay clave inequívoca.
    WHEN public.p0_nota_unit_key_conflict(k.id) THEN NULL
    WHEN k.clave_norm IS NOT NULL
      THEN 'dh:' || k.building_id::text || ':' || k.ns_fuente || ':' || k.clave_norm
    ELSE NULL
  END
  FROM k;
$$;

-- ---------------------------------------------------------------------
-- 9) STAGING 1A.3
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_p0_rights_staging AS
WITH notas AS (
  -- (2) UNIVERSO COMPLETO: TODAS las notas 'listo', con o sin titulares.
  SELECT ns.id AS nota_id, ns.building_id, ns.status AS nota_status,
         ns.structured_json AS sj, ns.processed_at, ns.created_at,
         coalesce(b.division_horizontal, false) AS dh,
         public.p0_nota_unit_key(ns.id)                       AS unit_key,
         public.p0_nota_unit_key_conflict(ns.id)              AS unit_key_conflict,
         public.p0_nota_ownership_signature(ns.id)            AS nota_signature,
         public.p0_nota_fecha_registral(ns.structured_json)   AS fecha_registral,
         public.p0_nota_date_conflict(ns.structured_json)     AS date_conflict,
         (SELECT count(*) FROM public.nota_simple_titulares x WHERE x.nota_simple_id = ns.id) AS n_titulares
  FROM public.notas_simples ns
  LEFT JOIN public.buildings b ON b.id = ns.building_id
  WHERE ns.building_id IS NOT NULL AND ns.status = 'listo'
), edificio AS (
  -- (4)(5) BLOQUEO A NIVEL EDIFICIO. Un problema que impide siquiera saber
  -- de qué unidad hablamos no puede "desaparecer" por unit_key NULL: deja
  -- CERO canónicas y CERO feeds para TODAS las unidades del edificio.
  SELECT n.building_id,
         bool_or(n.unit_key_conflict)                          AS b_unit_key_conflict,
         bool_or(n.dh AND n.unit_key IS NULL)                  AS b_dh_sin_clave,
         bool_or(n.n_titulares = 0 AND n.unit_key IS NULL)     AS b_lista_sin_titulares_sin_unidad,
         bool_or(n.n_titulares = 0)                            AS b_alguna_lista_sin_titulares
  FROM notas n GROUP BY n.building_id
), tit AS (
  SELECT
    t.id AS titular_id, n.nota_id, n.building_id, n.nota_status,
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
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal')) AS right_type,
    public.p0_role_conflict(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal')) AS role_conflict,
    public.p0_canon_regime(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal'),
      t.metadatos ->> 'regimen', NULL) AS coownership_regime,
    public.p0_regime_conflict(
      t.rol::text,
      coalesce(nullif(btrim(to_jsonb(t) ->> 'rol_literal'), ''), t.metadatos ->> 'rol_literal'),
      t.metadatos ->> 'regimen') AS regime_conflict,
    n.unit_key, n.nota_signature, n.fecha_registral, n.date_conflict,
    n.unit_key_conflict,
    public.p0_evidence_check(t.id) AS ev,
    n.dh, n.sj, n.processed_at, n.created_at
  FROM public.nota_simple_titulares t
  JOIN notas n ON n.nota_id = t.nota_simple_id
), soc AS (
  SELECT tit.*,
    (tit.pre_company_id IS NOT NULL
     -- \m al principio: sin él, "ROSA" o "TERESA" activaban el patrón "S.A."
     OR tit.nombre_extraido ~* '\m(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|PATRIMONI|CAPITAL)\M'
     OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]') AS es_sociedad
  FROM tit
), nota_meta AS (
  -- (2) Parte de notas, NO del inner join: las listas sin titulares existen.
  SELECT n.nota_id, n.building_id, n.unit_key, n.unit_key_conflict,
         n.nota_signature, n.nota_status,
         n.fecha_registral, n.date_conflict, n.processed_at, n.created_at,
         n.n_titulares,
         (n.n_titulares = 0) AS sin_titulares,
         (SELECT count(*) FROM soc s WHERE s.nota_id = n.nota_id AND s.porcentaje IS NOT NULL) AS n_con_pct,
         (SELECT count(*) FROM soc s WHERE s.nota_id = n.nota_id AND s.dni IS NOT NULL) AS n_con_dni
  FROM notas n
), unit_flags AS (
  SELECT unit_key,
         count(*)                                   AS n_notas,
         count(DISTINCT nota_signature)             AS n_firmas,
         count(*) FILTER (WHERE sin_titulares)      AS n_sin_titulares,
         bool_or(date_conflict)                     AS unidad_date_conflict,
         bool_or(unit_key_conflict)                 AS unidad_key_conflict,
         max(fecha_registral)                       AS max_fecha
  FROM nota_meta WHERE unit_key IS NOT NULL GROUP BY unit_key
), top_sig AS (
  SELECT nm.unit_key,
         count(DISTINCT nm.nota_signature) AS n_top_firmas,
         min(nm.nota_signature)            AS top_signature
  FROM nota_meta nm
  JOIN unit_flags uf ON uf.unit_key = nm.unit_key
  WHERE nm.unit_key IS NOT NULL
    AND uf.max_fecha IS NOT NULL
    AND nm.fecha_registral = uf.max_fecha
  GROUP BY nm.unit_key
), unit_state AS (
  SELECT uf.unit_key, uf.n_firmas, uf.n_notas, uf.n_sin_titulares,
         uf.unidad_date_conflict, uf.unidad_key_conflict, uf.max_fecha, ts.top_signature,
    -- Contenido distinto sólo se supersede con cronología registral
    -- inequívoca. Mismo contenido con fechas distintas NO contradice
    -- (la firma ya no incluye la fecha).
    (
      uf.n_sin_titulares = 0
      AND NOT uf.unidad_date_conflict
      AND NOT uf.unidad_key_conflict
      AND (
        uf.n_firmas = 1
        OR (
          uf.max_fecha IS NOT NULL
          AND ts.n_top_firmas = 1
          AND NOT EXISTS (
            SELECT 1 FROM nota_meta x
            WHERE x.unit_key = uf.unit_key
              AND x.nota_signature IS DISTINCT FROM ts.top_signature
              AND (x.fecha_registral IS NULL OR x.fecha_registral >= uf.max_fecha)
          )
        )
      )
    ) AS resuelta
  FROM unit_flags uf
  LEFT JOIN top_sig ts ON ts.unit_key = uf.unit_key
), canon AS (
  -- (2) Contradicción no resuelta o lista sin titulares => CERO canónicas.
  -- (4)(5) Y un bloqueo de edificio deja CERO canónicas en todo el edificio.
  SELECT DISTINCT ON (nm.unit_key) nm.unit_key, nm.nota_id
  FROM nota_meta nm
  JOIN unit_state us ON us.unit_key = nm.unit_key
  JOIN edificio ed ON ed.building_id = nm.building_id
  WHERE nm.unit_key IS NOT NULL
    AND us.resuelta
    AND NOT nm.sin_titulares
    AND NOT coalesce(ed.b_unit_key_conflict, false)
    AND NOT coalesce(ed.b_dh_sin_clave, false)
    AND NOT coalesce(ed.b_lista_sin_titulares_sin_unidad, false)
  ORDER BY nm.unit_key,
           (us.top_signature IS NOT NULL AND nm.nota_signature = us.top_signature) DESC,
           nm.fecha_registral DESC NULLS LAST,
           nm.n_con_pct DESC, nm.n_con_dni DESC, nm.n_titulares DESC,
           nm.processed_at DESC NULLS LAST, nm.created_at DESC, nm.nota_id
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
), m_cif AS (
  SELECT s.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
  FROM soc s
  JOIN public.companies k
    ON nullif(upper(regexp_replace(coalesce(to_jsonb(k) ->> 'cif',''), '[^A-Za-z0-9]', '', 'g')), '') = s.dni
  WHERE s.es_sociedad AND s.dni IS NOT NULL
  GROUP BY s.titular_id
), m_comp AS (
  SELECT s.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
  FROM soc s
  JOIN public.companies k ON public.norm_person_name(k.nombre) = s.nn
  WHERE s.es_sociedad AND s.nn IS NOT NULL
  GROUP BY s.titular_id
), base AS (
  SELECT s.*,
    (c.nota_id IS NOT NULL) AS is_canonical,
    -- (4)(5) Bloqueos que viven en el edificio, no en la unidad.
    (coalesce(ed.b_unit_key_conflict, false)
     OR coalesce(ed.b_dh_sin_clave, false)
     OR coalesce(ed.b_lista_sin_titulares_sin_unidad, false)) AS building_block,
    (coalesce(us.n_firmas, 0) > 1 AND NOT coalesce(us.resuelta, false)) AS unidad_contradictoria,
    (coalesce(us.n_firmas, 0) > 1 AND coalesce(us.resuelta, false))     AS unidad_resuelta_por_fecha,
    (coalesce(us.n_sin_titulares, 0) > 0
     OR coalesce(ed.b_lista_sin_titulares_sin_unidad, false))           AS unidad_con_lista_sin_titulares,
    coalesce(us.unidad_date_conflict, false)                            AS unidad_date_conflict,
    (s.unit_key_conflict OR coalesce(us.unidad_key_conflict, false)
     OR coalesce(ed.b_unit_key_conflict, false))                        AS unidad_key_conflict,
    (s.porcentaje IS NULL OR s.porcentaje <= 0 OR s.porcentaje > 100)   AS invalid_pct,
    (s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL)       AS conflicto_ids,
    -- (5) IDENTIDAD: exactamente UNA coincidencia total. Duplicado => ambiguo.
    (coalesce(md.n,0) > 1 OR coalesce(mn.n,0) > 1
     OR coalesce(mf.n,0) > 1 OR coalesce(mc.n,0) > 1)                   AS identidad_ambigua,
    -- (5) Discrepancia entre el ID preexistente y lo que dice el documento.
    (
      (s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL)
      OR (s.pre_owner_id IS NOT NULL AND md.n = 1 AND md.owner_id IS DISTINCT FROM s.pre_owner_id)
      OR (s.pre_company_id IS NOT NULL AND mf.n = 1 AND mf.company_id IS DISTINCT FROM s.pre_company_id)
      OR (s.es_sociedad AND s.pre_owner_id IS NOT NULL)
      OR (NOT s.es_sociedad AND s.pre_company_id IS NOT NULL)
    )                                                                    AS identity_conflict,
    CASE
      WHEN coalesce(md.n,0) > 1 OR coalesce(mn.n,0) > 1
        OR coalesce(mf.n,0) > 1 OR coalesce(mc.n,0) > 1 THEN NULL
      WHEN s.pre_owner_id IS NOT NULL AND md.n = 1 AND md.owner_id IS DISTINCT FROM s.pre_owner_id THEN NULL
      WHEN s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL THEN NULL
      WHEN s.es_sociedad AND s.pre_owner_id IS NOT NULL THEN NULL
      WHEN s.pre_owner_id IS NOT NULL THEN s.pre_owner_id
      WHEN s.pre_company_id IS NOT NULL THEN NULL
      WHEN NOT s.es_sociedad THEN
        CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id END
    END AS f_owner_id,
    CASE
      WHEN coalesce(md.n,0) > 1 OR coalesce(mn.n,0) > 1
        OR coalesce(mf.n,0) > 1 OR coalesce(mc.n,0) > 1 THEN NULL
      WHEN s.pre_company_id IS NOT NULL AND mf.n = 1 AND mf.company_id IS DISTINCT FROM s.pre_company_id THEN NULL
      WHEN s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL THEN NULL
      WHEN NOT s.es_sociedad AND s.pre_company_id IS NOT NULL THEN NULL
      WHEN s.pre_company_id IS NOT NULL THEN s.pre_company_id
      WHEN s.pre_owner_id IS NOT NULL THEN NULL
      WHEN s.es_sociedad THEN
        CASE WHEN mf.n = 1 THEN mf.company_id WHEN mc.n = 1 THEN mc.company_id END
    END AS f_company_id,
    (md.n = 1 AND s.pre_company_id IS NULL
     AND coalesce(mn.n,0) <= 1
     AND (s.pre_owner_id IS NULL OR s.pre_owner_id = md.owner_id)) AS dni_inequivoco,
    CASE
      WHEN coalesce(md.n,0) > 1 OR coalesce(mn.n,0) > 1
        OR coalesce(mf.n,0) > 1 OR coalesce(mc.n,0) > 1 THEN 'ambiguo'
      WHEN s.pre_owner_id IS NOT NULL AND s.pre_company_id IS NOT NULL THEN 'conflicto_owner_y_company'
      WHEN s.es_sociedad AND s.pre_company_id IS NOT NULL THEN 'company_preexistente'
      WHEN s.es_sociedad AND mf.n = 1 THEN 'cif'
      WHEN s.es_sociedad AND mc.n = 1 THEN 'nombre_sociedad_revisable'
      WHEN s.es_sociedad THEN 'ninguno'
      WHEN md.n = 1 THEN 'dni'
      WHEN s.pre_owner_id IS NOT NULL THEN 'owner_preexistente'
      WHEN mn.n = 1 THEN 'nombre_exacto'
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
  LEFT JOIN edificio ed ON ed.building_id = s.building_id
  LEFT JOIN m_dni md ON md.titular_id = s.titular_id
  LEFT JOIN m_nom mn ON mn.titular_id = s.titular_id
  LEFT JOIN m_cif mf ON mf.titular_id = s.titular_id
  LEFT JOIN m_comp mc ON mc.titular_id = s.titular_id
), fila AS (
  -- (1) SEGURIDAD DE FILA, antes de mirar la capa.
  SELECT b.*,
    (b.ev ->> 'evidence_ok')::boolean        AS evidence_ok,
    (b.ev ->> 'evidence_ambiguous')::boolean AS evidence_ambiguous,
    (b.ev ->> 'bad_evidence')::boolean       AS bad_evidence,
    coalesce((b.ev ->> 'structured_unverified')::boolean, false) AS structured_unverified,
    -- (3) FILA PROBLEMÁTICA: cualquier defecto, INDEPENDIENTE del derecho.
    -- Una sola fila así envenena TODA la unidad, no sólo su capa.
    (
      b.role_conflict
      OR b.regime_conflict
      OR b.date_conflict
      OR b.unidad_date_conflict
      OR b.unidad_key_conflict
      OR b.identity_conflict
      OR b.conflicto_ids
      OR b.identidad_ambigua
      OR b.building_block
      OR b.right_type = 'otro'
      OR b.coownership_regime = 'gananciales'
      OR b.invalid_pct
      OR coalesce((b.ev ->> 'structured_unverified')::boolean, false)
      OR NOT coalesce((b.ev ->> 'evidence_ok')::boolean, false)
      OR coalesce((b.ev ->> 'evidence_ambiguous')::boolean, false)
      OR coalesce((b.ev ->> 'bad_evidence')::boolean, false)
      OR b.es_sociedad
      OR (b.f_owner_id IS NULL AND b.f_company_id IS NULL)
      OR NOT b.dni_inequivoco
      OR b.unidad_contradictoria
      OR b.unidad_con_lista_sin_titulares
      OR b.unit_key IS NULL
      OR b.dh
    ) AS fila_problematica,
    (
      b.is_canonical
      AND b.right_type = 'pleno_dominio'
      AND NOT b.role_conflict
      AND NOT b.regime_conflict
      AND NOT b.date_conflict
      AND NOT b.unidad_date_conflict
      AND NOT b.unidad_key_conflict
      AND NOT b.building_block
      AND NOT b.identity_conflict
      AND b.coownership_regime <> 'gananciales'
      AND NOT b.conflicto_ids
      AND NOT b.identidad_ambigua
      AND NOT b.es_sociedad
      AND b.f_company_id IS NULL
      AND b.f_owner_id IS NOT NULL
      AND b.dni_inequivoco
      AND coalesce((b.ev ->> 'evidence_ok')::boolean, false)
      AND NOT coalesce((b.ev ->> 'evidence_ambiguous')::boolean, false)
      AND NOT coalesce((b.ev ->> 'bad_evidence')::boolean, false)
      AND NOT coalesce((b.ev ->> 'structured_unverified')::boolean, false)
      AND NOT b.invalid_pct
      AND b.unit_key IS NOT NULL
      AND NOT b.dh
      AND NOT b.unidad_contradictoria
      AND NOT b.unidad_con_lista_sin_titulares
    ) AS row_safe_pre_layer
  FROM base b
), unidad_eval AS (
  -- (3) SEGURIDAD DE UNIDAD COMPLETA: se mira TODA la unidad canónica, no
  -- sólo la capa de pleno_dominio. Una fila 'otro'/conflictiva convive con
  -- un pleno al 100 % y aun así deja la unidad en CERO feeds. Nunca se
  -- suman nuda + usufructo + pleno: si la unidad no es íntegramente pleno
  -- operativo, no hay proyección personal.
  SELECT unit_key,
         count(*)                                            AS unidad_filas,
         count(*) FILTER (WHERE fila_problematica)            AS unidad_filas_problematicas,
         count(*) FILTER (WHERE right_type <> 'pleno_dominio') AS unidad_filas_no_pleno,
         count(DISTINCT right_type)                          AS unidad_derechos,
         bool_and(NOT fila_problematica AND right_type = 'pleno_dominio') AS unidad_segura
  FROM fila
  WHERE is_canonical AND unit_key IS NOT NULL
  GROUP BY unit_key
), capa AS (
  -- (1) CAPA INDIVISIBLE: un solo fallo invalida la capa entera.
  SELECT unit_key, nota_id, right_type,
         sum(porcentaje)                                              AS capa_suma,
         count(*)                                                     AS capa_filas,
         count(*) FILTER (WHERE porcentaje IS NULL OR invalid_pct)    AS capa_pct_malos,
         count(DISTINCT coalesce(dni, nn, titular_id::text))          AS capa_identidades,
         count(*) FILTER (WHERE NOT row_safe_pre_layer)               AS capa_filas_inseguras,
         count(*) FILTER (WHERE identidad_ambigua)                    AS capa_identidades_ambiguas,
         count(*) FILTER (WHERE es_sociedad)                          AS capa_sociedades,
         count(*) FILTER (WHERE coownership_regime = 'gananciales')   AS capa_gananciales,
         count(*) FILTER (WHERE dh)                                   AS capa_dh,
         count(*) FILTER (WHERE role_conflict OR regime_conflict
                             OR conflicto_ids OR date_conflict
                             OR unidad_key_conflict OR identity_conflict
                             OR building_block OR structured_unverified
                             OR unidad_contradictoria
                             OR unidad_con_lista_sin_titulares)       AS capa_conflictos,
         count(*) FILTER (WHERE NOT coalesce(evidence_ok,false))      AS capa_sin_evidencia
  FROM fila
  WHERE is_canonical AND unit_key IS NOT NULL
  GROUP BY unit_key, nota_id, right_type
), capa_eval AS (
  SELECT capa.*,
    (
      abs(coalesce(capa_suma, -1) - 100) <= 0.01
      AND capa_pct_malos = 0
      AND capa_identidades = capa_filas
      AND capa_identidades_ambiguas = 0
      AND capa_sin_evidencia = 0
      AND capa_conflictos = 0
      AND capa_gananciales = 0
      AND capa_sociedades = 0
      AND capa_dh = 0
      AND capa_filas_inseguras = 0
    ) AS layer_safe
  FROM capa
), e AS (
  SELECT f.*, k.capa_suma, k.capa_filas, k.capa_pct_malos AS capa_nulos,
         coalesce(ue.unidad_segura, false)  AS unidad_segura,
         coalesce(ue.unidad_filas_problematicas, 0) AS unidad_filas_problematicas,
         coalesce(ue.unidad_filas_no_pleno, 0)      AS unidad_filas_no_pleno,
         -- (3) layer_safe SÓLO es cierto si la capa cierra Y la UNIDAD
         -- entera es segura. Nunca se calcula "dentro de pleno_dominio"
         -- ignorando filas problemáticas de la misma unidad.
         (coalesce(k.layer_safe, false) AND coalesce(ue.unidad_segura, false)) AS layer_safe,
         (coalesce(k.layer_safe, false) AND coalesce(ue.unidad_segura, false)) AS layer_complete
  FROM fila f
  LEFT JOIN unidad_eval ue ON ue.unit_key = f.unit_key AND f.is_canonical
  LEFT JOIN capa_eval k
    ON k.unit_key = f.unit_key AND k.nota_id = f.nota_id AND k.right_type = f.right_type
   AND f.is_canonical
)
-- =====================================================================
-- CONTRATO DE FIRMA (P0.1): las 39 primeras columnas son EXACTAMENTE las
-- de 1A.2 (mismo nombre, mismo orden, mismo tipo). Las columnas nuevas de
-- 1A.3 van SIEMPRE al final. Cualquier desplazamiento rompe
-- CREATE OR REPLACE VIEW y a los consumidores existentes.
-- =====================================================================
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
    WHEN e.building_block THEN 'bloqueo_edificio'
    WHEN e.unidad_con_lista_sin_titulares THEN 'nota_lista_sin_titulares'
    WHEN e.unidad_key_conflict THEN 'unit_key_conflict'
    WHEN e.unit_key IS NULL AND e.dh THEN 'dh_sin_unidad_registral'
    WHEN e.dh THEN 'dh_no_proyectable_a_cuota_edificio'
    WHEN e.unidad_date_conflict THEN 'date_conflict'
  END AS unit_block_reason,
  CASE
    WHEN e.unidad_contradictoria OR e.unidad_con_lista_sin_titulares
         OR e.unidad_date_conflict OR e.unidad_key_conflict
         OR e.building_block THEN 'blocked_conflict'
    WHEN e.is_canonical THEN 'active'
    ELSE 'superseded'
  END AS status,
  (NOT (e.row_safe_pre_layer AND e.layer_safe AND e.unidad_segura)) AS review_flag,
  nullif(concat_ws(' · ',
    CASE WHEN e.building_block
         THEN 'bloqueo a nivel de edificio: hay una nota cuya unidad no puede identificarse; cero canónicas y cero cuota en TODO el edificio' END,
    CASE WHEN e.unidad_key_conflict
         THEN 'dos localizadores registrales válidos y distintos (IDUFIR/finca/refcat): la unidad no es inequívoca (unit_key_conflict)' END,
    CASE WHEN e.unidad_con_lista_sin_titulares
         THEN 'la unidad tiene una nota "listo" sin titulares: bloquea cuota, unidad y nota anterior (nota_lista_sin_titulares)' END,
    CASE WHEN e.date_conflict OR e.unidad_date_conflict
         THEN 'dos fechas registrales válidas y distintas: cronología no fiable (date_conflict)' END,
    CASE WHEN e.regime_conflict
         THEN 'régimen contradictorio en los campos registrales (regime_conflict)' END,
    CASE WHEN e.conflicto_ids THEN 'el titular trae owner_id y company_id a la vez' END,
    CASE WHEN e.identity_conflict
         THEN 'discrepancia entre el vínculo preexistente y lo que dice el documento (identity_conflict)' END,
    CASE WHEN e.identidad_ambigua THEN 'identidad ambigua: varios candidatos en el CRM' END,
    CASE WHEN e.structured_unverified
         THEN 'structured_json/ruta/página/offset sin cita anclada: auditoría, nunca evidencia (structured_unverified)' END,
    CASE WHEN e.role_conflict THEN 'conflicto de fuentes de derecho: se clasifica como "otro"' END,
    CASE WHEN e.right_type = 'otro' THEN 'derecho no reconocido: nunca es pleno dominio' END,
    CASE WHEN e.coownership_regime = 'gananciales' THEN 'carácter ganancial: no alimenta cuota personal' END,
    CASE WHEN coalesce(e.bad_evidence,false) THEN 'evidencia contradictoria, no anclada o ausente' END,
    CASE WHEN coalesce(e.evidence_ambiguous,false) THEN 'evidencia ambigua (varios candidatos, titulares, porcentajes o derechos)' END,
    CASE WHEN e.invalid_pct THEN 'porcentaje ausente o fuera de rango (0,100]' END,
    CASE WHEN e.f_owner_id IS NULL AND e.f_company_id IS NULL THEN 'titular registral sin conciliar con el CRM' END,
    CASE WHEN e.es_sociedad AND e.f_company_id IS NOT NULL
         THEN 'sociedad conciliada: el derecho se conserva, pero no proyecta cuota personal y bloquea la capa' END,
    CASE WHEN NOT e.es_sociedad AND e.f_owner_id IS NOT NULL AND NOT e.dni_inequivoco
         THEN 'vínculo conservado sin DNI exacto e inequívoco' END,
    CASE WHEN e.dh THEN 'división horizontal: nunca proyecta a building_owners.cuota' END,
    CASE WHEN e.unit_key IS NULL THEN 'sin unidad de titularidad resoluble o localizador registral inválido' END,
    CASE WHEN e.unidad_contradictoria THEN 'contradicción de contenido sin cronología registral inequívoca: cero notas canónicas' END,
    CASE WHEN NOT e.is_canonical THEN 'nota no canónica de la unidad: se conserva para auditoría, no opera' END,
    CASE WHEN e.is_canonical AND NOT coalesce(e.unidad_segura,false) AND NOT e.fila_problematica
         THEN 'otra fila canónica de la MISMA unidad es insegura o no es pleno operativo: la unidad completa no proyecta' END,
    CASE WHEN e.row_safe_pre_layer AND NOT e.layer_safe
         THEN 'capa no segura: otra fila de la misma capa falla, la capa es indivisible' END
  ), '') AS review_reason,
  -- (1)(3) feeds_cuota = fila segura Y capa segura Y unidad completa segura.
  (e.row_safe_pre_layer AND e.layer_safe AND e.unidad_segura) AS feeds_cuota,
  -- ---------------- COLUMNAS NUEVAS DE 1A.3 (siempre al final) --------
  e.nota_signature AS ownership_signature,
  e.date_conflict,
  e.unidad_date_conflict,
  e.regime_conflict,
  e.unidad_key_conflict,
  e.identidad_ambigua,
  e.identity_conflict,
  e.structured_unverified,
  e.building_block,
  e.unidad_con_lista_sin_titulares,
  e.fila_problematica,
  e.unidad_segura,
  e.unidad_filas_problematicas,
  e.unidad_filas_no_pleno,
  e.capa_filas,
  e.row_safe_pre_layer,
  e.layer_safe
FROM e;

REVOKE ALL ON public.v_p0_rights_staging FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_rights_staging TO service_role;

COMMENT ON VIEW public.v_p0_rights_staging IS
  'Wave 1A.3 P0.1: staging read-only 1:1 con nota_simple_titulares de notas listo. feeds_cuota = row_safe_pre_layer AND layer_safe AND unidad_segura: fila, capa y UNIDAD COMPLETA. Las 39 primeras columnas conservan exactamente la firma de 1A.2.';

-- ---------------------------------------------------------------------
-- 9.b) VALIDADOR DE CONTRATO DE FIRMA 1A.2 -> 1A.3 (fail-closed)
-- ---------------------------------------------------------------------
-- Si una columna de 1A.2 se desplaza, se renombra o cambia de tipo, esta
-- migración FALLA aquí y no deja la vista en un estado incompatible.
DO $contrato$
DECLARE
  v_esperado text[] := ARRAY[
    'titular_id:uuid',
    'note_simple_id:uuid',
    'building_id:uuid',
    'ownership_unit_key:text',
    'is_canonical:boolean',
    'nota_signature:text',
    'nota_fecha_registral:date',
    'titular_nombre:text',
    'titular_dni:text',
    'right_type:text',
    'percentage:numeric',
    'coownership_regime:text',
    'role_conflict:boolean',
    'owner_id:uuid',
    'company_id:uuid',
    'conflicto_ids:boolean',
    'identity_match:text',
    'confidence:numeric',
    'evidence_ok:boolean',
    'evidence_ambiguous:boolean',
    'bad_evidence:boolean',
    'evidence_ref:jsonb',
    'audit_ids:jsonb',
    'right_literal:text',
    'es_sociedad:boolean',
    'division_horizontal:boolean',
    'dh:boolean',
    'nota_status:text',
    'unidad_contradictoria:boolean',
    'unidad_resuelta_por_fecha:boolean',
    'invalid_pct:boolean',
    'capa_suma:numeric',
    'capa_nulos:bigint',
    'layer_complete:boolean',
    'unit_block_reason:text',
    'status:text',
    'review_flag:boolean',
    'review_reason:text',
    'feeds_cuota:boolean'
  ];
  v_real  text[];
  v_i     int;
BEGIN
  SELECT array_agg(c.column_name || ':' || c.data_type ORDER BY c.ordinal_position)
    INTO v_real
  FROM information_schema.columns c
  WHERE c.table_schema = 'public' AND c.table_name = 'v_p0_rights_staging'
    AND c.ordinal_position <= array_length(v_esperado, 1);

  IF v_real IS NULL THEN
    RAISE EXCEPTION 'CONTRATO 1A.2: la vista v_p0_rights_staging no existe';
  END IF;

  FOR v_i IN 1 .. array_length(v_esperado, 1) LOOP
    IF v_real[v_i] IS DISTINCT FROM v_esperado[v_i] THEN
      RAISE EXCEPTION
        'CONTRATO 1A.2 ROTO en la posición %: se esperaba "%" y hay "%". Las columnas de 1A.2 no pueden desplazarse, renombrarse ni cambiar de tipo; las nuevas van al final.',
        v_i, v_esperado[v_i], v_real[v_i];
    END IF;
  END LOOP;
END
$contrato$;

-- Notas 'listo' SIN titulares: existen, se cuentan y bloquean su unidad.
CREATE OR REPLACE VIEW public.v_p0_notas_listo_sin_titulares AS
SELECT ns.id AS nota_id, ns.building_id,
       public.p0_nota_unit_key(ns.id) AS ownership_unit_key,
       ns.processed_at, ns.created_at,
       'nota_lista_sin_titulares'::text AS motivo
FROM public.notas_simples ns
WHERE ns.status = 'listo'
  AND ns.building_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.nota_simple_titulares t WHERE t.nota_simple_id = ns.id);

REVOKE ALL ON public.v_p0_notas_listo_sin_titulares FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_p0_notas_listo_sin_titulares TO service_role;

-- ---------------------------------------------------------------------
-- 10) DRY-RUN 1A.3: safety_invariants_ok vs readiness_ok
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_property_rights_dry_run()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
WITH src AS (
  SELECT count(*) AS n
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  WHERE ns.building_id IS NOT NULL AND ns.status = 'listo'
), notas AS (
  SELECT count(*) AS n_listo
  FROM public.notas_simples ns
  WHERE ns.status = 'listo' AND ns.building_id IS NOT NULL
), sin_tit AS (
  SELECT count(*) AS n,
         count(DISTINCT ownership_unit_key) FILTER (WHERE ownership_unit_key IS NOT NULL) AS unidades
  FROM public.v_p0_notas_listo_sin_titulares
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
    count(*) FILTER (WHERE identidad_ambigua) AS identidades_ambiguas,
    count(*) FILTER (WHERE identity_conflict) AS identity_conflicts,
    count(*) FILTER (WHERE unidad_key_conflict) AS unit_key_conflicts,
    count(*) FILTER (WHERE building_block) AS filas_bloqueadas_por_edificio,
    count(*) FILTER (WHERE structured_unverified) AS structured_unverified,
    count(*) FILTER (WHERE date_conflict OR unidad_date_conflict) AS date_conflicts,
    count(*) FILTER (WHERE regime_conflict) AS regime_conflicts,
    count(*) FILTER (WHERE unidad_con_lista_sin_titulares) AS filas_bloqueadas_por_lista_sin_titulares,
    count(*) FILTER (WHERE unit_block_reason = 'dh_sin_unidad_registral') AS dh_sin_unidad,
    count(*) FILTER (WHERE ownership_unit_key IS NULL) AS localizadores_invalidos,
    count(*) FILTER (WHERE evidence_ok) AS evidence_ok,
    count(*) FILTER (WHERE NOT evidence_ok) AS evidence_missing,
    count(*) FILTER (WHERE NOT coalesce((evidence_ref ->> 'anclada')::boolean, false)) AS citas_no_ancladas,
    count(*) FILTER (WHERE role_conflict) AS role_conflicts,
    count(*) FILTER (WHERE invalid_pct) AS invalid_pct,
    count(*) FILTER (WHERE evidence_ambiguous) AS evidence_ambiguous,
    count(*) FILTER (WHERE bad_evidence) AS bad_evidence,
    count(*) FILTER (WHERE es_sociedad AND company_id IS NOT NULL) AS sociedades_conciliadas_no_proyectables,
    count(*) FILTER (WHERE is_canonical) AS filas_canonicas,
    count(*) FILTER (WHERE row_safe_pre_layer) AS filas_seguras_pre_capa,
    count(*) FILTER (WHERE feeds_cuota) AS feeds_cuota,
    count(*) FILTER (WHERE feeds_cuota AND right_type <> 'pleno_dominio') AS bad_no_pleno_feeds,
    count(*) FILTER (WHERE feeds_cuota AND owner_id IS NULL) AS bad_unmatched_feeds,
    count(*) FILTER (WHERE feeds_cuota AND conflicto_ids) AS bad_conflicto_feeds,
    count(*) FILTER (WHERE feeds_cuota AND unidad_contradictoria) AS bad_contradiccion_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT is_canonical) AS bad_no_canonica_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT layer_safe) AS bad_capa_insegura_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT unidad_segura) AS bad_unidad_insegura_feeds,
    count(*) FILTER (WHERE feeds_cuota AND unidad_key_conflict) AS bad_unit_key_conflict_feeds,
    count(*) FILTER (WHERE feeds_cuota AND building_block) AS bad_building_block_feeds,
    count(*) FILTER (WHERE feeds_cuota AND identity_conflict) AS bad_identity_conflict_feeds,
    count(*) FILTER (WHERE feeds_cuota AND structured_unverified) AS bad_structured_unverified_feeds,
    count(*) FILTER (WHERE feeds_cuota AND fila_problematica) AS bad_fila_problematica_feeds,
    count(*) FILTER (WHERE feeds_cuota AND NOT row_safe_pre_layer) AS bad_fila_insegura_feeds,
    count(*) FILTER (WHERE feeds_cuota AND role_conflict) AS bad_role_conflict_feeds,
    count(*) FILTER (WHERE feeds_cuota AND regime_conflict) AS bad_regime_conflict_feeds,
    count(*) FILTER (WHERE feeds_cuota AND (date_conflict OR unidad_date_conflict)) AS bad_date_conflict_feeds,
    count(*) FILTER (WHERE feeds_cuota AND invalid_pct) AS bad_invalid_pct_feeds,
    count(*) FILTER (WHERE feeds_cuota AND coownership_regime = 'gananciales') AS bad_ganancial_feeds,
    count(*) FILTER (WHERE feeds_cuota AND es_sociedad) AS bad_sociedad_feeds,
    count(*) FILTER (WHERE feeds_cuota AND identidad_ambigua) AS bad_identidad_ambigua_feeds,
    count(*) FILTER (WHERE feeds_cuota AND unidad_con_lista_sin_titulares) AS bad_lista_sin_titulares_feeds,
    count(*) FILTER (WHERE feeds_cuota AND (bad_evidence OR evidence_ambiguous OR NOT evidence_ok)) AS bad_evidence_feeds,
    count(*) FILTER (WHERE feeds_cuota AND division_horizontal) AS dh_feeds
  FROM s
), capas AS (
  SELECT ownership_unit_key, note_simple_id, right_type,
         bool_or(layer_safe) AS segura,
         count(*) FILTER (WHERE row_safe_pre_layer) AS filas_ok,
         count(*) AS filas
  FROM s WHERE is_canonical AND ownership_unit_key IS NOT NULL
  GROUP BY ownership_unit_key, note_simple_id, right_type
), c AS (
  SELECT count(*) FILTER (WHERE segura) AS capas_seguras,
         count(*) FILTER (WHERE NOT segura) AS capas_no_seguras,
         count(*) FILTER (WHERE NOT segura AND filas_ok > 0) AS capas_parcialmente_elegibles
  FROM capas
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
    count(*) FILTER (WHERE contradictoria AND n_canon > 0) AS contradicciones_con_canonica,
    count(*) FILTER (WHERE resuelta_por_fecha) AS supersedidas_por_fecha,
    count(*) FILTER (WHERE n_notas > 1 AND n_firmas = 1) AS duplicados_identicos,
    count(*) FILTER (WHERE n_canon > 1) AS unidades_multi_canonica
  FROM unidades
)
SELECT jsonb_build_object(
  'wave', '1A.3',
  'universo', 'notas_simples.status = listo (todas, con y sin titulares)',
  'notas_listo', notas.n_listo,
  'notas_listo_sin_titulares', sin_tit.n,
  'unidades_bloqueadas_por_lista_sin_titulares', sin_tit.unidades,
  'filas_bloqueadas_por_lista_sin_titulares', agg.filas_bloqueadas_por_lista_sin_titulares,
  'source_titulares', src.n,
  'staged_rows', agg.staged_rows,
  'titulares_unicos', agg.titulares_unicos,
  'paridad_1a1', (agg.staged_rows = src.n AND agg.titulares_unicos = agg.staged_rows),
  'unmatched', agg.unmatched,
  'conflicto_owner_y_company', agg.conflicto_owner_y_company,
  'identidades_ambiguas', agg.identidades_ambiguas,
  'identity_conflicts', agg.identity_conflicts,
  'unit_key_conflicts', agg.unit_key_conflicts,
  'filas_bloqueadas_por_edificio', agg.filas_bloqueadas_por_edificio,
  'structured_unverified', agg.structured_unverified,
  'date_conflicts', agg.date_conflicts,
  'regime_conflicts', agg.regime_conflicts,
  'localizadores_invalidos', agg.localizadores_invalidos,
  'citas_no_ancladas', agg.citas_no_ancladas,
  'sociedades_conciliadas_no_proyectables', agg.sociedades_conciliadas_no_proyectables,
  'dh_sin_unidad', agg.dh_sin_unidad,
  'dh_feeds', agg.dh_feeds,
  'evidence_ok', agg.evidence_ok,
  'evidence_missing', agg.evidence_missing,
  'evidence_ambiguous', agg.evidence_ambiguous,
  'bad_evidence', agg.bad_evidence,
  'role_conflicts', agg.role_conflicts,
  'invalid_pct', agg.invalid_pct,
  'unidades', u.unidades,
  'notas_canonicas', u.notas_canonicas,
  'contradicciones', u.contradicciones,
  'contradicciones_con_canonica', u.contradicciones_con_canonica,
  'supersedidas_por_fecha', u.supersedidas_por_fecha,
  'duplicados_identicos', u.duplicados_identicos,
  'filas_canonicas', agg.filas_canonicas,
  'filas_seguras_pre_capa', agg.filas_seguras_pre_capa,
  'capas_seguras', c.capas_seguras,
  'capas_no_seguras', c.capas_no_seguras,
  'capas_parcialmente_elegibles', c.capas_parcialmente_elegibles,
  'feeds_cuota', agg.feeds_cuota,
  -- (7) SEGURIDAD: nada inseguro se proyecta jamás.
  'safety_invariants', jsonb_build_object(
    'paridad_1a1', (agg.staged_rows = src.n AND agg.titulares_unicos = agg.staged_rows),
    'todas_con_building_id', agg.staged_con_building = agg.staged_rows,
    'solo_pleno_alimenta_cuota', agg.bad_no_pleno_feeds = 0,
    'solo_fila_segura_alimenta_cuota', agg.bad_fila_insegura_feeds = 0,
    'solo_capa_segura_alimenta_cuota', agg.bad_capa_insegura_feeds = 0,
    'solo_unidad_completa_segura_alimenta_cuota', agg.bad_unidad_insegura_feeds = 0,
    'fila_problematica_no_alimenta_cuota', agg.bad_fila_problematica_feeds = 0,
    'unit_key_conflict_no_alimenta_cuota', agg.bad_unit_key_conflict_feeds = 0,
    'bloqueo_edificio_no_alimenta_cuota', agg.bad_building_block_feeds = 0,
    'identity_conflict_no_alimenta_cuota', agg.bad_identity_conflict_feeds = 0,
    'structured_solo_no_alimenta_cuota', agg.bad_structured_unverified_feeds = 0,
    'solo_canonica_alimenta_cuota', agg.bad_no_canonica_feeds = 0,
    'max_una_canonica_por_unidad', u.unidades_multi_canonica = 0,
    'contradiccion_sin_canonica', u.contradicciones_con_canonica = 0,
    'conflicto_no_alimenta_cuota', agg.bad_conflicto_feeds = 0,
    'identidad_ambigua_no_alimenta_cuota', agg.bad_identidad_ambigua_feeds = 0,
    'sin_mezcla_owner_company', agg.mezcla_owner_company = 0,
    'unmatched_no_alimenta_cuota', agg.bad_unmatched_feeds = 0,
    'sociedad_no_alimenta_cuota', agg.bad_sociedad_feeds = 0,
    'ganancial_no_alimenta_cuota', agg.bad_ganancial_feeds = 0,
    'role_conflict_no_alimenta_cuota', agg.bad_role_conflict_feeds = 0,
    'regime_conflict_no_alimenta_cuota', agg.bad_regime_conflict_feeds = 0,
    'date_conflict_no_alimenta_cuota', agg.bad_date_conflict_feeds = 0,
    'pct_invalido_no_alimenta_cuota', agg.bad_invalid_pct_feeds = 0,
    'evidencia_mala_o_ambigua_no_alimenta_cuota', agg.bad_evidence_feeds = 0,
    'lista_sin_titulares_no_alimenta_cuota', agg.bad_lista_sin_titulares_feeds = 0,
    'contradiccion_no_alimenta_cuota', agg.bad_contradiccion_feeds = 0,
    'dh_no_alimenta_cuota', agg.dh_feeds = 0
  ),
  'safety_invariants_ok', (
    agg.staged_rows = src.n
    AND agg.staged_con_building = agg.staged_rows
    AND agg.titulares_unicos = agg.staged_rows
    AND agg.bad_no_pleno_feeds = 0
    AND agg.bad_fila_insegura_feeds = 0
    AND agg.bad_capa_insegura_feeds = 0
    AND agg.bad_unidad_insegura_feeds = 0
    AND agg.bad_fila_problematica_feeds = 0
    AND agg.bad_unit_key_conflict_feeds = 0
    AND agg.bad_building_block_feeds = 0
    AND agg.bad_identity_conflict_feeds = 0
    AND agg.bad_structured_unverified_feeds = 0
    AND agg.bad_no_canonica_feeds = 0
    AND u.unidades_multi_canonica = 0
    AND u.contradicciones_con_canonica = 0
    AND agg.bad_conflicto_feeds = 0
    AND agg.bad_identidad_ambigua_feeds = 0
    AND agg.mezcla_owner_company = 0
    AND agg.bad_unmatched_feeds = 0
    AND agg.bad_sociedad_feeds = 0
    AND agg.bad_ganancial_feeds = 0
    AND agg.bad_role_conflict_feeds = 0
    AND agg.bad_regime_conflict_feeds = 0
    AND agg.bad_date_conflict_feeds = 0
    AND agg.bad_invalid_pct_feeds = 0
    AND agg.bad_evidence_feeds = 0
    AND agg.bad_lista_sin_titulares_feeds = 0
    AND agg.bad_contradiccion_feeds = 0
    AND agg.dh_feeds = 0
  ),
  -- (7) PREPARACIÓN: false ante CUALQUIER bloqueo pendiente.
  'readiness_ok', (
    sin_tit.n = 0
    AND agg.date_conflicts = 0
    AND agg.regime_conflicts = 0
    AND agg.role_conflicts = 0
    AND agg.identidades_ambiguas = 0
    AND agg.identity_conflicts = 0
    AND agg.unit_key_conflicts = 0
    AND agg.filas_bloqueadas_por_edificio = 0
    AND agg.structured_unverified = 0
    AND agg.conflicto_owner_y_company = 0
    AND agg.localizadores_invalidos = 0
    AND agg.citas_no_ancladas = 0
    AND agg.sociedades_conciliadas_no_proyectables = 0
    AND u.contradicciones = 0
    AND c.capas_no_seguras = 0
    AND agg.evidence_missing = 0
  ),
  'applied', false,
  'real_rebuild', 'disabled'
) FROM src, notas, sin_tit, agg, c, u;
$$;

REVOKE ALL ON FUNCTION public.p0_property_rights_dry_run() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_property_rights_dry_run() TO service_role;

-- ---------------------------------------------------------------------
-- 11) Rebuild REAL: sigue DESHABILITADO
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.p0_rebuild_property_rights(
  p_reason text DEFAULT 'wave1a3',
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
                               'motivo', 'Wave 1A.3: rebuild real deshabilitado, solo dry-run');
END $$;

REVOKE ALL ON FUNCTION public.p0_rebuild_property_rights(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.p0_rebuild_property_rights(text, boolean) TO service_role;

-- Permisos de los helpers nuevos.
REVOKE ALL ON FUNCTION public.p0_norm_text(text)                          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_fecha_candidatos(jsonb)                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_date_conflict(jsonb)                FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_regime_candidates(text, text, text)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_regime_conflict(text, text, text)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_frac_contexto_ok(text)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_locator_valid(text, text, text)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_unit_locator_valid(text, text)           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_unit_claves(uuid)                   FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_unit_key_conflict(uuid)             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.p0_nota_ownership_signature(uuid)           FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.p0_norm_text(text)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_fecha_candidatos(jsonb)               TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_date_conflict(jsonb)             TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_regime_candidates(text, text, text)   TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_regime_conflict(text, text, text)     TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_frac_contexto_ok(text)                TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_locator_valid(text, text, text)       TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_unit_locator_valid(text, text)        TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_unit_claves(uuid)                TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_unit_key_conflict(uuid)          TO service_role;
GRANT EXECUTE ON FUNCTION public.p0_nota_ownership_signature(uuid)        TO service_role;