-- =====================================================================
-- WAVE 1A.3 P0.5 · WRAPPER E IDEMPOTENCIA DEL DRY-RUN
-- =====================================================================
--  1) p0_rebuild_property_rights('x', false) es JSONB-idéntico al
--     dry-run salvo las claves informativas del wrapper (reason/motivo).
--  2) Dos dry-run consecutivos son idénticos y no mueven un solo byte de
--     rights / owners / buildings / tasks (checksums antes y después).
--  3) p_apply = true aborta con REAL_REBUILD_DISABLED antes de escribir.
-- =====================================================================

DO $$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: solo en base desechable wave1a_test_*, base actual = %',
      current_database();
  END IF;
END $$;

BEGIN;

CREATE TEMP TABLE _chk_before AS
SELECT 'building_property_rights' AS t, md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) AS h
  FROM public.building_property_rights x
UNION ALL SELECT 'building_owners', md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), ''))
  FROM public.building_owners x
UNION ALL SELECT 'buildings', md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), ''))
  FROM public.buildings x
UNION ALL SELECT 'building_tasks', md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), ''))
  FROM public.building_tasks x;

DO $$
DECLARE
  d1 jsonb; d2 jsonb; w jsonb; k text;
BEGIN
  -- (1) Wrapper == dry-run, comparación JSONB EXACTA (no solo applied=false)
  d1 := public.p0_property_rights_dry_run();
  w  := public.p0_rebuild_property_rights('x', false);
  ASSERT (w ->> 'applied')::boolean IS FALSE, 'el wrapper declara applied=false';
  ASSERT (w - 'reason' - 'motivo') = d1,
    'el wrapper debe devolver EXACTAMENTE el dry-run (salvo reason/motivo). wrapper=' || w::text || ' dry_run=' || d1::text;
  FOR k IN SELECT key FROM jsonb_each(d1) LOOP
    ASSERT w -> k = d1 -> k, format('el wrapper altera la clave %s del dry-run', k);
  END LOOP;

  -- (2) Idempotencia: dos dry-run consecutivos, JSONB idéntico
  d2 := public.p0_property_rights_dry_run();
  ASSERT d1 = d2, 'dos dry-run consecutivos deben ser JSONB idénticos';

  -- (3) p_apply = true aborta antes de cualquier escritura
  BEGIN
    PERFORM public.p0_rebuild_property_rights('x', true);
    ASSERT false, 'p_apply=true debía abortar con REAL_REBUILD_DISABLED';
  EXCEPTION WHEN others THEN
    ASSERT SQLERRM LIKE '%REAL_REBUILD_DISABLED%',
      'excepción esperada REAL_REBUILD_DISABLED, recibida: ' || SQLERRM;
  END;
  RAISE NOTICE 'CASO OK · wrapper == dry-run, idempotente y apply deshabilitado';
END $$;

DO $$
DECLARE r record; h_after text;
BEGIN
  FOR r IN SELECT * FROM _chk_before LOOP
    SELECT CASE r.t
      WHEN 'building_property_rights' THEN (SELECT md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.building_property_rights x)
      WHEN 'building_owners'          THEN (SELECT md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.building_owners x)
      WHEN 'buildings'                THEN (SELECT md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.buildings x)
      WHEN 'building_tasks'           THEN (SELECT md5(coalesce(string_agg(x::text, E'\n' ORDER BY x::text), '')) FROM public.building_tasks x)
    END INTO h_after;
    ASSERT h_after = r.h, format('la tabla %s cambió durante el dry-run', r.t);
  END LOOP;
  RAISE NOTICE 'CASO OK · checksums de rights/owners/buildings/tasks idénticos antes y después';
END $$;

ROLLBACK;
