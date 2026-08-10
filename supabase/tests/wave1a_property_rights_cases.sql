-- =====================================================================
-- WAVE 1A.1 · Test SQL EJECUTABLE (aún NO ejecutado)
-- Todo ocurre dentro de una transacción que termina en ROLLBACK.
-- Cada aserción lanza excepción si falla. No escribe nada permanente.
-- Uso previsto:  psql -v ON_ERROR_STOP=1 -f este_fichero.sql
-- =====================================================================
BEGIN;

-- Helper de aserción local a la transacción.
CREATE OR REPLACE FUNCTION pg_temp.assert(p_cond boolean, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_msg;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 0) Checksums ANTES (tablas que esta Wave NO debe tocar)
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _before AS
SELECT 'building_property_rights' AS t, count(*) AS n,
       coalesce(md5(string_agg(md5(x::text), '|' ORDER BY md5(x::text))), '') AS ck
FROM public.building_property_rights x
UNION ALL SELECT 'building_owners', count(*),
       coalesce(md5(string_agg(md5(y::text), '|' ORDER BY md5(y::text))), '') FROM public.building_owners y
UNION ALL SELECT 'buildings', count(*),
       coalesce(md5(string_agg(md5(z::text), '|' ORDER BY md5(z::text))), '') FROM public.buildings z
UNION ALL SELECT 'building_tasks', count(*),
       coalesce(md5(string_agg(md5(w::text), '|' ORDER BY md5(w::text))), '') FROM public.building_tasks w;

-- ---------------------------------------------------------------------
-- 1) Fixtures sintéticos mínimos
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _ids AS
SELECT
  '11111111-1111-1111-1111-000000000001'::uuid AS b1,  -- sin DH
  '11111111-1111-1111-1111-000000000002'::uuid AS b2,  -- DH con clave fiable
  '11111111-1111-1111-1111-000000000003'::uuid AS b3,  -- DH sin clave fiable
  '11111111-1111-1111-1111-000000000004'::uuid AS b4,  -- 60/40 vs 50/50
  '11111111-1111-1111-1111-000000000005'::uuid AS b5,  -- capa 90 (bloqueada)
  '11111111-1111-1111-1111-000000000006'::uuid AS b6,  -- duplicado idéntico
  '11111111-1111-1111-1111-000000000007'::uuid AS b7,  -- negativos structured_json
  '22222222-2222-2222-2222-000000000001'::uuid AS o_ana,
  '22222222-2222-2222-2222-000000000002'::uuid AS o_juan,
  '33333333-3333-3333-3333-000000000001'::uuid AS c_soc;

INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal)
SELECT b1, 'TEST W1A1 B1', 'Madrid', false FROM _ids
UNION ALL SELECT b2, 'TEST W1A1 B2', 'Madrid', true  FROM _ids
UNION ALL SELECT b3, 'TEST W1A1 B3', 'Madrid', true  FROM _ids
UNION ALL SELECT b4, 'TEST W1A1 B4', 'Madrid', false FROM _ids
UNION ALL SELECT b5, 'TEST W1A1 B5', 'Madrid', false FROM _ids
UNION ALL SELECT b6, 'TEST W1A1 B6', 'Madrid', false FROM _ids
UNION ALL SELECT b7, 'TEST W1A1 B7', 'Madrid', false FROM _ids;

INSERT INTO public.owners (id, nombre, metadatos)
SELECT o_ana,  'ANA GARCIA SOTO', '{"dni__nif__cif":"12345678Z"}'::jsonb FROM _ids
UNION ALL
SELECT o_juan, 'JUAN PEREZ LOPEZ', '{"dni__nif__cif":"87654321X"}'::jsonb FROM _ids;

INSERT INTO public.companies (id, nombre)
SELECT c_soc, 'PATRIMONIAL TEST SL' FROM _ids;

-- Notas -----------------------------------------------------------------
-- N1: B1, pleno 100% de ANA, con cita completa en raw_pdf_text ("100 %").
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json, created_at)
VALUES ('44444444-0000-0000-0000-000000000001',
        (SELECT b1 FROM _ids), 'listo',
        'Finca urbana. El pleno dominio de la totalidad, 100 %, pertenece a ANA GARCIA SOTO por título de compraventa.',
        '{}'::jsonb, now());

