-- =====================================================================
-- WAVE 1A.2 · Test SQL EJECUTABLE **SOLO EN RAMA EFÍMERA / DE TEST**
-- (aún NO ejecutado en ningún entorno)
--
-- Todo ocurre dentro de una transacción que termina en ROLLBACK y todos
-- los fixtures están aislados por nota/edificio sintético.
--
-- Uso previsto (SOLO base desechable creada por el runner 1A.3):
--   bash supabase/tests/wave1a3_integration_runner.sh
-- El runner crea wave1a_test_<sufijo> en un Postgres loopback, aplica la
-- cadena de checkout y destruye la base al terminar.
--
-- El script ABORTA al inicio si no está marcado el entorno efímero.
-- No hay checksums ni string_agg de tablas completas.
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0) GUARDA DE ENTORNO: aborta salvo rama efímera/test declarada
-- ---------------------------------------------------------------------
DO $$
BEGIN
  -- Wave 1A.3: la guarda ya NO depende de un GUC falsificable. La única
  -- condición admitida es estar en la base desechable que crea
  -- supabase/tests/wave1a3_integration_runner.sh.
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION
      'ABORT: este script con fixtures solo puede ejecutarse en la base desechable wave1a_test_* creada por wave1a3_integration_runner.sh. Base actual: %.',
      current_database();
  END IF;
END $$;

-- Helper de aserción local a la transacción.
CREATE OR REPLACE FUNCTION pg_temp.assert(p_cond boolean, p_msg text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'ASSERT FAILED: %', p_msg;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1) Recuentos ANTES (solo COUNT: sin checksums de tablas completas)
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _before AS
SELECT 'building_property_rights'::text AS t, count(*) AS n FROM public.building_property_rights
UNION ALL SELECT 'building_owners', count(*) FROM public.building_owners
UNION ALL SELECT 'building_tasks',  count(*) FROM public.building_tasks
UNION ALL SELECT 'buildings',       count(*) FROM public.buildings;

-- ---------------------------------------------------------------------
-- 2) Fixtures sintéticos, aislados por edificio/nota (anonimizados)
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _ids AS
SELECT
  '11111111-1111-1111-1111-000000000001'::uuid AS b1,   -- pleno 100 apto
  '11111111-1111-1111-1111-000000000002'::uuid AS b2,   -- DH con clave fiable
  '11111111-1111-1111-1111-000000000003'::uuid AS b3,   -- DH sin clave fiable
  '11111111-1111-1111-1111-000000000004'::uuid AS b4,   -- misma fecha, firmas distintas
  '11111111-1111-1111-1111-000000000005'::uuid AS b5,   -- capa 90 exacta
  '11111111-1111-1111-1111-000000000006'::uuid AS b6,   -- duplicado idéntico
  '11111111-1111-1111-1111-000000000007'::uuid AS b7,   -- negativos structured_json
  '11111111-1111-1111-1111-000000000008'::uuid AS b8,   -- conflicto rol vs literal
  '11111111-1111-1111-1111-000000000009'::uuid AS b9,   -- pleno+ganancial y solo ganancial
  '11111111-1111-1111-1111-000000000010'::uuid AS b10,  -- ISO posterior supersede
  '11111111-1111-1111-1111-000000000011'::uuid AS b11,  -- DD/MM/YYYY posterior supersede
  '11111111-1111-1111-1111-000000000012'::uuid AS b12,  -- nuda100 + usufructo100
  '11111111-1111-1111-1111-000000000013'::uuid AS b13,  -- DH con dos unidades
  '11111111-1111-1111-1111-000000000014'::uuid AS b14,  -- cita con varios titulares
  '11111111-1111-1111-1111-000000000015'::uuid AS b15,  -- número de finca como falso %
  '11111111-1111-1111-1111-000000000016'::uuid AS b16,  -- nota NO 'listo'
  '11111111-1111-1111-1111-000000000017'::uuid AS b17,  -- sociedad
  '22222222-2222-2222-2222-000000000001'::uuid AS o_ana,
  '22222222-2222-2222-2222-000000000002'::uuid AS o_juan,
  '22222222-2222-2222-2222-000000000003'::uuid AS o_maria,
  '22222222-2222-2222-2222-000000000004'::uuid AS o_bruno,
  '33333333-3333-3333-3333-000000000001'::uuid AS c_soc;

INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal)
SELECT b1,  'TEST W1A2 B1',  'Madrid', false FROM _ids
UNION ALL SELECT b2,  'TEST W1A2 B2',  'Madrid', true  FROM _ids
UNION ALL SELECT b3,  'TEST W1A2 B3',  'Madrid', true  FROM _ids
UNION ALL SELECT b4,  'TEST W1A2 B4',  'Madrid', false FROM _ids
UNION ALL SELECT b5,  'TEST W1A2 B5',  'Madrid', false FROM _ids
UNION ALL SELECT b6,  'TEST W1A2 B6',  'Madrid', false FROM _ids
UNION ALL SELECT b7,  'TEST W1A2 B7',  'Madrid', false FROM _ids
UNION ALL SELECT b8,  'TEST W1A2 B8',  'Madrid', false FROM _ids
UNION ALL SELECT b9,  'TEST W1A2 B9',  'Madrid', false FROM _ids
UNION ALL SELECT b10, 'TEST W1A2 B10', 'Madrid', false FROM _ids
UNION ALL SELECT b11, 'TEST W1A2 B11', 'Madrid', false FROM _ids
UNION ALL SELECT b12, 'TEST W1A2 B12', 'Madrid', false FROM _ids
UNION ALL SELECT b13, 'TEST W1A2 B13', 'Madrid', true  FROM _ids
UNION ALL SELECT b14, 'TEST W1A2 B14', 'Madrid', false FROM _ids
UNION ALL SELECT b15, 'TEST W1A2 B15', 'Madrid', false FROM _ids
UNION ALL SELECT b16, 'TEST W1A2 B16', 'Madrid', false FROM _ids
UNION ALL SELECT b17, 'TEST W1A2 B17', 'Madrid', false FROM _ids;

