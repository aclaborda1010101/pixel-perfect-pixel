-- WAVE 1A.3 P0.5 · CATÁLOGO DE identity_match
-- Un único CHECK vivo y cobertura exacta del vocabulario emitido por staging.
DO $$
DECLARE n int; faltan text;
BEGIN
  SELECT count(*) INTO n FROM pg_constraint
   WHERE conrelid = 'public.building_property_rights'::regclass
     AND contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%identity_match%';
  ASSERT n = 1, format('debe haber EXACTAMENTE un CHECK de identity_match, hay %s', n);

  ASSERT NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_property_rights'::regclass
      AND conname = 'building_property_rights_identity_match_check'),
    'el CHECK legacy de identity_match debe estar eliminado';

  SELECT string_agg(v, ', ') INTO faltan
  FROM unnest(ARRAY['dni','cif','nombre_exacto','aproximado','ninguno','owner_preexistente',
                    'company_preexistente','ambiguo','conflicto_owner_y_company',
                    'nombre_sociedad_revisable','identity_conflict']) v
  WHERE pg_get_constraintdef((SELECT oid FROM pg_constraint
          WHERE conrelid='public.building_property_rights'::regclass AND contype='c'
            AND pg_get_constraintdef(oid) ILIKE '%identity_match%')) NOT LIKE '%''' || v || '''%';
  ASSERT faltan IS NULL, 'el vocabulario vigente no cubre: ' || faltan;
  RAISE NOTICE 'CASO OK · vocabulario identity_match único y completo (incluye identity_conflict)';
END $$;