-- N1b: copia IDÉNTICA de N1 procesada OTRO DÍA (no debe ser contradicción).
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json, processed_at, created_at)
VALUES ('44444444-0000-0000-0000-00000000001b',
        (SELECT b6 FROM _ids), 'listo',
        'Finca urbana. El pleno dominio de la totalidad, 100 %, pertenece a ANA GARCIA SOTO por título de compraventa.',
        '{}'::jsonb, now() - interval '30 days', now() - interval '30 days');
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json, processed_at, created_at)
VALUES ('44444444-0000-0000-0000-00000000001c',
        (SELECT b6 FROM _ids), 'listo',
        'Finca urbana. El pleno dominio de la totalidad, 100 %, pertenece a ANA GARCIA SOTO por título de compraventa.',
        '{}'::jsonb, now(), now());

-- N2: B2 (DH) con finca registral fiable · capas pleno/nuda/usufructo/ganancial/otro
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000002',
        (SELECT b2 FROM _ids), 'listo',
        'La nuda propiedad del 50,00 % corresponde a JUAN PEREZ LOPEZ. El usufructo del 50 % corresponde a ANA GARCIA SOTO.',
        '{"finca_registral":"12.345","fecha_nota":"2026-01-15"}'::jsonb);

-- N3: B3 (DH) SIN clave fiable
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000003',
        (SELECT b3 FROM _ids), 'listo', 'Sin datos de finca.', '{}'::jsonb);

-- N4a/N4b: B4, mismos titulares con 60/40 y 50/50 → contradicción
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000004a', (SELECT b4 FROM _ids), 'listo',
        'Pleno dominio: ANA GARCIA SOTO 60 %, JUAN PEREZ LOPEZ 40 %.', '{"fecha_nota":"2026-02-01"}'::jsonb),
       ('44444444-0000-0000-0000-00000000004b', (SELECT b4 FROM _ids), 'listo',
        'Pleno dominio: ANA GARCIA SOTO 50 %, JUAN PEREZ LOPEZ 50 %.', '{"fecha_nota":"2026-02-01"}'::jsonb);

-- N5: B5, capa de pleno dominio que suma 90 → bloqueada
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000005', (SELECT b5 FROM _ids), 'listo',
        'Pleno dominio: ANA GARCIA SOTO 90 %.', '{}'::jsonb);

-- Notas auxiliares para p0_nota_unit_key (sin titulares: no entran en staging)
-- Ne: idufir vacío/espacios + referencia catastral válida posterior (B2, DH)
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000000e', (SELECT b2 FROM _ids), 'listo', '',
        '{"idufir":"   ","finca_registral":"","referencia_catastral":"9872023 VH5797S 0001 WX"}'::jsonb);
-- Nf: clave que normaliza a cadena vacía
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000000f', (SELECT b2 FROM _ids), 'listo', '',
        '{"finca_registral":"--/--"}'::jsonb);
-- N10: mismo valor 12345 pero como IDUFIR (no debe colisionar con finca 12.345)
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000010', (SELECT b2 FROM _ids), 'listo', '',
        '{"idufir":"12345"}'::jsonb);

-- Titulares --------------------------------------------------------------
-- CASO A · pleno 100 con DNI exacto, evidencia en rol_literal + raw (apta) → feeds_cuota
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000000a', '44444444-0000-0000-0000-000000000001',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio');

-- CASO B · no-match en CRM (persona inexistente)
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000000b', '44444444-0000-0000-0000-000000000005',
        'PERSONA INEXISTENTE UNO', NULL, 10, 'pleno', 'pleno dominio');

-- CASO C · capa 90: ANA con 90 en el mismo edificio B5 (capa no cierra)
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000000c', '44444444-0000-0000-0000-000000000005',
        'ANA GARCIA SOTO', '12345678Z', 90, 'pleno', 'pleno dominio');

