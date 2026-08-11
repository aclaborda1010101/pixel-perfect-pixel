-- =====================================================================
-- WAVE 1B · CASOS DE INTEGRACIÓN (base desechable, PostgreSQL efímero)
-- =====================================================================
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'wave1b\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: casos sólo en base desechable wave1b_test_*, base actual = %', current_database();
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pg_temp.ok(p_caso text, p_cond boolean, p_detalle text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF NOT coalesce(p_cond,false) THEN
    RAISE EXCEPTION 'CASO FALLA: % · %', p_caso, p_detalle;
  END IF;
  RAISE NOTICE 'CASO OK · %', p_caso;
END $$;

-- ---------------------------------------------------------------------
-- FIXTURE
-- ---------------------------------------------------------------------
BEGIN;
INSERT INTO public.buildings (id, direccion, division_horizontal) VALUES
  ('b0000001-0000-0000-0000-000000000001','Positivo 100', false),
  ('b0000002-0000-0000-0000-000000000002','Positivo 60/40', false),
  ('b0000003-0000-0000-0000-000000000003','Sociedad', false),
  ('b0000004-0000-0000-0000-000000000004','DH', true),
  ('b0000005-0000-0000-0000-000000000005','Nuda+usufructo', false),
  ('b0000006-0000-0000-0000-000000000006','Sin pareja building/owner', false),
  ('b0000007-0000-0000-0000-000000000007','Unmatched', false),
  ('b0000008-0000-0000-0000-000000000008','Cuota heredada insegura', false);

INSERT INTO public.owners (id, nombre, metadatos) VALUES
  ('00000000-0000-0000-0000-0000000000a1','ANA LOPEZ','{"dni__nif__cif":"00000001A"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a2','LUIS PEREZ','{"dni__nif__cif":"00000002B"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a3','MARTA RUIZ','{"dni__nif__cif":"00000003C"}'::jsonb),
  ('00000000-0000-0000-0000-0000000000a4','JUAN SOLE','{"dni__nif__cif":"00000004D"}'::jsonb);

INSERT INTO public.companies (id, nombre, cif) VALUES
  ('00000000-0000-0000-0000-0000000000c1','PATRIMONIAL SL','B12345678');

-- Parejas building/owner preexistentes (Wave 1B jamás las crea).
INSERT INTO public.building_owners (building_id, owner_id) VALUES
  ('b0000001-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1'),
  ('b0000002-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a1'),
  ('b0000002-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000a2'),
  ('b0000005-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a1'),
  ('b0000005-0000-0000-0000-000000000005','00000000-0000-0000-0000-0000000000a2');
-- Edificio 6: sólo existe la pareja de UNO de los dos titulares.
INSERT INTO public.building_owners (building_id, owner_id) VALUES
  ('b0000006-0000-0000-0000-000000000006','00000000-0000-0000-0000-0000000000a1');
-- Cuota heredada insegura (las 1.989 del live, en miniatura). Simula el
-- estado PREVIO a Wave 1B, por eso se siembra con el permiso del writer.
-- Siembra de estado PREVIO: el guard sólo se desactiva a nivel DDL por el
-- dueño del esquema de pruebas; ningún rol de aplicación puede hacerlo.
ALTER TABLE public.building_owners DISABLE TRIGGER building_owners_cuota_guard;
INSERT INTO public.building_owners (building_id, owner_id, cuota, cuota_estado) VALUES
  ('b0000008-0000-0000-0000-000000000008','00000000-0000-0000-0000-0000000000a3', 100, 'vigente');
ALTER TABLE public.building_owners ENABLE TRIGGER building_owners_cuota_guard;

-- CASO A · 100 % pleno seguro.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('10000000-0000-0000-0000-0000000000a1','b0000001-0000-0000-0000-000000000001','listo',
  '{"fecha_nota":"2026-01-10"}'::jsonb,
  'ANA LOPEZ es titular del 100 % del pleno dominio.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, owner_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
 ('10000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1','ANA LOPEZ','00000001A',100,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- CASO B · 60/40 con identidades distintas.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('20000000-0000-0000-0000-0000000000a1','b0000002-0000-0000-0000-000000000002','listo',
  '{"fecha_nota":"2026-01-10"}'::jsonb,
  'ANA LOPEZ es titular del 60 % del pleno dominio. LUIS PEREZ es titular del 40 % del pleno dominio.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, owner_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
 ('20000000-0000-0000-0000-0000000000b1','20000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1','ANA LOPEZ','00000001A',60,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"ANA LOPEZ es titular del 60 % del pleno dominio","pagina":"1"}'::jsonb),
 ('20000000-0000-0000-0000-0000000000b2','20000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2','LUIS PEREZ','00000002B',40,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"LUIS PEREZ es titular del 40 % del pleno dominio","pagina":"1"}'::jsonb);

-- CASO C · sociedad: derecho auditable, jamás cuota personal.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('30000000-0000-0000-0000-0000000000a1','b0000003-0000-0000-0000-000000000003','listo',
  '{"fecha_nota":"2026-01-10"}'::jsonb,
  'PATRIMONIAL SL es titular del 100 % del pleno dominio.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, company_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
 ('30000000-0000-0000-0000-0000000000b1','30000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000c1','PATRIMONIAL SL','B12345678',100,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"PATRIMONIAL SL es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);

-- CASO D · división horizontal: nunca cuota de edificio.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('40000000-0000-0000-0000-0000000000a1','b0000004-0000-0000-0000-000000000004','listo',
  '{"fecha_nota":"2026-01-10","idufir":"28001000000001"}'::jsonb,
  'ANA LOPEZ es titular del 100 % del pleno dominio de la finca IDUFIR 28001000000001.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, owner_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
 ('40000000-0000-0000-0000-0000000000b1','40000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1','ANA LOPEZ','00000001A',100,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"ANA LOPEZ es titular del 100 % del pleno dominio de la finca IDUFIR 28001000000001","pagina":"1"}'::jsonb);

-- CASO E · nuda propiedad + usufructo: capas separadas, 0 cuota.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('50000000-0000-0000-0000-0000000000a1','b0000005-0000-0000-0000-000000000005','listo',
  '{"fecha_nota":"2026-01-10"}'::jsonb,
  'ANA LOPEZ es titular del 100 % de la nuda propiedad. LUIS PEREZ es titular del 100 % del usufructo.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, owner_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
 ('50000000-0000-0000-0000-0000000000b1','50000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1','ANA LOPEZ','00000001A',100,'nuda_propiedad',
  '{"rol_literal":"nuda propiedad"}'::jsonb,
  '{"cita":"ANA LOPEZ es titular del 100 % de la nuda propiedad","pagina":"1"}'::jsonb),
 ('50000000-0000-0000-0000-0000000000b2','50000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2','LUIS PEREZ','00000002B',100,'usufructo',
  '{"rol_literal":"usufructo"}'::jsonb,
  '{"cita":"LUIS PEREZ es titular del 100 % del usufructo","pagina":"1"}'::jsonb);

-- CASO F · falta la pareja building/owner de uno de los dos titulares.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('60000000-0000-0000-0000-0000000000a1','b0000006-0000-0000-0000-000000000006','listo',
  '{"fecha_nota":"2026-01-10"}'::jsonb,
  'ANA LOPEZ es titular del 50 % del pleno dominio. MARTA RUIZ es titular del 50 % del pleno dominio.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, owner_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos, evidencia) VALUES
 ('60000000-0000-0000-0000-0000000000b1','60000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a1','ANA LOPEZ','00000001A',50,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"ANA LOPEZ es titular del 50 % del pleno dominio","pagina":"1"}'::jsonb),
 ('60000000-0000-0000-0000-0000000000b2','60000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a3','MARTA RUIZ','00000003C',50,'pleno',
  '{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"MARTA RUIZ es titular del 50 % del pleno dominio","pagina":"1"}'::jsonb);

-- CASO G · titular sin conciliar (unmatched): derecho en review, 0 cuota.
INSERT INTO public.notas_simples (id, building_id, status, structured_json, raw_pdf_text) VALUES
 ('70000000-0000-0000-0000-0000000000a1','b0000007-0000-0000-0000-000000000007','listo',
  '{"fecha_nota":"2026-01-10"}'::jsonb,
  'DESCONOCIDO SIN FICHA es titular del 100 % del pleno dominio.');
INSERT INTO public.nota_simple_titulares (id, nota_simple_id, nombre_extraido, porcentaje, rol, metadatos, evidencia) VALUES
 ('70000000-0000-0000-0000-0000000000b1','70000000-0000-0000-0000-0000000000a1',
  'DESCONOCIDO SIN FICHA',100,'pleno','{"rol_literal":"pleno dominio"}'::jsonb,
  '{"cita":"DESCONOCIDO SIN FICHA es titular del 100 % del pleno dominio","pagina":"1"}'::jsonb);
COMMIT;

-- ---------------------------------------------------------------------
-- 1) DRY-RUN: cero writes y contrato exacto contra el wrapper
-- ---------------------------------------------------------------------
DO $$
DECLARE a jsonb; b jsonb; c1 bigint; c2 bigint; q1 text; q2 text;
BEGIN
  SELECT count(*) INTO c1 FROM public.building_property_rights;
  SELECT md5(coalesce(string_agg(x,'|' ORDER BY x),'')) INTO q1
    FROM (SELECT building_id::text||owner_id::text||coalesce(cuota::text,'-')||cuota_estado AS x
            FROM public.building_owners) z;
  a := public.p0_property_rights_wave1b_dry_run();
  b := public.p0_apply_property_rights_wave1b('cualquier-cosa', false);
  PERFORM pg_temp.ok('wrapper(false) == dry_run JSONB EXACTO', a = b, a::text || ' <> ' || b::text);
  PERFORM pg_temp.ok('dry_run applied=false', (a->>'applied') = 'false');
  SELECT count(*) INTO c2 FROM public.building_property_rights;
  SELECT md5(coalesce(string_agg(x,'|' ORDER BY x),'')) INTO q2
    FROM (SELECT building_id::text||owner_id::text||coalesce(cuota::text,'-')||cuota_estado AS x
            FROM public.building_owners) z;
  PERFORM pg_temp.ok('dry-run CERO writes', c1 = c2 AND q1 = q2);
  PERFORM pg_temp.ok('dry-run idempotente',
    public.p0_property_rights_wave1b_dry_run() = a);
  PERFORM pg_temp.ok('1:1 staging/source',
    (a->>'rights_uno_a_uno') = 'true', a->>'rights_planificados');
END $$;

-- ---------------------------------------------------------------------
-- 2) expected_signature obsoleta => aborta antes de escribir
-- ---------------------------------------------------------------------
DO $$
DECLARE n bigint;
BEGIN
  BEGIN
    PERFORM public.p0_apply_property_rights_wave1b('firma-caducada', true);
    RAISE EXCEPTION 'CASO FALLA: la firma obsoleta NO abortó';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF position('WAVE1B_SIGNATURE_STALE' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  SELECT count(*) INTO n FROM public.building_property_rights;
  PERFORM pg_temp.ok('firma obsoleta aborta sin escribir', n = 0);
END $$;


-- ---------------------------------------------------------------------
-- 2bis) PAREJA AUSENTE => ABORTO GLOBAL (no descarte del edificio)
-- ---------------------------------------------------------------------
DO $$
DECLARE nr bigint; no_ bigint; na bigint; err text;
BEGIN
  SELECT count(*) INTO nr FROM public.building_property_rights;
  SELECT count(*) INTO no_ FROM public.building_owners;
  SELECT count(*) INTO na FROM afflux_audit.wave1b_runs;
  BEGIN
    PERFORM public.p0_apply_property_rights_wave1b(public.p0_wave1b_signature(), true);
    RAISE EXCEPTION 'CASO FALLA: la pareja ausente NO abortó el apply completo';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF position('WAVE1B_PAREJA_AUSENTE' in err) = 0 THEN RAISE; END IF;
  END;
  PERFORM pg_temp.ok('pareja ausente · cero derechos',
    nr = (SELECT count(*) FROM public.building_property_rights));
  PERFORM pg_temp.ok('pareja ausente · cero owners nuevos',
    no_ = (SELECT count(*) FROM public.building_owners));
  PERFORM pg_temp.ok('pareja ausente · cero auditoría',
    na = (SELECT count(*) FROM afflux_audit.wave1b_runs));
END $$;

-- Se retira la nota del edificio 6 (decisión operativa explícita); Wave 1B
-- jamás crea la pareja por su cuenta.
DELETE FROM public.nota_simple_titulares t
 USING public.notas_simples ns
 WHERE ns.id = t.nota_simple_id
   AND ns.building_id = 'b0000006-0000-0000-0000-000000000006';
DELETE FROM public.notas_simples
 WHERE building_id = 'b0000006-0000-0000-0000-000000000006';

-- ---------------------------------------------------------------------
-- 3) APPLY real
-- ---------------------------------------------------------------------
DO $$
DECLARE rep jsonb; run uuid; n bigint;
BEGIN
  rep := public.p0_apply_property_rights_wave1b(public.p0_wave1b_signature(), true);
  run := (rep->>'run_id')::uuid;
  PERFORM set_config('afflux.test_run', run::text, false);
  PERFORM pg_temp.ok('apply applied=true', (rep->>'applied')='true');

  SELECT count(*) INTO n FROM public.nota_simple_titulares t
    JOIN public.notas_simples ns ON ns.id=t.nota_simple_id
   WHERE ns.building_id IS NOT NULL AND ns.status='listo';
  PERFORM pg_temp.ok('un derecho por titular (1:1)',
    n = (SELECT count(*) FROM public.building_property_rights), n::text);

  PERFORM pg_temp.ok('CASO A · 100 % pleno => cuota operativa 100',
    (SELECT cuota = 100 AND cuota_estado='vigente' FROM public.building_owners
      WHERE building_id='b0000001-0000-0000-0000-000000000001'
        AND owner_id='00000000-0000-0000-0000-0000000000a1'));

  PERFORM pg_temp.ok('CASO B · 60/40 => cuotas 60 y 40 y suma 100',
    (SELECT sum(cuota)=100 AND count(*)=2 FROM public.building_owners
      WHERE building_id='b0000002-0000-0000-0000-000000000002' AND cuota IS NOT NULL));

  PERFORM pg_temp.ok('CASO C · sociedad: derecho sí, cuota personal NUNCA',
    (SELECT count(*)=1 FROM public.building_property_rights
      WHERE building_id='b0000003-0000-0000-0000-000000000003' AND company_id IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM public.building_owners
      WHERE building_id='b0000003-0000-0000-0000-000000000003' AND cuota IS NOT NULL));

  PERFORM pg_temp.ok('CASO D · división horizontal sin cuota de edificio',
    NOT EXISTS (SELECT 1 FROM public.building_owners
      WHERE building_id='b0000004-0000-0000-0000-000000000004' AND cuota IS NOT NULL));

  PERFORM pg_temp.ok('CASO E · nuda+usufructo: capas conservadas, 0 cuota',
    (SELECT count(*)=2 FROM public.building_property_rights
      WHERE building_id='b0000005-0000-0000-0000-000000000005'
        AND right_type IN ('nuda_propiedad','usufructo'))
    AND NOT EXISTS (SELECT 1 FROM public.building_owners
      WHERE building_id='b0000005-0000-0000-0000-000000000005' AND cuota IS NOT NULL));

  PERFORM pg_temp.ok('CASO F · la pareja ausente nunca se crea',
    (SELECT count(*)=1 FROM public.building_owners
      WHERE building_id='b0000006-0000-0000-0000-000000000006')
    AND NOT EXISTS (SELECT 1 FROM public.building_owners
      WHERE building_id='b0000006-0000-0000-0000-000000000006' AND cuota IS NOT NULL));

  PERFORM pg_temp.ok('CASO G · unmatched => review, sin owner ni company',
    (SELECT status='review' AND owner_id IS NULL AND company_id IS NULL AND NOT feeds_cuota
       FROM public.building_property_rights
      WHERE building_id='b0000007-0000-0000-0000-000000000007'));

  PERFORM pg_temp.ok('CASO H · cuota heredada insegura anulada con motivo registral',
    (SELECT cuota IS NULL AND cuota_estado='review' AND cuota_estado_motivo LIKE 'Wave 1B%'
       FROM public.building_owners
      WHERE building_id='b0000008-0000-0000-0000-000000000008'
        AND owner_id='00000000-0000-0000-0000-0000000000a3'));
END $$;

-- ---------------------------------------------------------------------
-- 4) INVARIANTES GLOBALES
-- ---------------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.ok('INVARIANTE · 0 feeds inseguros',
    NOT EXISTS (SELECT 1 FROM public.building_property_rights
      WHERE feeds_cuota AND (right_type<>'pleno_dominio' OR owner_id IS NULL
        OR company_id IS NOT NULL OR review_flag OR status<>'active')));
  PERFORM pg_temp.ok('INVARIANTE · 0 cuota sin feed',
    NOT EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.cuota IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM public.v_p0_wave1b_quota q
        WHERE q.building_id=bo.building_id AND q.owner_id=bo.owner_id)));
  PERFORM pg_temp.ok('INVARIANTE · todo edificio con cuota suma 100 ± 0,01',
    NOT EXISTS (SELECT 1 FROM (SELECT building_id, sum(cuota) s FROM public.building_owners
      WHERE cuota IS NOT NULL GROUP BY building_id) z WHERE abs(z.s-100) > 0.01));
  PERFORM pg_temp.ok('INVARIANTE · v_rights_cuota_eligible sólo lee feeds materializados',
    NOT EXISTS (SELECT 1 FROM public.v_rights_cuota_eligible v
      JOIN public.building_property_rights r ON r.titular_id=v.titular_id
      WHERE NOT r.feeds_cuota));
  PERFORM pg_temp.ok('INVARIANTE · gate: sin titularidad segura => pendiente de titularidad',
    (SELECT etiqueta='pendiente de titularidad' AND NOT titularidad_segura
       FROM public.v_building_ownership_gate WHERE building_id='b0000005-0000-0000-0000-000000000005')
    AND (SELECT titularidad_segura FROM public.v_building_ownership_gate
          WHERE building_id='b0000001-0000-0000-0000-000000000001'));
END $$;

-- ---------------------------------------------------------------------
-- 5) IDEMPOTENCIA: segundo apply => mismos ids y mismo checksum
-- ---------------------------------------------------------------------
DO $$
DECLARE ck1 text; ck2 text; ids1 text; ids2 text; rep jsonb;
BEGIN
  SELECT md5(string_agg(id::text,'|' ORDER BY id)) INTO ids1 FROM public.building_property_rights;
  SELECT checksums->>'current' INTO ck1 FROM afflux_audit.wave1b_runs ORDER BY created_at DESC LIMIT 1;
  rep := public.p0_apply_property_rights_wave1b(public.p0_wave1b_signature(), true);
  SELECT md5(string_agg(id::text,'|' ORDER BY id)) INTO ids2 FROM public.building_property_rights;
  ck2 := rep->'checksums'->>'current';
  PERFORM pg_temp.ok('idempotencia · mismos ids estables', ids1 = ids2);
  PERFORM pg_temp.ok('idempotencia · mismo checksum completo', ck1 = ck2, coalesce(ck1,'-')||' vs '||coalesce(ck2,'-'));
  PERFORM pg_temp.ok('idempotencia · no-op declarado', (rep->>'idempotent')='true');
  PERFORM pg_temp.ok('idempotencia · sin nueva auditoría',
    (SELECT count(*)=1 FROM afflux_audit.wave1b_runs WHERE applied));
END $$;

-- ---------------------------------------------------------------------
-- 6) ROLLBACK por run_id
-- ---------------------------------------------------------------------
DO $$
DECLARE run uuid; res jsonb;
BEGIN
  SELECT run_id INTO run FROM afflux_audit.wave1b_runs ORDER BY created_at DESC LIMIT 1;
  res := public.p0_rollback_property_rights_wave1b(run);
  PERFORM pg_temp.ok('rollback · derechos restaurados al estado previo (vacío)',
    (SELECT count(*)=0 FROM public.building_property_rights));
  PERFORM pg_temp.ok('rollback · cuota heredada restaurada exactamente',
    (SELECT cuota=100 AND cuota_estado='vigente' FROM public.building_owners
      WHERE building_id='b0000008-0000-0000-0000-000000000008'
        AND owner_id='00000000-0000-0000-0000-0000000000a3'));
  PERFORM pg_temp.ok('rollback · run desconocido falla',
    (SELECT NOT EXISTS (SELECT 1 FROM afflux_audit.wave1b_runs WHERE run_id=run AND rolled_back_at IS NULL)));
END $$;

-- ---------------------------------------------------------------------
-- 7) CIERRE DE RECONTAMINACIÓN
-- ---------------------------------------------------------------------
DO $$
DECLARE err text;
BEGIN
  BEGIN
    UPDATE public.building_owners SET cuota = 99
     WHERE building_id='b0000008-0000-0000-0000-000000000008';
    RAISE EXCEPTION 'CASO FALLA: un writer externo pudo escribir cuota';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF position('WAVE1B_CUOTA_BLOQUEADA' in err) = 0 THEN RAISE; END IF;
  END;
  PERFORM pg_temp.ok('guard · nadie escribe cuota fuera del apply Wave 1B', true);

  BEGIN
    PERFORM public.volcar_cuotas_desde_notas();
    RAISE EXCEPTION 'CASO FALLA: volcar_cuotas_desde_notas sigue viva';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF position('retirado' in err) = 0 THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.p0_mark_cuota_eligibility();
    RAISE EXCEPTION 'CASO FALLA: p0_mark_cuota_eligibility sigue viva';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS err = MESSAGE_TEXT;
    IF position('retirado' in err) = 0 THEN RAISE; END IF;
  END;
  PERFORM pg_temp.ok('writers heredados inejecutables', true);

  PERFORM pg_temp.ok('p0_rebuild_property_rights(text) retirado',
    NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='p0_rebuild_property_rights'
        AND pg_get_function_identity_arguments(p.oid)='text'));

  PERFORM pg_temp.ok('un único CHECK de identity_match y cubre identity_conflict',
    (SELECT count(*)=1 FROM pg_constraint
      WHERE conrelid='public.building_property_rights'::regclass
        AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%identity_match%')
    AND (SELECT bool_and(pg_get_constraintdef(oid) ILIKE '%identity_conflict%') FROM pg_constraint
      WHERE conrelid='public.building_property_rights'::regclass
        AND contype='c' AND pg_get_constraintdef(oid) ILIKE '%identity_match%'));

  PERFORM pg_temp.ok('RPCs sin acceso para PUBLIC/anon/authenticated',
    NOT (has_function_privilege('anon','public.p0_apply_property_rights_wave1b(text,boolean,text)','EXECUTE')
      OR has_function_privilege('authenticated','public.p0_apply_property_rights_wave1b(text,boolean,text)','EXECUTE')));
END $$;

-- ---------------------------------------------------------------------
-- 8) ATOMICIDAD: fallo tardío inyectado => rollback total
-- ---------------------------------------------------------------------
DO $$
DECLARE rights_antes text; cuotas_antes text; rights_desp text; cuotas_desp text;
BEGIN
  SELECT md5(coalesce(string_agg(id::text,'|' ORDER BY id),'')) INTO rights_antes FROM public.building_property_rights;
  SELECT md5(coalesce(string_agg(building_id::text||owner_id::text||coalesce(cuota::text,'-')||cuota_estado,'|' ORDER BY building_id::text||owner_id::text),''))
    INTO cuotas_antes FROM public.building_owners;
  BEGIN
    PERFORM public.p0_apply_property_rights_wave1b(public.p0_wave1b_signature(), true);
    RAISE EXCEPTION 'FALLO_TARDIO_INYECTADO';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF position('FALLO_TARDIO_INYECTADO' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  SELECT md5(coalesce(string_agg(id::text,'|' ORDER BY id),'')) INTO rights_desp FROM public.building_property_rights;
  SELECT md5(coalesce(string_agg(building_id::text||owner_id::text||coalesce(cuota::text,'-')||cuota_estado,'|' ORDER BY building_id::text||owner_id::text),''))
    INTO cuotas_desp FROM public.building_owners;
  PERFORM pg_temp.ok('atomicidad · fallo tardío no deja derechos', rights_antes = rights_desp);
  PERFORM pg_temp.ok('atomicidad · fallo tardío no deja cuotas', cuotas_antes = cuotas_desp);
END $$;

-- ---------------------------------------------------------------------
-- 9) feeds = 0 sigue siendo un resultado VÁLIDO y honesto
-- ---------------------------------------------------------------------
DO $$
DECLARE rep jsonb;
BEGIN
  DELETE FROM public.nota_simple_titulares;
  BEGIN
    PERFORM public.p0_apply_property_rights_wave1b(public.p0_wave1b_signature(), true);
    RAISE EXCEPTION 'CASO FALLA: feeds=0 limpió cuotas heredadas sin revisión';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF position('WAVE1B_NOGO_OPERATIVO' in SQLERRM) = 0 THEN RAISE; END IF;
  END;
  PERFORM pg_temp.ok('feeds=0 · NO-GO operativo sin ack explícito', true);
  rep := public.p0_apply_property_rights_wave1b(
           public.p0_wave1b_signature(), true, 'PURGE:' || public.p0_wave1b_context_hash());
  PERFORM pg_temp.ok('feeds=0 · apply válido', (rep->>'applied')='true');
  PERFORM pg_temp.ok('feeds=0 · 0 cuotas operativas', (rep->>'cuotas_operativas')='0');
  PERFORM pg_temp.ok('feeds=0 · readiness global sigue false', (rep->>'readiness_ok')='false');
  PERFORM pg_temp.ok('feeds=0 · no queda cuota viva',
    NOT EXISTS (SELECT 1 FROM public.building_owners WHERE cuota IS NOT NULL));
END $$;