INSERT INTO public.owners (id, nombre, metadatos)
SELECT o_ana,   'ANA GARCIA SOTO',   '{"dni__nif__cif":"12345678Z"}'::jsonb FROM _ids
UNION ALL SELECT o_juan,  'JUAN PEREZ LOPEZ',  '{"dni__nif__cif":"87654321X"}'::jsonb FROM _ids
UNION ALL SELECT o_maria, 'MARIA PEDRAZA RUIZ','{"dni__nif__cif":"11223344B"}'::jsonb FROM _ids
UNION ALL SELECT o_bruno, 'BRUNO AYLLON DIAZ', '{"dni__nif__cif":"55667788K"}'::jsonb FROM _ids;

INSERT INTO public.companies (id, nombre)
SELECT c_soc, 'PATRIMONIAL TEST SL' FROM _ids;

-- ---- B1 · pleno 100 % con cita real en raw (única vía apta) --------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000001', (SELECT b1 FROM _ids), 'listo',
        'El pleno dominio de la totalidad, 100 %, pertenece a ANA GARCIA SOTO por titulo de compraventa.',
        '{"fecha_nota":"2026-01-15"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio');

-- ---- B2 · DH con finca fiable: nuda + usufructo -------------------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000002', (SELECT b2 FROM _ids), 'listo',
        'La nuda propiedad del 50,00 % corresponde a JUAN PEREZ LOPEZ. El usufructo del 50 % corresponde a ANA GARCIA SOTO.',
        '{"finca_registral":"12.345","fecha_nota":"2026-01-15"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000002', '44444444-0000-0000-0000-000000000002',
        'JUAN PEREZ LOPEZ', '87654321X', 50, 'nuda_propiedad', 'nuda propiedad'),
       ('55555555-0000-0000-0000-000000000003', '44444444-0000-0000-0000-000000000002',
        'ANA GARCIA SOTO', '12345678Z', 50, 'usufructo', 'usufructo vitalicio');

-- Notas auxiliares de p0_nota_unit_key (sin titulares: no entran en staging)
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000000e', (SELECT b2 FROM _ids), 'listo', '',
        '{"idufir":"   ","finca_registral":"","referencia_catastral":"9872023 VH5797S 0001 WX"}'::jsonb),
       ('44444444-0000-0000-0000-00000000000f', (SELECT b2 FROM _ids), 'listo', '',
        '{"finca_registral":"--/--"}'::jsonb),
       ('44444444-0000-0000-0000-000000000020', (SELECT b2 FROM _ids), 'listo', '',
        '{"idufir":"12345"}'::jsonb);

-- ---- B3 · DH sin clave fiable ------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000003', (SELECT b3 FROM _ids), 'listo',
        'Sin datos de finca. El pleno dominio del 100 % corresponde a JUAN PEREZ LOPEZ.', '{}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000004', '44444444-0000-0000-0000-000000000003',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'pleno', 'pleno dominio');

-- ---- B4 · MISMA fecha, firmas distintas => contradicción y bloqueo ------
--       (Maria Pedraza17 y Bruno Ayllon10: conflicto sin cronología fiable)
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000004a', (SELECT b4 FROM _ids), 'listo',
        'Pleno dominio: el 60 % corresponde a MARIA PEDRAZA RUIZ. El 40 % corresponde a BRUNO AYLLON DIAZ.',
        '{"fecha_nota":"2026-02-01"}'::jsonb),
       ('44444444-0000-0000-0000-00000000004b', (SELECT b4 FROM _ids), 'listo',
        'Pleno dominio: el 50 % corresponde a MARIA PEDRAZA RUIZ. El 50 % corresponde a BRUNO AYLLON DIAZ.',
        '{"fecha_nota":"2026-02-01"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000005', '44444444-0000-0000-0000-00000000004a',
        'MARIA PEDRAZA RUIZ', '11223344B', 60, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000006', '44444444-0000-0000-0000-00000000004a',
        'BRUNO AYLLON DIAZ', '55667788K', 40, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000007', '44444444-0000-0000-0000-00000000004b',
        'MARIA PEDRAZA RUIZ', '11223344B', 50, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000008', '44444444-0000-0000-0000-00000000004b',
        'BRUNO AYLLON DIAZ', '55667788K', 50, 'pleno', 'pleno dominio');

