-- =====================================================================
-- WAVE 1A.3 · FIXTURES DE INTEGRACIÓN
-- =====================================================================
-- ATENCIÓN: este fichero INSERTA datos. SOLO puede ejecutarse dentro de
-- una base desechable creada por wave1a3_integration_runner.sh. Aborta
-- de inmediato si detecta que la base no es desechable (el nombre debe
-- empezar por wave1a_test_). No se apoya en ningún GUC falsificable.
-- =====================================================================

DO $$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: fixtures solo en base desechable wave1a_test_*, base actual = %',
      current_database();
  END IF;
END $$;

BEGIN;

-- ---------------------------------------------------------------------
-- Edificios: uno sin división horizontal y uno con DH.
-- ---------------------------------------------------------------------
INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Abel 7',           'Madrid', false),
  ('22222222-2222-2222-2222-222222222222', 'Palencia 3',       'Madrid', false),
  ('33333333-3333-3333-3333-333333333333', 'Sorgo 25',         'Madrid', false),
  ('44444444-4444-4444-4444-444444444444', 'María Pedraza 17', 'Madrid', false),
  ('55555555-5555-5555-5555-555555555555', 'Bruno Ayllón 10',  'Madrid', true),
  ('66666666-6666-6666-6666-666666666666', 'Retiro 1',         'Madrid', false),
  ('77777777-7777-7777-7777-777777777777', 'Alcalá 9',         'Madrid', false),
  ('88888888-8888-8888-8888-888888888888', 'Goya 4',           'Madrid', true),
  ('99999999-9999-9999-9999-999999999999', 'Serrano 2',        'Madrid', false),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Velázquez 8',      'Madrid', true);

-- Edificios de los casos POSITIVOS (no-DH, sin conflicto alguno).
INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal) VALUES
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Positivo 100', 'Madrid', false),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Positivo 60/40', 'Madrid', false);

INSERT INTO public.owners (id, nombre, metadatos) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'ANA LOPEZ',  '{"dni__nif__cif":"00000001A"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000002', 'LUIS PEREZ', '{"dni__nif__cif":"00000002B"}'::jsonb);

INSERT INTO public.companies (id, nombre, cif) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'GANANCIALES PATRIMONIAL SL', 'B12345678');

