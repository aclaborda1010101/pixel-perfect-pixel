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
INSERT INTO public.buildings (id, direccion, division_horizontal) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Abel 7',           false),
  ('22222222-2222-2222-2222-222222222222', 'Palencia 3',       false),
  ('33333333-3333-3333-3333-333333333333', 'Sorgo 25',         false),
  ('44444444-4444-4444-4444-444444444444', 'María Pedraza 17', false),
  ('55555555-5555-5555-5555-555555555555', 'Bruno Ayllón 10',  true);

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

COMMIT;

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
  ASSERT (d ->> 'feeds_cuota')::int = 0, 'ninguna fila insegura se proyecta';
  ASSERT (d ->> 'paridad_1a1')::boolean, 'paridad titulares + notas 1:1';
  ASSERT (d ->> 'notas_listo_sin_titulares')::int = 1, 'contador de listas sin titulares';
  ASSERT (d ->> 'date_conflicts')::int >= 1, 'contador de date_conflicts';
  ASSERT (d ->> 'regime_conflicts')::int >= 1, 'contador de regime_conflicts';

  RAISE NOTICE 'WAVE 1A.3 · regresiones de integración: OK';
END $$;