-- ---- B5 · capa de pleno que suma EXACTAMENTE 90 -------------------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000005', (SELECT b5 FROM _ids), 'listo',
        'El pleno dominio del 90 % corresponde a ANA GARCIA SOTO.', '{"fecha_nota":"2026-01-10"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000009', '44444444-0000-0000-0000-000000000005',
        'ANA GARCIA SOTO', '12345678Z', 90, 'pleno', 'pleno dominio');

-- ---- B6 · duplicado idéntico procesado otro día -------------------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json, processed_at, created_at)
VALUES ('44444444-0000-0000-0000-00000000006a', (SELECT b6 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a ANA GARCIA SOTO.', '{"fecha_nota":"2026-01-05"}'::jsonb,
        now() - interval '30 days', now() - interval '30 days'),
       ('44444444-0000-0000-0000-00000000006b', (SELECT b6 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a ANA GARCIA SOTO.', '{"fecha_nota":"2026-01-05"}'::jsonb,
        now(), now());
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000000a', '44444444-0000-0000-0000-00000000006a',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-00000000000b', '44444444-0000-0000-0000-00000000006b',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio');

-- ---- B7 · negativos de structured_json ---------------------------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000007', (SELECT b7 FROM _ids), 'listo', '',
        '{"fecha_nota":"2026-03-01","titulares":[
           {"nombre":"ANA GARCIA SOTO","derecho":"usufructo","porcentaje":"50","cita":"El usufructo del 50 % de ANA GARCIA SOTO","pagina":"3"},
           {"nombre":"JUAN PEREZ LOPEZ","derecho":"pleno dominio","porcentaje":"45","cita":"El pleno dominio del 45 % de JUAN PEREZ LOPEZ","pagina":"3"},
           {"nombre":"MARIA PEDRAZA RUIZ","derecho":"pleno dominio","porcentaje":"25","cita":"   ","pagina":"  ","ruta":""},
           {"nombre":"BRUNO AYLLON DIAZ","derecho":"pleno dominio","porcentaje":"cincuenta por ciento","cita":"El pleno dominio de BRUNO AYLLON DIAZ","pagina":"4"}
         ]}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES
  ('55555555-0000-0000-0000-00000000000c', '44444444-0000-0000-0000-000000000007',
   'ANA GARCIA SOTO', '12345678Z', 50, 'pleno', 'pleno dominio'),          -- derecho distinto
  ('55555555-0000-0000-0000-00000000000d', '44444444-0000-0000-0000-000000000007',
   'JUAN PEREZ LOPEZ', '87654321X', 40, 'pleno', 'pleno dominio'),         -- porcentaje distinto
  ('55555555-0000-0000-0000-00000000000e', '44444444-0000-0000-0000-000000000007',
   'MARIA PEDRAZA RUIZ', '11223344B', 25, 'pleno', 'pleno dominio'),       -- localizador vacío
  ('55555555-0000-0000-0000-00000000000f', '44444444-0000-0000-0000-000000000007',
   'BRUNO AYLLON DIAZ', '55667788K', 25, 'pleno', 'pleno dominio');        -- porcentaje no numérico

-- ---- B8 · CONFLICTO rol (pleno) vs rol_literal (usufructo) --------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000008', (SELECT b8 FROM _ids), 'listo',
        'El usufructo del 100 % corresponde a JUAN PEREZ LOPEZ.', '{"fecha_nota":"2026-01-20"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000010', '44444444-0000-0000-0000-000000000008',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'pleno', 'usufructo vitalicio'),
       -- literal con DOS derechos: nunca se resuelve por el orden de palabras
       ('55555555-0000-0000-0000-000000000011', '44444444-0000-0000-0000-000000000008',
        -- rol crudo genérico ('otro'): el esquema real usa el enum
        -- nota_titular_rol y no admite NULL ni cadena vacía.
        'ANA GARCIA SOTO', '12345678Z', 100, 'otro', 'nuda propiedad y usufructo');

-- ---- B9 · Palencia3: pleno + ganancial separados; y solo ganancial ------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000009', (SELECT b9 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a JUAN PEREZ LOPEZ con caracter ganancial.',
        '{"fecha_nota":"15/01/2026"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000012', '44444444-0000-0000-0000-000000000009',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'pleno', 'pleno dominio con caracter ganancial'),
       ('55555555-0000-0000-0000-000000000013', '44444444-0000-0000-0000-000000000009',
        'ANA GARCIA SOTO', '12345678Z', 100, 'ganancial', 'con caracter ganancial');