-- ---------------------------------------------------------------------
-- CASO 1 (Abel 7): capa 50 válido + 50 inseguro => CERO feeds.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('11111111-0000-0000-0000-0000000000a1',
   '11111111-1111-1111-1111-111111111111', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'ANA LOPEZ es titular del 50 % del pleno dominio. LUIS PEREZ figura sin porcentaje acreditado.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('11111111-0000-0000-0000-0000000000b1', '11111111-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 50, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 50 % del pleno dominio","pagina":"1"}'::jsonb),
  ('11111111-0000-0000-0000-0000000000b2', '11111111-0000-0000-0000-0000000000a1',
   'LUIS PEREZ', '00000002B', 50, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"LUIS PEREZ titular del 50 % del pleno dominio","pagina":"1"}'::jsonb);
   -- La cita de LUIS PEREZ NO está anclada en raw_pdf_text: fila insegura.

-- ---------------------------------------------------------------------
-- CASO 2 (Palencia 3): nota posterior 'listo' SIN titulares bloquea la
-- antigua y la unidad completa.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('22222222-0000-0000-0000-0000000000a1',
   '22222222-2222-2222-2222-222222222222', 'listo',
   '{"fecha_nota":"2025-01-10"}'::jsonb,
   'ANA LOPEZ es titular del 100 % del pleno dominio.'),
  ('22222222-0000-0000-0000-0000000000a2',
   '22222222-2222-2222-2222-222222222222', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'Nota posterior sin titulares extraídos.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('22222222-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 3 (Sorgo 25): fechas y fracciones basura; cita inventada;
-- structured "50 %" sin titular ni derecho; localizadores inválidos.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('33333333-0000-0000-0000-0000000000a1',
   '33333333-3333-3333-3333-333333333333', 'listo',
   '{"fecha_nota":"01/02/2026 finca 1/2","titulares":[{"nombre":"ANA LOPEZ","porcentaje":"50 %","pagina":"x"}]}'::jsonb,
   'Inscripción de fecha 01/02/2026, finca 1/2, tomo 3.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('33333333-0000-0000-0000-0000000000b1', '33333333-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 50, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ titular del 50 % del pleno dominio","pagina":"0"}'::jsonb),
  ('33333333-0000-0000-0000-0000000000b2', '33333333-0000-0000-0000-0000000000a1',
   'LUIS PEREZ', '00000002B', 50, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"porcentaje":"50 %"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 4 (María Pedraza 17): dos fechas válidas contradictorias +
-- régimen ganancial/privativo en conflicto.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('44444444-0000-0000-0000-0000000000a1',
   '44444444-4444-4444-4444-444444444444', 'listo',
   '{"fecha_nota":"2026-02-01","fecha_registral":"2025-01-01"}'::jsonb,
   'ANA LOPEZ es titular del 100 % del pleno dominio con carácter ganancial y privativo.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('44444444-0000-0000-0000-0000000000b1', '44444444-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 100, 'pleno',
   '{"rol_literal":"pleno dominio","regimen":"ganancial y privativo"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio con carácter ganancial y privativo","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 5 (Bruno Ayllón 10): división horizontal, varias unidades.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('55555555-0000-0000-0000-0000000000a1',
   '55555555-5555-5555-5555-555555555555', 'listo',
   '{"fecha_nota":"2026-01-10","finca_registral":"1001"}'::jsonb,
   'ANA LOPEZ es titular del 100 % del pleno dominio.'),
  ('55555555-0000-0000-0000-0000000000a2',
   '55555555-5555-5555-5555-555555555555', 'listo',
   '{"fecha_nota":"2026-01-10","finca_registral":"1002"}'::jsonb,
   'GANANCIALES PATRIMONIAL SL es titular del 100 % del pleno dominio.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('55555555-0000-0000-0000-0000000000b1', '55555555-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb),
  ('55555555-0000-0000-0000-0000000000b2', '55555555-0000-0000-0000-0000000000a2',
   'GANANCIALES PATRIMONIAL SL', 'B12345678', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"GANANCIALES PATRIMONIAL SL es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 6 (Retiro 1): EVIDENCIA ESTRUCTURADA SIN CITA ANCLADA.
-- Ruta JSON sintácticamente válida que apunta a OTRO titular, offset
-- válido sin cita y página sin vínculo => auditoría, nunca cuota.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('66666666-0000-0000-0000-0000000000a1',
   '66666666-6666-6666-6666-666666666666', 'listo',
   '{"fecha_nota":"2026-01-10","titulares":[{"nombre":"ANA LOPEZ","porcentaje":"50 %"}]}'::jsonb,
   'ANA LOPEZ es titular del 50 % del pleno dominio. LUIS PEREZ comparece en el otorgamiento.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('66666666-0000-0000-0000-0000000000b1', '66666666-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 50, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 50 % del pleno dominio","pagina":"1"}'::jsonb),
  -- ruta válida, pero apunta al elemento de OTRO titular y no trae cita
  ('66666666-0000-0000-0000-0000000000b2', '66666666-0000-0000-0000-0000000000a1',
   'LUIS PEREZ', '00000002B', 50, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"ruta":"$.titulares[0].porcentaje","offset":"120","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 7 (Alcalá 9): 'otro' NO resuelto conviviendo con un pleno 100 %
-- perfectamente probado => la UNIDAD entera deja de proyectar.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('77777777-0000-0000-0000-0000000000a1',
   '77777777-7777-7777-7777-777777777777', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'ANA LOPEZ es titular del 100 % del pleno dominio. LUIS PEREZ es titular del 100 % del usufructo.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('77777777-0000-0000-0000-0000000000b1', '77777777-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb),
  -- rol 'pleno' contra literal 'usufructo' => conflicto de fuentes => 'otro'
  ('77777777-0000-0000-0000-0000000000b2', '77777777-0000-0000-0000-0000000000a1',
   'LUIS PEREZ', '00000002B', 100, 'pleno', '{"rol_literal":"usufructo"}'::jsonb,
   '{"cita":"LUIS PEREZ es titular del 100 % del usufructo","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 8 (Goya 4, DH): DOS localizadores registrales válidos y distintos
-- en la misma nota => unit_key_conflict y bloqueo de TODO el edificio.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('88888888-0000-0000-0000-0000000000a1',
   '88888888-8888-8888-8888-888888888888', 'listo',
   '{"fecha_nota":"2026-01-10","finca_registral":"1001","idufir":"12345678901"}'::jsonb,
   'ANA LOPEZ es titular del 100 % del pleno dominio.'),
  ('88888888-0000-0000-0000-0000000000a2',
   '88888888-8888-8888-8888-888888888888', 'listo',
   '{"fecha_nota":"2026-01-10","finca_registral":"1002"}'::jsonb,
   'LUIS PEREZ es titular del 100 % del pleno dominio.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('88888888-0000-0000-0000-0000000000b1', '88888888-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb),
  ('88888888-0000-0000-0000-0000000000b2', '88888888-0000-0000-0000-0000000000a2',
   'LUIS PEREZ', '00000002B', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"LUIS PEREZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 9 (Serrano 2): DNI duplicado en el CRM y CIF duplicado =>
-- identidad AMBIGUA, jamás "coincidencia exacta".
-- ---------------------------------------------------------------------
INSERT INTO public.owners (id, nombre, metadatos) VALUES
  ('a0000000-0000-0000-0000-000000000003', 'MARIA GIL',  '{"dni__nif__cif":"00000009X"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000004', 'MARIA G.',   '{"dni__nif__cif":"00000009X"}'::jsonb);

INSERT INTO public.companies (id, nombre, cif) VALUES
  ('c0000000-0000-0000-0000-000000000002', 'DUPLICADA UNO SL', 'B99999999'),
  ('c0000000-0000-0000-0000-000000000003', 'DUPLICADA DOS SL', 'B99999999');

INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('99999999-0000-0000-0000-0000000000a1',
   '99999999-9999-9999-9999-999999999999', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'MARIA GIL es titular del 100 % del pleno dominio.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('99999999-0000-0000-0000-0000000000b1', '99999999-0000-0000-0000-0000000000a1',
   'MARIA GIL', '00000009X', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"MARIA GIL es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 10 (Velázquez 8, DH): nota 'listo' SIN titulares en un edificio
-- con división horizontal => bloqueo de edificio, cero canónicas y cero
-- feeds para TODAS las unidades.
-- ---------------------------------------------------------------------
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000a1',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'listo',
   '{"fecha_nota":"2025-01-10","finca_registral":"2001"}'::jsonb,
   'ANA LOPEZ es titular del 100 % del pleno dominio.'),
  ('aaaaaaaa-0000-0000-0000-0000000000a2',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'Nota posterior lista sin titulares extraídos.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('aaaaaaaa-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-0000000000a1',
   'ANA LOPEZ', '00000001A', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 11 (POSITIVO, Positivo 100): no-DH, una sola nota canónica,
-- persona física con DNI único en el CRM, pleno dominio 100 %, cita
-- anclada literalmente en raw_pdf_text con titular + derecho + 100 %.
-- Debe producir EXACTAMENTE una fila segura con feeds_cuota = true.
-- ---------------------------------------------------------------------
INSERT INTO public.owners (id, nombre, metadatos) VALUES
  ('a0000000-0000-0000-0000-000000000010', 'ROSA VEGA', '{"dni__nif__cif":"00000010C"}'::jsonb);

INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000a1',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'ROSA VEGA es titular del 100 % del pleno dominio de la finca.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('bbbbbbbb-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-0000000000a1',
   'ROSA VEGA', '00000010C', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ROSA VEGA es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- ---------------------------------------------------------------------
-- CASO 12 (POSITIVO, Positivo 60/40): dos titulares seguros que suman
-- 100 %. AMBAS filas deben alimentar cuota.
-- ---------------------------------------------------------------------
INSERT INTO public.owners (id, nombre, metadatos) VALUES
  ('a0000000-0000-0000-0000-000000000011', 'PABLO SOTO', '{"dni__nif__cif":"00000011D"}'::jsonb),
  ('a0000000-0000-0000-0000-000000000012', 'ELENA RUIZ', '{"dni__nif__cif":"00000012E"}'::jsonb);

INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('cccccccc-0000-0000-0000-0000000000a1',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'listo',
   '{"fecha_nota":"2026-01-10"}'::jsonb,
   'PABLO SOTO es titular del 60 % del pleno dominio. ELENA RUIZ es titular del 40 % del pleno dominio.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('cccccccc-0000-0000-0000-0000000000b1', 'cccccccc-0000-0000-0000-0000000000a1',
   'PABLO SOTO', '00000011D', 60, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"PABLO SOTO es titular del 60 % del pleno dominio","pagina":"1"}'::jsonb),
  ('cccccccc-0000-0000-0000-0000000000b2', 'cccccccc-0000-0000-0000-0000000000a1',
   'ELENA RUIZ', '00000012E', 40, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ELENA RUIZ es titular del 40 % del pleno dominio","pagina":"1"}'::jsonb);

-- =====================================================================
-- ASERCIONES DE REGRESIÓN
-- =====================================================================
DO $$
DECLARE d jsonb; n int;
BEGIN
  -- 1) 50 válido + 50 inseguro => cero feeds en la capa.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '11111111-1111-1111-1111-111111111111' AND feeds_cuota;
  ASSERT n = 0, 'capa indivisible: una fila insegura anula la capa entera';

  -- 2) Nota posterior 'listo' sin titulares bloquea la antigua.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '22222222-2222-2222-2222-222222222222' AND feeds_cuota;
  ASSERT n = 0, 'lista sin titulares bloquea la nota anterior';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '22222222-2222-2222-2222-222222222222'
     AND unit_block_reason = 'nota_lista_sin_titulares';
  ASSERT n > 0, 'motivo nota_lista_sin_titulares presente';
  SELECT count(*) INTO n FROM public.v_p0_notas_listo_sin_titulares;
  ASSERT n = 1, 'la nota sin titulares aparece en el dry-run';

  -- 3) Fechas/fracciones basura, cita inventada y localizadores inválidos.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '33333333-3333-3333-3333-333333333333' AND feeds_cuota;
  ASSERT n = 0, '01/02/2026 y finca 1/2 no son 50 %; cita inventada no prueba';

  -- 4) Dos fechas válidas contradictorias + regime_conflict => cero canónicas.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '44444444-4444-4444-4444-444444444444'
     AND (feeds_cuota OR NOT (date_conflict AND regime_conflict));
  ASSERT n = 0, 'date_conflict + regime_conflict bloquean';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '44444444-4444-4444-4444-444444444444' AND status <> 'blocked_conflict';
  ASSERT n = 0, 'contradicción => estado blocked_conflict';

  -- 5) DH y sociedad: nunca alimentan cuota.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE division_horizontal AND feeds_cuota;
  ASSERT n = 0, 'DH jamás alimenta building_owners.cuota';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE es_sociedad AND feeds_cuota;
  ASSERT n = 0, 'sociedad conciliada por CIF no proyecta cuota personal';

  -- 6) Invariantes globales del dry-run.
  SELECT public.p0_property_rights_dry_run() INTO d;
  ASSERT (d ->> 'safety_invariants_ok')::boolean, 'safety_invariants_ok debe ser true: '|| d::text;
  ASSERT NOT (d ->> 'readiness_ok')::boolean, 'readiness_ok debe ser false con bloqueos presentes';
  ASSERT (d ->> 'feeds_cuota')::int = 3,
    'solo alimentan las 3 filas seguras de los casos positivos: ' || (d ->> 'feeds_cuota');
  ASSERT (d ->> 'paridad_1a1')::boolean, 'paridad titulares + notas 1:1';
  ASSERT (d ->> 'notas_listo_sin_titulares')::int = 2, 'contador de listas sin titulares (no-DH y DH)';
  ASSERT (d ->> 'date_conflicts')::int >= 1, 'contador de date_conflicts';
  ASSERT (d ->> 'regime_conflicts')::int >= 1, 'contador de regime_conflicts';

  -- 7) CASO 6: ruta/offset/página SIN cita anclada => structured_unverified.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE titular_id = '66666666-0000-0000-0000-0000000000b2'
     AND structured_unverified AND NOT evidence_ok AND NOT feeds_cuota;
  ASSERT n = 1, 'ruta válida hacia otro titular + offset sin cita => structured_unverified, cero feed';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '66666666-6666-6666-6666-666666666666' AND feeds_cuota;
  ASSERT n = 0, 'sintaxis válida no es evidencia: la unidad no proyecta';

  -- 8) CASO 7: 'otro' no resuelto + pleno 100 % => CERO feeds en la unidad.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE titular_id = '77777777-0000-0000-0000-0000000000b1'
     AND row_safe_pre_layer AND NOT feeds_cuota AND NOT unidad_segura;
  ASSERT n = 1, 'un pleno 100 % impecable NO proyecta si la unidad tiene una fila "otro"';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '77777777-7777-7777-7777-777777777777' AND feeds_cuota;
  ASSERT n = 0, 'otro/conflict + pleno100 => cero feeds';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE titular_id = '77777777-0000-0000-0000-0000000000b2' AND right_type = 'otro';
  ASSERT n = 1, 'rol vs literal contradictorios se clasifican como "otro"';

  -- 9) CASO 8: dos localizadores válidos distintos => unit_key_conflict y
  --    bloqueo de todo el edificio, sin elegir el primero.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE titular_id = '88888888-0000-0000-0000-0000000000b1' AND unidad_key_conflict;
  ASSERT n = 1, 'IDUFIR y finca distintos => unit_key_conflict';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = '88888888-8888-8888-8888-888888888888'
     AND (feeds_cuota OR is_canonical OR NOT building_block);
  ASSERT n = 0, 'el conflicto de clave bloquea TODAS las unidades del edificio';

  -- 10) CASO 9: DNI/CIF duplicado => ambiguo, nunca exacto.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE titular_id = '99999999-0000-0000-0000-0000000000b1'
     AND identidad_ambigua AND owner_id IS NULL AND company_id IS NULL AND NOT feeds_cuota;
  ASSERT n = 1, 'DNI duplicado en el CRM => identidad ambigua y cero feed';

  -- 11) CASO 10: nota lista sin titulares en DH => bloqueo de edificio.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
     AND (feeds_cuota OR is_canonical);
  ASSERT n = 0, 'nota lista vacía en DH: cero canónicas y cero feeds en el edificio';

  -- 12) Contadores nuevos del dry-run.
  ASSERT (d ->> 'unit_key_conflicts')::int >= 1, 'contador de unit_key_conflicts';
  ASSERT (d ->> 'structured_unverified')::int >= 1, 'contador de structured_unverified';
  ASSERT (d ->> 'identidades_ambiguas')::int >= 1, 'contador de identidades ambiguas';
  ASSERT (d ->> 'filas_bloqueadas_por_edificio')::int >= 1, 'contador de bloqueos de edificio';

  -- 13) POSITIVO 100 %: exactamente una fila segura que alimenta cuota.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  ASSERT n = 1, 'el caso positivo produce exactamente una fila';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
     AND feeds_cuota AND row_safe_pre_layer AND layer_safe AND unidad_segura
     AND is_canonical AND evidence_ok AND NOT structured_unverified
     AND right_type = 'pleno_dominio' AND porcentaje = 100
     AND owner_id = 'a0000000-0000-0000-0000-000000000010'
     AND company_id IS NULL AND NOT identidad_ambigua;
  ASSERT n = 1, 'pleno 100 % con cita anclada y DNI único DEBE alimentar cuota';
  SELECT coalesce(sum(porcentaje), 0) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' AND feeds_cuota;
  ASSERT n = 100, 'la capa segura suma 100';

  -- 14) POSITIVO 60/40: ambas filas seguras alimentan y suman 100.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
     AND feeds_cuota AND row_safe_pre_layer AND layer_safe AND unidad_segura;
  ASSERT n = 2, '60/40 seguros: ambas filas alimentan cuota';
  SELECT coalesce(sum(porcentaje), 0) INTO n FROM public.v_p0_rights_staging
   WHERE building_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' AND feeds_cuota;
  ASSERT n = 100, '60 + 40 = 100 en la capa segura';

  -- 15) El motor NO es un "siempre false": hay proyección real y el
  --     conjunto de filas seguras es exactamente el de los positivos.
  SELECT count(*) INTO n FROM public.v_p0_rights_staging WHERE feeds_cuota;
  ASSERT n = 3, 'exactamente 3 filas alimentan cuota en todo el fixture';
  SELECT count(*) INTO n FROM public.v_p0_rights_staging
   WHERE feeds_cuota
     AND building_id NOT IN ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                             'cccccccc-cccc-cccc-cccc-cccccccccccc');
  ASSERT n = 0, 'ningún caso negativo alimenta cuota';

  RAISE NOTICE 'WAVE 1A.3 · regresiones de integración: OK';
END $$;

-- =====================================================================
-- NADA SE PERSISTE: la transacción de fixtures SIEMPRE se deshace.
-- =====================================================================
ROLLBACK;

DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM public.notas_simples
   WHERE id IN ('11111111-0000-0000-0000-0000000000a1',
                'aaaaaaaa-0000-0000-0000-0000000000a2');
  ASSERT n = 0, 'ROLLBACK incompleto: las fixtures han dejado filas persistidas';
  SELECT count(*) INTO n FROM public.buildings
   WHERE id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  ASSERT n = 0, 'ROLLBACK incompleto: quedan edificios de prueba';
  RAISE NOTICE 'WAVE 1A.3 · fixtures revertidas: cero DML persistido';
END $$;