-- CASO D/E · nuda y usufructo (B2)
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000000d', '44444444-0000-0000-0000-000000000002',
        'JUAN PEREZ LOPEZ', '87654321X', 50, 'nuda_propiedad', 'nuda propiedad'),
       ('55555555-0000-0000-0000-00000000000e', '44444444-0000-0000-0000-000000000002',
        'ANA GARCIA SOTO', '12345678Z', 50, 'usufructo', 'usufructo vitalicio');

-- CASO F · ganancial y CASO G · rol desconocido (B3)
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000000f', '44444444-0000-0000-0000-000000000003',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'ganancial', 'con carácter ganancial'),
       ('55555555-0000-0000-0000-000000000017', '44444444-0000-0000-0000-000000000003',
        'ANA GARCIA SOTO', '12345678Z', 100, 'otro', 'titular');

-- CASO H · evidencia con DERECHO EQUIVOCADO (dice usufructo, la fila es pleno)
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, evidencia)
VALUES ('55555555-0000-0000-0000-000000000010', '44444444-0000-0000-0000-00000000004a',
        'ANA GARCIA SOTO', '12345678Z', 60, 'pleno', 'pleno dominio',
        '{"cita":"El usufructo del 60 % corresponde a ANA GARCIA SOTO"}'::jsonb);

-- CASO I · evidencia con PORCENTAJE EQUIVOCADO
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, evidencia)
VALUES ('55555555-0000-0000-0000-000000000011', '44444444-0000-0000-0000-00000000004a',
        'JUAN PEREZ LOPEZ', '87654321X', 40, 'pleno', 'pleno dominio',
        '{"cita":"El pleno dominio del 45 % corresponde a JUAN PEREZ LOPEZ"}'::jsonb);

-- N4b: mismos titulares al 50/50
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000012', '44444444-0000-0000-0000-00000000004b',
        'ANA GARCIA SOTO', '12345678Z', 50, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000013', '44444444-0000-0000-0000-00000000004b',
        'JUAN PEREZ LOPEZ', '87654321X', 50, 'pleno', 'pleno dominio');

-- CASO J · duplicado idéntico procesado otro día (B6)
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000014', '44444444-0000-0000-0000-00000000001b',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000015', '44444444-0000-0000-0000-00000000001c',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio');

-- CASO K · conflicto: owner_id Y company_id informados a la vez
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, owner_id, company_id)
SELECT '55555555-0000-0000-0000-000000000016', '44444444-0000-0000-0000-000000000002',
       'PATRIMONIAL TEST SL', 'B12345678', 100, 'pleno', 'pleno dominio', o_ana, c_soc FROM _ids;

-- CASO L · nombre "de persona" pero con company_id ya informado → es_sociedad
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, company_id)
SELECT '55555555-0000-0000-0000-000000000018', '44444444-0000-0000-0000-000000000005',
       'HERMANOS MARTINEZ', NULL, 5, 'pleno', 'pleno dominio', c_soc FROM _ids;

-- CASOS M · negativos de structured_json (B7, sin DH, sin evidencia de titular,
-- raw vacío: el único camino posible sería el fallback structured_json).
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000007', (SELECT b7 FROM _ids), 'listo', '',
        '{"fecha_nota":"2026-03-01","titulares":[
           {"nombre":"ANA GARCIA SOTO","derecho":"usufructo","porcentaje":"50","cita":"El usufructo del 50 % de ANA GARCIA SOTO"},
           {"nombre":"JUAN PEREZ LOPEZ","derecho":"pleno dominio","porcentaje":"45","cita":"El pleno dominio del 45 % de JUAN PEREZ LOPEZ"},
           {"nombre":"MARIA LOPEZ RUIZ","derecho":"pleno dominio","porcentaje":"25","cita":"   ","pagina":"  ","ruta":""},
           {"nombre":"PEDRO SANZ GIL","derecho":"pleno dominio","porcentaje":"cincuenta por ciento","cita":"El pleno dominio de PEDRO SANZ GIL"}
         ]}'::jsonb);

INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES
  -- M1 · el structured_json declara OTRO derecho (usufructo) para una fila pleno
  ('55555555-0000-0000-0000-000000000019', '44444444-0000-0000-0000-000000000007',
   'ANA GARCIA SOTO', '12345678Z', 50, 'pleno', 'pleno dominio'),
  -- M2 · el structured_json declara OTRO porcentaje (45 vs 40)
  ('55555555-0000-0000-0000-00000000001a', '44444444-0000-0000-0000-000000000007',
   'JUAN PEREZ LOPEZ', '87654321X', 40, 'pleno', 'pleno dominio'),
  -- M3 · coincide todo pero el localizador está vacío (no hay trazabilidad)
  ('55555555-0000-0000-0000-00000000001b', '44444444-0000-0000-0000-000000000007',
   'MARIA LOPEZ RUIZ', NULL, 25, 'pleno', 'pleno dominio'),
  -- M4 · porcentaje textual NO numérico: no debe abortar el dry-run
  ('55555555-0000-0000-0000-00000000001c', '44444444-0000-0000-0000-000000000007',
   'PEDRO SANZ GIL', NULL, 25, 'pleno', 'pleno dominio');

-- ---------------------------------------------------------------------
-- 2) Aserciones
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _s AS SELECT * FROM public.v_p0_rights_staging;