-- ---- B10 · Sorgo25: nota ISO posterior supersede la anterior ------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000010a', (SELECT b10 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a ANA GARCIA SOTO.', '{"fecha_nota":"2025-01-01"}'::jsonb),
       ('44444444-0000-0000-0000-00000000010b', (SELECT b10 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a JUAN PEREZ LOPEZ.', '{"fecha_nota":"2026-01-01"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000014', '44444444-0000-0000-0000-00000000010a',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000015', '44444444-0000-0000-0000-00000000010b',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'pleno', 'plena propiedad');

-- ---- B11 · fecha DD/MM/YYYY posterior supersede a ISO anterior ----------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000011a', (SELECT b11 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a ANA GARCIA SOTO.', '{"fecha_nota":"2026-01-01"}'::jsonb),
       ('44444444-0000-0000-0000-00000000011b', (SELECT b11 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a JUAN PEREZ LOPEZ.', '{"fecha_nota":"01/03/2026"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000016', '44444444-0000-0000-0000-00000000011a',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-000000000017', '44444444-0000-0000-0000-00000000011b',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'pleno', 'pleno dominio');

-- ---- B12 · Abel 7: nuda 100 + usufructo 100 (jamás 200) -----------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000012', (SELECT b12 FROM _ids), 'listo',
        'La nuda propiedad del 100 % corresponde a ANA GARCIA SOTO. El usufructo del 100 % corresponde a JUAN PEREZ LOPEZ.',
        '{"fecha_nota":"2026-01-02"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-000000000018', '44444444-0000-0000-0000-000000000012',
        'ANA GARCIA SOTO', '12345678Z', 100, 'nuda_propiedad', 'nuda propiedad'),
       ('55555555-0000-0000-0000-000000000019', '44444444-0000-0000-0000-000000000012',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'usufructo', 'usufructo vitalicio');

-- ---- B13 · DH con DOS unidades fiables: nunca alimentan cuota ----------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-00000000013a', (SELECT b13 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a ANA GARCIA SOTO.',
        '{"finca_registral":"1001","fecha_nota":"2026-01-03"}'::jsonb),
       ('44444444-0000-0000-0000-00000000013b', (SELECT b13 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a JUAN PEREZ LOPEZ.',
        '{"finca_registral":"1002","fecha_nota":"2026-01-03"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000001a', '44444444-0000-0000-0000-00000000013a',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-00000000001b', '44444444-0000-0000-0000-00000000013b',
        'JUAN PEREZ LOPEZ', '87654321X', 100, 'pleno', 'pleno dominio');

-- ---- B14 · cita con VARIOS titulares y VARIOS porcentajes --------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000014', (SELECT b14 FROM _ids), 'listo',
        'El pleno dominio corresponde a ANA GARCIA SOTO en un 60 % y a JUAN PEREZ LOPEZ en un 40 %.',
        '{"fecha_nota":"2026-01-04"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000001c', '44444444-0000-0000-0000-000000000014',
        'ANA GARCIA SOTO', '12345678Z', 60, 'pleno', 'pleno dominio'),
       ('55555555-0000-0000-0000-00000000001d', '44444444-0000-0000-0000-000000000014',
        'JUAN PEREZ LOPEZ', '87654321X', 40, 'pleno', 'pleno dominio');

-- ---- B15 · número de finca/folio NO es marcador porcentual -------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000015', (SELECT b15 FROM _ids), 'listo',
        'Finca registral 100, folio 100: el pleno dominio pertenece a ANA GARCIA SOTO.',
        '{"fecha_nota":"2026-01-06"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000001e', '44444444-0000-0000-0000-000000000015',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio');

-- ---- B16 · nota NO 'listo': fuera del universo del dry-run -------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000016', (SELECT b16 FROM _ids), 'pendiente',
        'El pleno dominio del 100 % pertenece a ANA GARCIA SOTO.', '{"fecha_nota":"2026-01-07"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal)
VALUES ('55555555-0000-0000-0000-00000000001f', '44444444-0000-0000-0000-000000000016',
        'ANA GARCIA SOTO', '12345678Z', 100, 'pleno', 'pleno dominio');

-- ---- B17 · sociedad + conflicto owner/company --------------------------
INSERT INTO public.notas_simples (id, building_id, status, raw_pdf_text, structured_json)
VALUES ('44444444-0000-0000-0000-000000000017', (SELECT b17 FROM _ids), 'listo',
        'El pleno dominio del 100 % pertenece a PATRIMONIAL TEST SL.', '{"fecha_nota":"2026-01-08"}'::jsonb);
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, owner_id, company_id)
SELECT '55555555-0000-0000-0000-000000000020', '44444444-0000-0000-0000-000000000017',
       'PATRIMONIAL TEST SL', 'B12345678', 100, 'pleno', 'pleno dominio', o_ana, c_soc FROM _ids;

-- ---------------------------------------------------------------------
-- 3) Aserciones
-- ---------------------------------------------------------------------
CREATE TEMP TABLE _s AS SELECT * FROM public.v_p0_rights_staging;

