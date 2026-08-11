-- =====================================================================
-- WAVE 1A.3 P0.5 · READINESS POSITIVO REAL (fixture aislado, ROLLBACK)
-- =====================================================================
-- Demuestra que p0_property_rights_dry_run() PUEDE devolver
-- readiness_ok = true con un universo baseline completo (1166 buildings),
-- cobertura 1:1 y seguridad completa; y que se vuelve false en cuanto el
-- baseline o la paridad se rompen (1165 / 1167 / titular perdido /
-- titular duplicado). No toca producción: aborta si la base no es
-- desechable y termina SIEMPRE en ROLLBACK.
-- =====================================================================

DO $$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: fixtures solo en base desechable wave1a_test_*, base actual = %',
      current_database();
  END IF;
END $$;

BEGIN;

-- Universo vacío: readiness SIEMPRE false.
DO $$
DECLARE d jsonb;
BEGIN
  d := public.p0_property_rights_dry_run();
  ASSERT (d ->> 'readiness_ok')::boolean IS FALSE,
    'universo vacío nunca puede declararse preparado';
  RAISE NOTICE 'CASO OK · vacío => readiness_ok=false';
END $$;

-- ---------------------------------------------------------------------
-- Baseline EXACTO: 1166 edificios (1165 de relleno + 1 con nota segura).
-- ---------------------------------------------------------------------
INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal)
SELECT ('b0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid,
       'Relleno ' || g, 'Madrid', false
FROM generate_series(1, 1165) g;

INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal) VALUES
  ('b1166666-0000-0000-0000-000000001166', 'Baseline seguro', 'Madrid', false);

INSERT INTO public.owners (id, nombre, metadatos) VALUES
  ('b1166666-0000-0000-0000-0000000000o1'::text::uuid, 'ROSA VEGA',
   '{"dni__nif__cif":"00000010C"}'::jsonb);

INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
  ('b1166666-0000-0000-0000-0000000000a1',
   'b1166666-0000-0000-0000-000000001166', 'listo',
   '{"fecha_nota":"2026-01-10","titulares":[{"nombre":"ROSA VEGA","derecho":"pleno dominio","porcentaje":"100 %","cita":"ROSA VEGA es titular del 100 % del pleno dominio"}]}'::jsonb,
   'ROSA VEGA es titular del 100 % del pleno dominio de la finca.');

INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('b1166666-0000-0000-0000-0000000000b1', 'b1166666-0000-0000-0000-0000000000a1',
   'ROSA VEGA', '00000010C', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ROSA VEGA es titular del 100 % del pleno dominio","pagina":"1","offset":"0","ruta":"$.titulares[0]"}'::jsonb);

-- ---------------------------------------------------------------------
-- POSITIVO: readiness_ok = true con baseline 1166 y cobertura 1:1.
-- ---------------------------------------------------------------------
DO $$
DECLARE d jsonb;
BEGIN
  d := public.p0_property_rights_dry_run();
  ASSERT (SELECT count(*) FROM public.buildings) = 1166, 'el fixture debe dejar exactamente 1166 edificios';
  ASSERT (d -> 'baseline' ->> 'buildings_universo')::int = 1166, 'baseline declara 1166';
  ASSERT (d -> 'baseline' ->> 'buildings_ok')::boolean, 'baseline buildings_ok';
  ASSERT (d -> 'baseline' ->> 'cobertura_1a1')::boolean, 'cobertura 1:1';
  ASSERT (d ->> 'source_titulares')::int = 1, 'un titular fuente';
  ASSERT (d ->> 'safety_invariants_ok')::boolean, 'seguridad completa';
  ASSERT (d ->> 'readiness_ok')::boolean,
    'READINESS POSITIVO: baseline completo + cobertura 1:1 + cero bloqueos => true. Dry-run: ' || d::text;
  RAISE NOTICE 'CASO OK · baseline 1166 completo => readiness_ok=true';
END $$;

-- ---------------------------------------------------------------------
-- NEGATIVOS: cualquier desviación del baseline o de la paridad => false.
-- ---------------------------------------------------------------------
SAVEPOINT sp_1165;
DELETE FROM public.buildings WHERE id = 'b0000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.buildings) = 1165, '1165 edificios';
  ASSERT (public.p0_property_rights_dry_run() ->> 'readiness_ok')::boolean IS FALSE,
    '1165 edificios => readiness_ok=false';
  RAISE NOTICE 'CASO OK · 1165 => readiness_ok=false';
END $$;
ROLLBACK TO SAVEPOINT sp_1165;

SAVEPOINT sp_1167;
INSERT INTO public.buildings (id, direccion, ciudad, division_horizontal) VALUES
  ('b0000000-0000-0000-0000-000000009999', 'Relleno extra', 'Madrid', false);
DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.buildings) = 1167, '1167 edificios';
  ASSERT (public.p0_property_rights_dry_run() ->> 'readiness_ok')::boolean IS FALSE,
    '1167 edificios => readiness_ok=false';
  RAISE NOTICE 'CASO OK · 1167 => readiness_ok=false';
END $$;
ROLLBACK TO SAVEPOINT sp_1167;

SAVEPOINT sp_sin_titular;
DELETE FROM public.nota_simple_titulares WHERE id = 'b1166666-0000-0000-0000-0000000000b1';
DO $$
BEGIN
  ASSERT (public.p0_property_rights_dry_run() ->> 'readiness_ok')::boolean IS FALSE,
    'perder el titular (nota lista sin titulares) => readiness_ok=false';
  RAISE NOTICE 'CASO OK · titular perdido => readiness_ok=false';
END $$;
ROLLBACK TO SAVEPOINT sp_sin_titular;

SAVEPOINT sp_duplicado;
INSERT INTO public.nota_simple_titulares
  (id, nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
  ('b1166666-0000-0000-0000-0000000000b2', 'b1166666-0000-0000-0000-0000000000a1',
   'ROSA VEGA', '00000010C', 100, 'pleno', '{"rol_literal":"pleno dominio"}'::jsonb,
   '{"cita":"ROSA VEGA es titular del 100 % del pleno dominio","pagina":"1","offset":"0","ruta":"$.titulares[0]"}'::jsonb);
DO $$
BEGIN
  ASSERT (public.p0_property_rights_dry_run() ->> 'readiness_ok')::boolean IS FALSE,
    'titular duplicado (200 % / identidad repetida) => readiness_ok=false';
  RAISE NOTICE 'CASO OK · titular duplicado => readiness_ok=false';
END $$;
ROLLBACK TO SAVEPOINT sp_duplicado;

-- El fixture no puede sobrevivir a la suite.
ROLLBACK;

DO $$
BEGIN
  ASSERT (SELECT count(*) FROM public.buildings) = 0,
    'ROLLBACK incompleto: el fixture de readiness ha persistido edificios';
  RAISE NOTICE 'WAVE 1A.3 P0.5 · readiness positivo: revertido, cero DML persistido';
END $$;
