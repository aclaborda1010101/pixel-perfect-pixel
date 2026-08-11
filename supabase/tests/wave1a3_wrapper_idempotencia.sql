-- =====================================================================
-- WAVE 1A.3 P0.5 · WRAPPER E IDEMPOTENCIA DEL DRY-RUN
-- =====================================================================
--  1) P0.6: p0_rebuild_property_rights('x', false) es JSONB EXACTAMENTE
--     igual a p0_property_rights_dry_run(). Sin exclusiones, sin restar
--     claves, sin reason/motivo: igualdad estricta w = d1 y misma huella
--     textual jsonb. Cualquier clave extra del wrapper hace FALLAR.
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
  ASSERT w = d1,
    'IGUALDAD ESTRICTA: el wrapper debe devolver EXACTAMENTE el dry-run. wrapper='
    || w::text || ' dry_run=' || d1::text;
  ASSERT w::text = d1::text, 'la huella textual jsonb del wrapper difiere del dry-run';
  ASSERT NOT (w ? 'reason') AND NOT (w ? 'motivo'),
    'el wrapper no puede añadir reason/motivo';
  -- Cero claves extra y cero claves ausentes, en ambos sentidos.
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_object_keys(w) k(key)
                      EXCEPT SELECT key FROM jsonb_object_keys(d1) k2(key)),
    'el wrapper añade claves que el dry-run no tiene';
  ASSERT NOT EXISTS (SELECT 1 FROM jsonb_object_keys(d1) k(key)
                      EXCEPT SELECT key FROM jsonb_object_keys(w) k2(key)),
    'el wrapper omite claves del dry-run';
  FOR k IN SELECT key FROM jsonb_each(d1) LOOP
    ASSERT w -> k = d1 -> k, format('el wrapper altera la clave %s del dry-run', k);
  END LOOP;

  -- p_reason es trazabilidad, no contrato: cambiarlo no cambia el JSONB.
  ASSERT public.p0_rebuild_property_rights('otro-motivo', false) = d1,
    'el JSONB del wrapper no puede depender de p_reason';

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