DO $$
DECLARE v record; v2 record; v_n int; v_dry jsonb; v_dry2 jsonb;
BEGIN
  -- ===== Universo y paridad 1:1 (solo status='listo') ==================
  SELECT count(*) INTO v_n
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
  WHERE ns.building_id IS NOT NULL AND ns.status = 'listo';
  PERFORM pg_temp.assert((SELECT count(*) FROM _s) = v_n, 'staged_rows debe igualar los titulares de notas listo');
  PERFORM pg_temp.assert((SELECT count(DISTINCT titular_id) FROM _s) = (SELECT count(*) FROM _s),
                         'titular_id debe ser único en staging');
  PERFORM pg_temp.assert((SELECT count(*) FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000001f') = 0,
                         'B16: la nota no "listo" queda fuera del universo');

  -- ===== (1) Vocabulario de derechos y régimen =========================
  PERFORM pg_temp.assert((SELECT bool_and(right_type IN ('pleno_dominio','nuda_propiedad','usufructo','otro')) FROM _s),
                         'right_type solo admite los cuatro derechos canónicos');
  PERFORM pg_temp.assert((SELECT bool_and(coownership_regime IN ('gananciales','privativo','proindiviso','desconocido')) FROM _s),
                         'coownership_regime canónico');

  -- ===== (7) identity_match alineado con el CHECK ======================
  PERFORM pg_temp.assert((SELECT bool_and(identity_match IN (
      'dni','cif','nombre_exacto','aproximado','ninguno','owner_preexistente',
      'company_preexistente','ambiguo','conflicto_owner_y_company','nombre_sociedad_revisable')) FROM _s),
      'identity_match dentro del vocabulario del CHECK: el rebuild no puede fallar por su propio CHECK');

  -- ===== B1 · caso apto ================================================
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000001';
  PERFORM pg_temp.assert(v.right_type = 'pleno_dominio', 'B1: pleno_dominio');
  PERFORM pg_temp.assert(v.evidence_ok AND NOT v.evidence_ambiguous AND NOT v.bad_evidence, 'B1: evidencia real y unívoca');
  PERFORM pg_temp.assert(v.layer_complete AND v.feeds_cuota, 'B1: capa completa y alimenta cuota');

  -- ===== B5 · capa que suma EXACTAMENTE 90 =============================
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000009';
  PERFORM pg_temp.assert(v.capa_suma = 90, 'B5: la capa de pleno suma realmente 90');
  PERFORM pg_temp.assert(NOT v.layer_complete AND NOT v.feeds_cuota, 'B5: capa 90 bloqueada');
  -- 1A.3 endurece el motivo: la capa es indivisible, así que el motivo
  -- puede ser el cierre <100 % o el fallo de otra fila de la misma capa.
  PERFORM pg_temp.assert(v.review_reason ILIKE '%capa%', 'B5: motivo de capa incompleta: ' || coalesce(v.review_reason,'<null>'));

  -- ===== (2) B8 · conflicto rol vs literal =============================
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000010';
  PERFORM pg_temp.assert(v.role_conflict, 'B8: rol=pleno y literal=usufructo => role_conflict');
  PERFORM pg_temp.assert(v.right_type = 'otro', 'B8: conflicto => right_type otro');
  PERFORM pg_temp.assert(v.review_flag AND NOT v.feeds_cuota, 'B8: conflicto en revisión y sin cuota');
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000011';
  PERFORM pg_temp.assert(v.role_conflict AND v.right_type = 'otro',
                         'B8: literal con nuda Y usufructo no se resuelve por orden de palabras');
  PERFORM pg_temp.assert(public.p0_right_from_literal('nuda propiedad y usufructo') = 'ambiguo',
                         'literal con dos derechos => ambiguo');
  PERFORM pg_temp.assert(public.p0_right_from_rol('ganancial') IS NULL,
                         'ganancial NO es un derecho real');

  -- ===== (1) B9 · pleno + ganancial separado; solo ganancial ===========
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000012';
  PERFORM pg_temp.assert(v.right_type = 'pleno_dominio', 'B9: "pleno dominio con caracter ganancial" sigue siendo pleno_dominio');
  PERFORM pg_temp.assert(v.coownership_regime = 'gananciales', 'B9: el carácter ganancial va al régimen');
  PERFORM pg_temp.assert(v.review_flag AND NOT v.feeds_cuota, 'B9: pleno ganancial en revisión y sin cuota');
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000013';
  PERFORM pg_temp.assert(v.right_type = 'otro' AND v.coownership_regime = 'gananciales',
                         'B9: solo ganancial sin derecho real => otro + régimen');
  PERFORM pg_temp.assert(v.review_flag AND NOT v.feeds_cuota, 'B9: solo ganancial, cero cuota');

  -- ===== (4) Parser de fechas ==========================================
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral('2026-01-15') = DATE '2026-01-15', 'fecha ISO');
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral('15/01/2026') = DATE '2026-01-15', 'fecha DD/MM/YYYY');
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral('15-01-2026') = DATE '2026-01-15', 'fecha DD-MM-YYYY');
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral('31/02/2026') IS NULL, 'fecha imposible => NULL');
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral('marzo de 2026') IS NULL, 'fecha no parseable => NULL');
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral(NULL) IS NULL, 'fecha ausente => NULL');
  -- el orden es por date, no por texto: '02/03/2026' > '2026-01-31'
  PERFORM pg_temp.assert(public.p0_parse_fecha_registral('02/03/2026') > public.p0_parse_fecha_registral('2026-01-31'),
                         'las fechas se comparan como date, nunca como text');

  -- ===== (4) B10/B11 · nota posterior supersede ========================
  SELECT * INTO v  FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000014'; -- 2025
  SELECT * INTO v2 FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000015'; -- 2026
  PERFORM pg_temp.assert(NOT v.is_canonical AND v.status = 'superseded', 'B10: la nota anterior queda superseded');
  PERFORM pg_temp.assert(v2.is_canonical AND v2.status = 'active', 'B10: la nota posterior es la canónica');
  PERFORM pg_temp.assert(NOT v2.unidad_contradictoria AND v2.unidad_resuelta_por_fecha,
                         'B10: cronología fiable resuelve, no bloquea');
  PERFORM pg_temp.assert(NOT v.feeds_cuota, 'B10: la superseded nunca alimenta cuota');
  SELECT * INTO v2 FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000017'; -- 01/03/2026
  PERFORM pg_temp.assert(v2.is_canonical, 'B11: DD/MM/YYYY posterior supersede a la ISO anterior');
  PERFORM pg_temp.assert((SELECT NOT is_canonical FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000016'),
                         'B11: la ISO anterior queda superseded');

  -- ===== (4) B4 · misma fecha con firmas distintas => bloqueo ==========
  PERFORM pg_temp.assert((SELECT bool_and(unidad_contradictoria) FROM _s
                          WHERE building_id = (SELECT b4 FROM _ids)),
                         'B4: misma fecha y firmas distintas => contradicción');
  PERFORM pg_temp.assert((SELECT bool_or(feeds_cuota) FROM _s
                          WHERE building_id = (SELECT b4 FROM _ids)) IS NOT TRUE,
                         'B4: la contradicción bloquea la cuota');

  -- ===== (5) Firma: sinónimos iguales, repartos distintos difieren =====
  PERFORM pg_temp.assert(
    public.p0_nota_signature('44444444-0000-0000-0000-00000000006a')
    = public.p0_nota_signature('44444444-0000-0000-0000-00000000006b'),
    'copias idénticas procesadas otro día comparten firma');
  PERFORM pg_temp.assert(
    public.p0_nota_signature('44444444-0000-0000-0000-00000000004a')
    <> public.p0_nota_signature('44444444-0000-0000-0000-00000000004b'),
    '60/40 y 50/50 deben dar firmas distintas');
  -- "pleno dominio" y "plena propiedad" son sinónimos: no pueden contradecir
  PERFORM pg_temp.assert(
    public.p0_right_type_canonico('pleno','pleno dominio')
    = public.p0_right_type_canonico(NULL,'plena propiedad'),
    'sinónimos de pleno dominio no contradicen');
  PERFORM pg_temp.assert(NOT public.p0_role_conflict('pleno','plena propiedad'),
                         'pleno + plena propiedad no es conflicto');
  PERFORM pg_temp.assert(
    (SELECT count(DISTINCT note_simple_id) FROM _s
     WHERE ownership_unit_key = 'building:' || (SELECT b6 FROM _ids)::text AND is_canonical) = 1,
    'una sola nota canónica por unidad');
  PERFORM pg_temp.assert(
    (SELECT coalesce(sum(percentage) FILTER (WHERE feeds_cuota), 0) FROM _s
     WHERE ownership_unit_key = 'building:' || (SELECT b6 FROM _ids)::text) <= 100,
    'dos notas idénticas no pueden sumar 200%');

  -- ===== Abel 7 · nuda 100 + usufructo 100 nunca suman 200 =============
  PERFORM pg_temp.assert(
    (SELECT coalesce(sum(percentage) FILTER (WHERE feeds_cuota), 0) FROM _s
     WHERE building_id = (SELECT b12 FROM _ids)) = 0,
    'Abel7: nuda + usufructo nunca proyectan cuota (jamás 200)');

  -- ===== (3) Evidencia real ============================================
  -- cita con varios titulares y varios porcentajes: no es evidencia
  PERFORM pg_temp.assert((SELECT bool_and(evidence_ambiguous) FROM _s
                          WHERE building_id = (SELECT b14 FROM _ids)),
                         'B14: cita con varios titulares/porcentajes => evidence_ambiguous');
  PERFORM pg_temp.assert((SELECT bool_or(feeds_cuota) FROM _s
                          WHERE building_id = (SELECT b14 FROM _ids)) IS NOT TRUE,
                         'B14: evidencia ambigua nunca alimenta cuota');
  -- número de finca/folio no es marcador porcentual
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000001e';
  PERFORM pg_temp.assert(NOT v.evidence_ok AND NOT v.feeds_cuota,
                         'B15: un número de finca/folio no acredita porcentaje');
  PERFORM pg_temp.assert(public.p0_cita_pct_values('Finca registral 100, folio 100') = '{}'::numeric[],
                         'sin marcador no hay porcentajes');
  PERFORM pg_temp.assert(100 = ANY (public.p0_cita_pct_values('el 100 % del pleno dominio')),
                         'marcador % reconocido');
  PERFORM pg_temp.assert(50 = ANY (public.p0_cita_pct_values('una mitad indivisa 1/2 del pleno dominio')),
                         'fracción semántica reconocida');
  PERFORM pg_temp.assert(75 = ANY (public.p0_cita_pct_values('el 75 por ciento')),
                         '"por ciento" reconocido');
  -- structured_json negativos
  PERFORM pg_temp.assert((SELECT NOT evidence_ok FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000c'),
                         'SJ: derecho distinto no vale');
  PERFORM pg_temp.assert((SELECT NOT evidence_ok FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000d'),
                         'SJ: porcentaje distinto no vale');
  PERFORM pg_temp.assert((SELECT NOT evidence_ok FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000e'),
                         'SJ: localizador vacío no es trazabilidad');
  PERFORM pg_temp.assert((SELECT NOT evidence_ok FROM _s WHERE titular_id = '55555555-0000-0000-0000-00000000000f'),
                         'SJ: porcentaje textual no numérico no vale');
  PERFORM pg_temp.assert((SELECT bool_or(feeds_cuota) FROM _s WHERE building_id = (SELECT b7 FROM _ids)) IS NOT TRUE,
                         'B7: ninguna fila con evidencia defectuosa alimenta cuota');

  -- parse_pct seguro
  PERFORM pg_temp.assert(public.p0_parse_pct('50,00 %') = 50, 'parse_pct: coma y %');
  PERFORM pg_temp.assert(public.p0_parse_pct(' 45.5 ') = 45.5, 'parse_pct: punto y espacios');
  PERFORM pg_temp.assert(public.p0_parse_pct('cincuenta por ciento') IS NULL, 'parse_pct: texto => NULL');
  PERFORM pg_temp.assert(public.p0_parse_pct(NULL) IS NULL, 'parse_pct: NULL => NULL');
  -- el regex de porcentaje exige marcador
  PERFORM pg_temp.assert('el 100,00 % del pleno dominio' ~ public.p0_pct_regex(100), 'pct: coma con marcador');
  PERFORM pg_temp.assert('el 100 por ciento' ~ public.p0_pct_regex(100), 'pct: literal por ciento');
  PERFORM pg_temp.assert(NOT ('finca 100 folio 2' ~ public.p0_pct_regex(100)), 'pct: sin marcador no vale');

  -- ===== (6) División horizontal =======================================
  PERFORM pg_temp.assert(
    public.p0_nota_unit_key('44444444-0000-0000-0000-000000000002')
    = 'dh:' || (SELECT b2 FROM _ids)::text || ':finca:12345', 'DH: clave fiable con namespace');
  PERFORM pg_temp.assert(public.p0_nota_unit_key('44444444-0000-0000-0000-000000000003') IS NULL,
                         'DH sin clave fiable => NULL');
  PERFORM pg_temp.assert(
    public.p0_nota_unit_key('44444444-0000-0000-0000-00000000000e')
    = 'dh:' || (SELECT b2 FROM _ids)::text || ':refcat:9872023VH5797S0001WX',
    'idufir vacío no oculta la referencia catastral posterior');
  PERFORM pg_temp.assert(public.p0_nota_unit_key('44444444-0000-0000-0000-00000000000f') IS NULL,
                         'clave que normaliza a vacío => sin unidad fiable');
  PERFORM pg_temp.assert(
    public.p0_nota_unit_key('44444444-0000-0000-0000-000000000002')
    IS DISTINCT FROM public.p0_nota_unit_key('44444444-0000-0000-0000-000000000020'),
    'idufir 12345 y finca 12345 no colisionan');
  PERFORM pg_temp.assert(
    (SELECT count(DISTINCT ownership_unit_key) FROM _s WHERE building_id = (SELECT b13 FROM _ids)) = 2,
    'B13: dos unidades DH distintas y fiables');
  PERFORM pg_temp.assert(
    (SELECT bool_or(feeds_cuota) FROM _s WHERE building_id = (SELECT b13 FROM _ids)) IS NOT TRUE,
    'B13: dos unidades DH nunca alimentan building_owners');
  PERFORM pg_temp.assert(
    (SELECT bool_and(unit_block_reason = 'dh_no_proyectable_a_cuota_edificio')
     FROM _s WHERE building_id = (SELECT b13 FROM _ids)),
    'B13: motivo explícito de no proyección DH');
  PERFORM pg_temp.assert((SELECT bool_or(feeds_cuota) FROM _s WHERE division_horizontal) IS NOT TRUE,
                         'ninguna fila con división horizontal alimenta cuota');
  PERFORM pg_temp.assert(
    -- 1A.3 escala el bloqueo de unidad a bloqueo de edificio.
    (SELECT bool_and(unit_block_reason IN ('dh_sin_unidad_registral','bloqueo_edificio') AND NOT feeds_cuota)
     FROM _s WHERE building_id = (SELECT b3 FROM _ids)),
    'B3: DH sin clave => bloqueado y sin cuota');

  -- ===== Conflicto owner/company y sociedades ==========================
  SELECT * INTO v FROM _s WHERE titular_id = '55555555-0000-0000-0000-000000000020';
  PERFORM pg_temp.assert(v.conflicto_ids, 'B17: conflicto owner+company detectado');
  PERFORM pg_temp.assert(v.owner_id IS NULL AND v.company_id IS NULL, 'B17: ambos NULL en la salida operativa');
  PERFORM pg_temp.assert((v.audit_ids ->> 'pre_owner_id') IS NOT NULL
                         AND (v.audit_ids ->> 'pre_company_id') IS NOT NULL,
                         'B17: ambos IDs originales en auditoría');
  PERFORM pg_temp.assert(NOT v.feeds_cuota AND v.review_flag, 'B17: bloqueado sin cuota');
  PERFORM pg_temp.assert((SELECT count(*) FROM _s WHERE owner_id IS NOT NULL AND company_id IS NOT NULL) = 0,
                         'ninguna fila operativa con owner_id y company_id a la vez');
  PERFORM pg_temp.assert(
    (SELECT bool_or(feeds_cuota) FROM _s WHERE identity_match IN
       ('owner_preexistente','nombre_exacto','nombre_sociedad_revisable','ambiguo',
        'conflicto_owner_y_company','company_preexistente','cif','ninguno','aproximado'))
    IS NOT TRUE,
    'solo el DNI exacto e inequívoco puede alimentar cuota personal');

  -- ===== (8) Dry-run coherente =========================================
  v_dry  := public.p0_property_rights_dry_run();
  v_dry2 := public.p0_property_rights_dry_run();
  PERFORM pg_temp.assert(v_dry = v_dry2, 'dry-run idempotente');
  PERFORM pg_temp.assert(v_dry ->> 'universo' LIKE 'notas_simples.status = listo%', 'universo declarado');
  PERFORM pg_temp.assert((v_dry ->> 'source_titulares')::int = v_n, 'gate y resumen comparten universo listo');
  PERFORM pg_temp.assert((v_dry ->> 'paridad_1a1')::boolean, 'paridad 1:1');
  PERFORM pg_temp.assert((v_dry ->> 'role_conflicts')::int >= 2, 'contador role_conflicts');
  PERFORM pg_temp.assert((v_dry ->> 'evidence_ambiguous')::int >= 2, 'contador evidence_ambiguous');
  PERFORM pg_temp.assert((v_dry ->> 'bad_evidence')::int >= 1, 'contador bad_evidence');
  PERFORM pg_temp.assert((v_dry ->> 'invalid_pct')::int >= 0, 'contador invalid_pct presente');
  PERFORM pg_temp.assert((v_dry ->> 'dh_feeds')::int = 0, 'dh_feeds debe ser 0');
  PERFORM pg_temp.assert((v_dry ->> 'bad_evidence_feeds')::int = 0, 'bad_evidence_feeds debe ser 0');
  PERFORM pg_temp.assert((v_dry ->> 'contradicciones')::int >= 1, 'debe detectar la contradicción de misma fecha');
  PERFORM pg_temp.assert((v_dry ->> 'supersedidas_por_fecha')::int >= 2, 'debe detectar las unidades resueltas por fecha');
  PERFORM pg_temp.assert((v_dry ->> 'duplicados_identicos')::int >= 1, 'debe detectar el duplicado idéntico');
  PERFORM pg_temp.assert((v_dry ->> 'capas_incompletas')::int >= 1, 'al menos una capa incompleta');
  PERFORM pg_temp.assert((v_dry ->> 'capas_completas')::int >= 1, 'al menos una capa completa');
  PERFORM pg_temp.assert((v_dry ->> 'mezcla_owner_company')::int = 0, 'mezcla_owner_company = 0');
  PERFORM pg_temp.assert((v_dry -> 'safety_invariants' ->> 'dh_no_alimenta_cuota')::boolean, 'invariante DH');
  PERFORM pg_temp.assert((v_dry -> 'safety_invariants' ->> 'role_conflict_no_alimenta_cuota')::boolean, 'invariante role_conflict');
  PERFORM pg_temp.assert((v_dry -> 'safety_invariants' ->> 'ganancial_no_alimenta_cuota')::boolean, 'invariante ganancial');
  PERFORM pg_temp.assert((v_dry -> 'safety_invariants' ->> 'evidencia_mala_o_ambigua_no_alimenta_cuota')::boolean,
                         'invariante evidencia');
  PERFORM pg_temp.assert((v_dry ->> 'invariants_ok')::boolean, 'invariants_ok debe ser true');
  PERFORM pg_temp.assert((v_dry ->> 'applied')::boolean IS FALSE AND v_dry ->> 'real_rebuild' = 'disabled',
                         'el dry-run declara rebuild deshabilitado');

  -- ===== (9) Rebuild real deshabilitado ================================
  BEGIN
    PERFORM public.p0_rebuild_property_rights('test', true);
    PERFORM pg_temp.assert(false, 'p_apply=true debería lanzar REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.assert(SQLERRM LIKE '%REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL%',
                           'excepción esperada de rebuild deshabilitado, recibida: ' || SQLERRM);
  END;
END $$;

-- ---------------------------------------------------------------------
-- 4) Recuentos DESPUÉS: el dry-run no escribe en tablas consumidoras
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT b.t, b.n AS n1,
           CASE b.t
             WHEN 'building_property_rights' THEN (SELECT count(*) FROM public.building_property_rights)
             WHEN 'building_owners'          THEN (SELECT count(*) FROM public.building_owners)
             WHEN 'building_tasks'           THEN (SELECT count(*) FROM public.building_tasks)
           END AS n2
    FROM _before b WHERE b.t <> 'buildings'
  LOOP
    PERFORM pg_temp.assert(r.n1 = r.n2,
      format('la tabla %s cambió durante el dry-run (%s->%s)', r.t, r.n1, r.n2));
  END LOOP;

  -- buildings solo varía por los 17 edificios sintéticos del test
  PERFORM pg_temp.assert(
    (SELECT n FROM _before WHERE t = 'buildings') + 17 = (SELECT count(*) FROM public.buildings),
    'buildings solo debe variar por los fixtures del test');

  RAISE NOTICE 'WAVE 1A.2 · TODAS LAS ASERCIONES OK (se revierte todo con ROLLBACK)';
END $$;

ROLLBACK;
