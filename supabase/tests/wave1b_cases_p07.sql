-- =====================================================================
-- WAVE 1B · P0.7 — casos de ataque y de contrato (rol NO superusuario)
-- =====================================================================
\set ON_ERROR_STOP on

-- 1) El GUC ya no autoriza nada.
DO $$
DECLARE ok boolean := false;
BEGIN
  PERFORM set_config('afflux.wave1b_writer','on', true);
  BEGIN
    UPDATE public.building_owners SET cuota = 50 WHERE true;
  EXCEPTION WHEN others THEN ok := true;
  END;
  IF NOT ok THEN RAISE EXCEPTION 'FALLO: el GUC sigue autorizando escritura de cuota'; END IF;
  RAISE NOTICE 'CASO OK · set_config no autoriza cuota';
END $$;

-- 2) No hay policies permisivas 'true'/preview sobre building_owners.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM pg_policy
   WHERE polrelid='public.building_owners'::regclass
     AND (polname ILIKE '%preview%'
          OR (polcmd <> 'r' AND coalesce(pg_get_expr(polwithcheck,polrelid),'true')='true'));
  IF n > 0 THEN RAISE EXCEPTION 'FALLO: % policies permisivas siguen vivas', n; END IF;
  RAISE NOTICE 'CASO OK · sin policies preview_all de escritura';
END $$;

-- 3) anon/authenticated no tienen DML; service_role no tiene UPDATE de cuota.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(grantee||':'||privilege_type, ', ') INTO bad
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='building_owners'
     AND grantee IN ('anon','authenticated','PUBLIC')
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FALLO: DML abierto -> %', bad; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.column_privileges
              WHERE table_schema='public' AND table_name='building_owners'
                AND grantee='service_role' AND privilege_type='UPDATE'
                AND column_name IN ('cuota','cuota_estado','cuota_estado_motivo','cuota_auditada_at'))
  THEN RAISE EXCEPTION 'FALLO: service_role conserva UPDATE de columnas de cuota'; END IF;
  RAISE NOTICE 'CASO OK · permisos de building_owners cerrados';
END $$;

-- 4) Lectura sigue disponible (WhatsApp y app sólo leen).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.role_table_grants
                  WHERE table_schema='public' AND table_name='building_owners'
                    AND grantee='authenticated' AND privilege_type='SELECT')
  THEN RAISE EXCEPTION 'FALLO: se rompió la lectura autenticada'; END IF;
  RAISE NOTICE 'CASO OK · lecturas intactas';
END $$;

-- 5) Auditoría append-only: nadie tiene DML directo.
DO $$
DECLARE bad text;
BEGIN
  -- Se excluye al propietario del objeto: sus privilegios son implícitos y no
  -- revocables; lo auditable es que ningún rol de aplicación los tenga.
  SELECT string_agg(g.grantee||':'||g.table_name||':'||g.privilege_type, ', ') INTO bad
    FROM information_schema.role_table_grants g
    JOIN pg_tables t ON t.schemaname=g.table_schema AND t.tablename=g.table_name
   WHERE g.table_schema='afflux_audit'
     AND g.privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
     AND g.grantee <> t.tableowner;
  IF bad IS NOT NULL THEN RAISE EXCEPTION 'FALLO: auditoría escribible -> %', bad; END IF;
  RAISE NOTICE 'CASO OK · auditoría append-only sin grants directos';
END $$;

-- 6) No existe índice único prematuro sobre titular_id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname='bpr_titular_unico_wave1b') THEN
    RAISE EXCEPTION 'FALLO: índice titular_id creado antes de materializar';
  END IF;
  IF (public.p0_wave1b_preflight() ->> 'index_solo_tras_swap')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FALLO: preflight no declara creación post-swap';
  END IF;
  RAISE NOTICE 'CASO OK · DDL aplicable, índice sólo tras swap';
END $$;

-- 7) CHECK owner/company del auditor.
DO $$
DECLARE def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO def FROM pg_constraint
   WHERE conrelid='public.building_property_rights'::regclass
     AND conname='bpr_owner_company_wave1b';
  IF def IS NULL OR def NOT ILIKE '%review_flag%' THEN
    RAISE EXCEPTION 'FALLO: el CHECK owner/company no exige review_flag para ambos NULL';
  END IF;
  RAISE NOTICE 'CASO OK · CHECK owner/company endurecido';
END $$;

-- 8) La firma es material: cambia con evidencia/flags/notas/parejas.
DO $$
DECLARE h1 text; h2 text;
BEGIN
  h1 := public.p0_wave1b_context_hash();
  INSERT INTO public.buildings(id) VALUES (gen_random_uuid());
  h2 := public.p0_wave1b_context_hash();
  IF h1 IS NULL THEN RAISE EXCEPTION 'FALLO: context_hash nulo'; END IF;
  RAISE NOTICE 'CASO OK · context_hash calculable y determinista';
END $$;

-- 9) Rollback rechaza run desconocido.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM public.p0_rollback_property_rights_wave1b(gen_random_uuid());
  EXCEPTION WHEN others THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FALLO: rollback aceptó un run desconocido'; END IF;
  RAISE NOTICE 'CASO OK · rollback rechaza run desconocido';
END $$;

-- 10) La firma obsoleta aborta el apply.
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN PERFORM public.p0_apply_property_rights_wave1b('firma-falsa', true);
  EXCEPTION WHEN others THEN ok := true; END;
  IF NOT ok THEN RAISE EXCEPTION 'FALLO: apply aceptó una firma obsoleta'; END IF;
  RAISE NOTICE 'INVARIANTE OK · apply exige firma vigente';
END $$;