DO $$
DECLARE v record; v_n int; v_dry jsonb; v_dry2 jsonb;
BEGIN
  -- Paridad 1:1
  SELECT count(*) INTO v_n
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  WHERE ns.building_id IS NOT NULL;
  PERFORM pg_temp.assert((SELECT count(*) FROM _s) = v_n, 'staged_rows debe igualar los titulares con building_id');
  PERFORM pg_temp.assert((SELECT count(DISTINCT titular_id) FROM _s) = (SELECT count(*) FROM _s),
                         'titular_id debe ser único en staging');

  -- A · pleno 100 con DNI exacto y cita "100 %" → alimenta cuota
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000a';
  PERFORM pg_temp.assert(v.right_type = 'pleno_dominio', 'A: right_type pleno_dominio');
  PERFORM pg_temp.assert(v.evidence_ok, 'A: evidencia triple apta con 100 % en la misma cita');
  PERFORM pg_temp.assert(v.layer_complete, 'A: la capa de pleno cierra al 100');
  PERFORM pg_temp.assert(v.feeds_cuota, 'A: debe alimentar cuota');

  -- B · no-match: sin owner ni company, en revisión y sin cuota
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000b';
  PERFORM pg_temp.assert(v.owner_id IS NULL AND v.company_id IS NULL, 'B: sin conciliar');
  PERFORM pg_temp.assert(v.review_flag AND NOT v.feeds_cuota, 'B: revisión y sin cuota');
  PERFORM pg_temp.assert(v.review_reason ILIKE '%sin conciliar%', 'B: motivo explícito');

  -- C · capa de pleno que suma 90 → bloqueada
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000c';
  PERFORM pg_temp.assert(NOT v.layer_complete, 'C: capa 90 no cierra');
  PERFORM pg_temp.assert(NOT v.feeds_cuota, 'C: capa incompleta no alimenta cuota');
  PERFORM pg_temp.assert(v.review_reason ILIKE '%capa de pleno dominio no cierra al 100%%',
                         'C: motivo de capa incompleta');

  -- D/E · nuda y usufructo nunca alimentan cuota
  PERFORM pg_temp.assert((SELECT right_type FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000d')
                         = 'nuda_propiedad', 'D: nuda_propiedad');
  PERFORM pg_temp.assert((SELECT right_type FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000e')
                         = 'usufructo', 'E: usufructo');
  PERFORM pg_temp.assert((SELECT bool_or(feeds_cuota) FROM _s
                          WHERE right_type IN ('nuda_propiedad','usufructo','ganancial','otro')) IS NOT TRUE,
                         'D/E/F/G: ningún derecho no pleno alimenta cuota');

  -- F · ganancial en capa separada · G · desconocido = otro
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000f';
  PERFORM pg_temp.assert(v.right_type = 'ganancial' AND v.coownership_regime IS NOT NULL, 'F: ganancial');
  PERFORM pg_temp.assert((SELECT right_type FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000017')
                         = 'otro', 'G: rol desconocido nunca es pleno dominio');

  -- H · evidencia con derecho equivocado
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000010';
  PERFORM pg_temp.assert(NOT v.evidence_ok, 'H: derecho equivocado invalida la evidencia');
  PERFORM pg_temp.assert((v.evidence_ref ->> 'derecho_ok')::boolean IS FALSE, 'H: derecho_ok=false');
  -- el raw_pdf_text de la nota SÍ contiene el dato correcto: no debe rescatar
  PERFORM pg_temp.assert(v.evidence_ref ->> 'fuente' = 'titular.evidencia',
                         'H: la evidencia principal contradictoria no se rescata con raw_pdf_text');

  -- I · evidencia con porcentaje equivocado
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000011';
  PERFORM pg_temp.assert(NOT v.evidence_ok, 'I: porcentaje equivocado invalida la evidencia');
  PERFORM pg_temp.assert((v.evidence_ref ->> 'porcentaje_ok')::boolean IS FALSE, 'I: porcentaje_ok=false');
  PERFORM pg_temp.assert(v.evidence_ref ->> 'fuente' = 'titular.evidencia',
                         'I: la evidencia principal contradictoria no se rescata con raw_pdf_text');

  -- M · negativos de structured_json (fallback legítimo, pero no debe aprobar)
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000019';
  PERFORM pg_temp.assert(NOT v.evidence_ok, 'M1: derecho distinto en structured_json no vale');
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000001a';
  PERFORM pg_temp.assert(NOT v.evidence_ok, 'M2: porcentaje distinto en structured_json no vale');
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000001b';
  PERFORM pg_temp.assert(NOT v.evidence_ok, 'M3: localizador vacío no es trazabilidad');
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000001c';
  PERFORM pg_temp.assert(NOT v.evidence_ok, 'M4: porcentaje textual no numérico no vale');
  PERFORM pg_temp.assert((SELECT bool_or(feeds_cuota) FROM _s
                          WHERE building_id = (SELECT b7 FROM _ids)) IS NOT TRUE,
                         'M: ninguna fila de B7 alimenta cuota');

  -- p0_parse_pct: seguro y tolerante, nunca lanza cast
  PERFORM pg_temp.assert(public.p0_parse_pct('50,00 %') = 50, 'parse_pct: coma y %');
  PERFORM pg_temp.assert(public.p0_parse_pct(' 45.5 ') = 45.5, 'parse_pct: punto y espacios');
  PERFORM pg_temp.assert(public.p0_parse_pct('cincuenta por ciento') IS NULL, 'parse_pct: texto no numérico → NULL');
  PERFORM pg_temp.assert(public.p0_parse_pct(NULL) IS NULL, 'parse_pct: NULL → NULL');

  -- 100 con coma y con punto deben reconocerse igual
  PERFORM pg_temp.assert('El pleno dominio del 100,00 % de ANA' ~ public.p0_pct_regex(100), 'pct: coma');
  PERFORM pg_temp.assert('El pleno dominio del 100.00 % de ANA' ~ public.p0_pct_regex(100), 'pct: punto');
  PERFORM pg_temp.assert('El pleno dominio del 100 por ciento'  ~ public.p0_pct_regex(100), 'pct: literal');
  PERFORM pg_temp.assert(NOT ('cuota del 45 %' ~ public.p0_pct_regex(40)), 'pct: 45 no es 40');

  -- J · duplicado idéntico procesado otro día: misma firma, una sola canónica
  PERFORM pg_temp.assert(
    public.p0_nota_signature('44444444-0000-0000-0000-00000000001b')
    = public.p0_nota_signature('44444444-0000-0000-0000-00000000001c'),
    'J: copias idénticas procesadas en fechas distintas comparten firma');
  PERFORM pg_temp.assert(
    (SELECT count(DISTINCT note_simple_id) FROM _s
     WHERE ownership_unit_key = 'building:' || (SELECT b6 FROM _ids)::text AND is_canonical) = 1,
    'J: una sola nota canónica por unidad');
  PERFORM pg_temp.assert(
    (SELECT coalesce(sum(percentage) FILTER (WHERE feeds_cuota), 0) FROM _s
     WHERE ownership_unit_key = 'building:' || (SELECT b6 FROM _ids)::text) <= 100,
    'J: dos notas idénticas no pueden sumar 200%');

  -- 60/40 vs 50/50 · firmas distintas y unidad contradictoria sin cuota
  PERFORM pg_temp.assert(
    public.p0_nota_signature('44444444-0000-0000-0000-00000000004a')
    <> public.p0_nota_signature('44444444-0000-0000-0000-00000000004b'),
    '60/40 y 50/50 deben dar firmas distintas');
  PERFORM pg_temp.assert(
    (SELECT bool_or(feeds_cuota) FROM _s
     WHERE ownership_unit_key = 'building:' || (SELECT b4 FROM _ids)::text) IS NOT TRUE,
    'unidad contradictoria no alimenta cuota');

  -- DH con clave fiable / sin clave fiable
  PERFORM pg_temp.assert(
    public.p0_nota_unit_key('44444444-0000-0000-0000-000000000002')
    = 'dh:' || (SELECT b2 FROM _ids)::text || ':finca:12345', 'DH con clave fiable y namespace de fuente');
  PERFORM pg_temp.assert(public.p0_nota_unit_key('44444444-0000-0000-0000-000000000003') IS NULL,
                         'DH sin clave fiable devuelve NULL');
  -- candidato vacío anterior no puede ocultar una clave válida posterior
  PERFORM pg_temp.assert(
    public.p0_nota_unit_key('44444444-0000-0000-0000-00000000000e')
    = 'dh:' || (SELECT b2 FROM _ids)::text || ':refcat:9872023VH5797S0001WX',
    'idufir vacío no oculta la referencia catastral posterior');
  -- normalización que queda vacía = sin clave fiable
  PERFORM pg_temp.assert(public.p0_nota_unit_key('44444444-0000-0000-0000-00000000000f') IS NULL,
                         'clave con solo signos normaliza a vacío: sin unidad fiable');
  -- mismo valor con fuentes distintas NO colisiona
  PERFORM pg_temp.assert(
    public.p0_nota_unit_key('44444444-0000-0000-0000-000000000002')
    <> public.p0_nota_unit_key('44444444-0000-0000-0000-000000000010'),
    'idufir 12345 y finca 12345 no pueden colisionar');
  PERFORM pg_temp.assert(
    (SELECT bool_and(unit_block_reason = 'dh_sin_unidad_registral' AND NOT feeds_cuota)
     FROM _s WHERE building_id = (SELECT b3 FROM _ids)),
    'DH sin clave: bloqueado y sin cuota');

  -- K · conflicto owner_id + company_id: se conservan ambos en auditoría, bloqueado
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000016';
  PERFORM pg_temp.assert(v.conflicto_ids, 'K: conflicto detectado');
  PERFORM pg_temp.assert(v.owner_id IS NULL AND v.company_id IS NULL,
                         'K: la salida operativa deja owner_id y company_id en NULL');
  PERFORM pg_temp.assert(NOT v.feeds_cuota AND v.review_flag, 'K: bloqueado sin cuota');
  PERFORM pg_temp.assert((v.audit_ids ->> 'pre_owner_id') IS NOT NULL
                         AND (v.audit_ids ->> 'pre_company_id') IS NOT NULL,
                         'K: ambos IDs originales conservados en auditoría');
  -- ninguna fila puede salir con ambos IDs reales
  PERFORM pg_temp.assert((SELECT count(*) FROM _s WHERE owner_id IS NOT NULL AND company_id IS NOT NULL) = 0,
                         'ninguna fila operativa con owner_id y company_id a la vez');

  -- L · company_id preexistente fuerza es_sociedad y conserva el vínculo
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000018';
  PERFORM pg_temp.assert(v.es_sociedad, 'L: company_id informado implica es_sociedad');
  PERFORM pg_temp.assert(v.company_id = (SELECT c_soc FROM _ids) AND v.owner_id IS NULL,
                         'L: se conserva el company_id preexistente');
  PERFORM pg_temp.assert(NOT v.feeds_cuota, 'L: sociedad nunca alimenta cuota personal');

  -- Vínculo preexistente sin DNI inequívoco: se conserva pero no alimenta cuota
  PERFORM pg_temp.assert(
    (SELECT bool_or(feeds_cuota) FROM _s WHERE identity_match IN
       ('owner_preexistente','nombre_exacto','nombre_sociedad_revisable','ambiguo','conflicto_owner_y_company'))
    IS NOT TRUE,
    'solo el DNI exacto e inequívoco puede alimentar cuota personal');

  -- Dry-run idempotente y sin escrituras
  v_dry  := public.p0_property_rights_dry_run();
  v_dry2 := public.p0_property_rights_dry_run();
  PERFORM pg_temp.assert(v_dry = v_dry2, 'dry-run idempotente');
  PERFORM pg_temp.assert((v_dry ->> 'bad_capa_incompleta_feeds')::int = 0, 'ninguna capa incompleta alimenta cuota');
  PERFORM pg_temp.assert((v_dry ->> 'capas_incompletas')::int >= 1, 'debe detectar al menos una capa incompleta');
  PERFORM pg_temp.assert((v_dry ->> 'capas_completas')::int >= 1, 'debe detectar al menos una capa completa');
  PERFORM pg_temp.assert((v_dry ->> 'contradicciones')::int >= 1, 'debe detectar la contradicción 60/40 vs 50/50');
  PERFORM pg_temp.assert((v_dry ->> 'duplicados_identicos')::int >= 1, 'debe detectar el duplicado idéntico');
  PERFORM pg_temp.assert((v_dry ->> 'mezcla_owner_company')::int = 0, 'mezcla_owner_company debe ser 0');
  PERFORM pg_temp.assert((v_dry -> 'invariants' ->> 'sin_mezcla_owner_company')::boolean,
                         'invariante sin_mezcla_owner_company debe ser true');
  PERFORM pg_temp.assert((v_dry ->> 'invariants_ok')::boolean, 'invariants_ok debe ser true');

  -- Rebuild real deshabilitado
  BEGIN
    PERFORM public.p0_rebuild_property_rights('test', true);
    PERFORM pg_temp.assert(false, 'p_apply=true debería lanzar REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL%',
                           'excepción esperada de rebuild deshabilitado, recibida: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------
-- 3) Checksums DESPUÉS: nada debe haber cambiado en las tablas consumidoras
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _after AS
SELECT 'building_property_rights' AS t, count(*) AS n,
       coalesce(md5(string_agg(md5(x::text), '|' ORDER BY md5(x::text))), '') AS ck
FROM public.building_property_rights x
UNION ALL SELECT 'building_owners', count(*),
       coalesce(md5(string_agg(md5(y::text), '|' ORDER BY md5(y::text))), '') FROM public.building_owners y
UNION ALL SELECT 'building_tasks', count(*),
       coalesce(md5(string_agg(md5(w::text), '|' ORDER BY md5(w::text))), '') FROM public.building_tasks w;

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT b.t, b.n AS n1, a.n AS n2, b.ck AS ck1, a.ck AS ck2
           FROM _before b JOIN _after a ON a.t = b.t LOOP
    PERFORM pg_temp.assert(r.n1 = r.n2 AND r.ck1 = r.ck2,
      format('la tabla %s cambió durante el dry-run (%s->%s)', r.t, r.n1, r.n2));
  END LOOP;
  -- buildings sí cambia: el test inserta 6 edificios sintéticos (se revierten con ROLLBACK)
  PERFORM pg_temp.assert(
    (SELECT n FROM _before WHERE t = 'buildings') + 6 = (SELECT count(*) FROM public.buildings),
    'buildings solo debe variar por los fixtures del test');
  RAISE NOTICE 'WAVE 1A.1 · TODAS LAS ASERCIONES OK (se revierte todo)';
END $$;

ROLLBACK;