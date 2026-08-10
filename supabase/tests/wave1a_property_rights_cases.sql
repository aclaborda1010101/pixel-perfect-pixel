-- =====================================================================
-- WAVE 1A · Casos de prueba con datos sintéticos
-- SQL NO EJECUTADO. Documenta el comportamiento esperado del staging y del
-- dry-run. Pensado para correr dentro de una transacción con ROLLBACK final.
-- =====================================================================
-- BEGIN;  -- (deliberadamente comentado: este fichero no se ejecuta en esta fase)

-- Convenciones de los identificadores sintéticos:
--   B1 edificio SIN división horizontal   → unit_key = 'building:<B1>'
--   B2 edificio CON división horizontal y clave registral fiable
--   B3 edificio CON división horizontal SIN clave fiable → dh_sin_unidad_registral

/* -------------------------------------------------------------------
 CASO 1 · Titular sin match en CRM (no-match)
 Esperado: owner_id NULL, company_id NULL, review_flag = true,
           feeds_cuota = false, review_reason menciona "sin conciliar",
           la fila EXISTE (1:1, no se descarta).
---------------------------------------------------------------------*/
-- INSERT INTO notas_simples(id, building_id, status, raw_pdf_text, structured_json)
-- VALUES ('11111111-0000-0000-0000-000000000001', :B1, 'listo',
--         'PLENO DOMINIO 100 % a favor de PERSONA INEXISTENTE UNO', '{}'::jsonb);
-- INSERT INTO nota_simple_titulares(nota_simple_id, nombre_extraido, cif_dni, porcentaje, rol, metadatos)
-- VALUES ('11111111-0000-0000-0000-000000000001', 'PERSONA INEXISTENTE UNO', NULL, 100, 'pleno',
--         '{"rol_literal":"pleno dominio"}');
-- EXPECT: SELECT owner_id IS NULL AND company_id IS NULL AND review_flag AND NOT feeds_cuota
--         FROM v_p0_rights_staging WHERE titular_nombre = 'PERSONA INEXISTENTE UNO';  -- true

/* -------------------------------------------------------------------
 CASO 2 · Pleno / nuda / usufructo en la misma nota
 Esperado: 3 filas con right_type distinto; solo la de pleno_dominio puede
           tener feeds_cuota = true; nuda y usufructo NUNCA alimentan cuota.
---------------------------------------------------------------------*/
-- titulares: A (pleno 50), B (nuda_propiedad 50), C (usufructo 50)
-- EXPECT: SELECT right_type, bool_or(feeds_cuota) FROM v_p0_rights_staging
--         WHERE note_simple_id = :N2 GROUP BY right_type;
--         → pleno_dominio: (según evidencia); nuda_propiedad: false; usufructo: false

/* -------------------------------------------------------------------
 CASO 3 · Ganancial
 Esperado: right_type = 'ganancial' (capa separada, NO pleno_dominio),
           review_flag = true, feeds_cuota = false,
           coownership_regime = 'gananciales'.
---------------------------------------------------------------------*/
-- titular: 'JUAN PEREZ Y MARIA LOPEZ (SOCIEDAD CONYUGAL)', rol_literal 'carácter ganancial'
-- EXPECT: right_type = 'ganancial' AND NOT feeds_cuota

/* -------------------------------------------------------------------
 CASO 4 · Rol desconocido
 Esperado: right_type = 'otro' (nunca pleno_dominio), review_flag = true.
---------------------------------------------------------------------*/
-- titular con rol_literal = 'titular' (sin mención de derecho)
-- EXPECT: right_type = 'otro'

/* -------------------------------------------------------------------
 CASO 5 · Dos notas IDÉNTICAS al 100% sobre la misma unidad
 Esperado: misma nota_signature; NO es contradicción; una sola nota canónica;
           la segunda queda status='superseded', feeds_cuota=false.
           La suma de feeds_cuota de la unidad es 100, no 200.
---------------------------------------------------------------------*/
-- EXPECT: SELECT count(DISTINCT nota_signature) FROM v_p0_rights_staging
--         WHERE ownership_unit_key = 'building:'||:B1;                      -- 1
-- EXPECT: SELECT count(DISTINCT note_simple_id) FILTER (WHERE is_canonical)
--         FROM v_p0_rights_staging WHERE ownership_unit_key = 'building:'||:B1;  -- 1
-- EXPECT: SELECT sum(percentage) FILTER (WHERE feeds_cuota)
--         FROM v_p0_rights_staging WHERE ownership_unit_key = 'building:'||:B1;  -- 100
-- EXPECT: (dry_run ->> 'duplicados_identicos')::int >= 1
--         AND (dry_run ->> 'contradicciones')::int = 0

/* -------------------------------------------------------------------
 CASO 6 · Reparto 60/40 frente a 50/50 con los MISMOS titulares
 Esperado: firmas DISTINTAS → contradicción en la unidad;
           ninguna fila de esa unidad alimenta cuota.
---------------------------------------------------------------------*/
-- nota N6a: A 60 / B 40 (pleno). nota N6b: A 50 / B 50 (pleno). Misma unidad.
-- EXPECT: SELECT count(DISTINCT nota_signature) FROM v_p0_rights_staging
--         WHERE ownership_unit_key = 'building:'||:B4;                      -- 2
-- EXPECT: SELECT bool_or(feeds_cuota) FROM v_p0_rights_staging
--         WHERE ownership_unit_key = 'building:'||:B4;                      -- false
-- EXPECT: (dry_run ->> 'contradicciones')::int >= 1

/* -------------------------------------------------------------------
 CASO 7 · División horizontal SIN clave registral fiable
 Esperado: ownership_unit_key IS NULL,
           unit_block_reason = 'dh_sin_unidad_registral',
           is_canonical = false, feeds_cuota = false, review_flag = true.
           NO se colapsa el edificio entero en una única unidad.
---------------------------------------------------------------------*/
-- buildings.division_horizontal = true para :B3 y structured_json sin finca/IDUFIR/refcat
-- EXPECT: SELECT ownership_unit_key IS NULL
--                AND unit_block_reason = 'dh_sin_unidad_registral'
--                AND NOT feeds_cuota
--         FROM v_p0_rights_staging WHERE building_id = :B3;                 -- true

/* -------------------------------------------------------------------
 CASO 8 · División horizontal CON clave fiable
 Esperado: unit_key = 'dh:<building>:<clave normalizada>' y una canónica por
           unidad (no una por edificio).
---------------------------------------------------------------------*/
-- structured_json = '{"finca_registral":"12.345"}' → 'dh:<B2>:12345'

/* -------------------------------------------------------------------
 CASO 9 · Evidencia insuficiente (solo el nombre en la cita)
 Esperado: evidence_ok = false, review_flag = true, feeds_cuota = false,
           aunque el titular esté correctamente identificado por DNI.
---------------------------------------------------------------------*/
-- raw_pdf_text = 'Comparece ANA GARCIA SOTO ante el registrador.'  (sin derecho ni %)
-- EXPECT: NOT evidence_ok AND NOT feeds_cuota

/* -------------------------------------------------------------------
 CASO 10 · Evidencia por structured_json trazable
 Esperado: evidence_ok = true sin cita literal, si el titular trae derecho,
           porcentaje y página/ruta.
---------------------------------------------------------------------*/
-- structured_json = '{"titulares":[{"nombre":"ANA GARCIA SOTO","derecho":"pleno dominio",
--                    "porcentaje":100,"pagina":2}]}'
-- EXPECT: evidence_ok  -- true

/* -------------------------------------------------------------------
 INVARIANTES GLOBALES (dry-run, sin escrituras)
---------------------------------------------------------------------*/
-- SELECT public.p0_property_rights_dry_run();
-- EXPECT: paridad_1a1 = true
-- EXPECT: invariants ->> 'titular_unico' = 'true'
-- EXPECT: invariants ->> 'sin_mezcla_owner_company' = 'true'
-- EXPECT: invariants ->> 'ningun_unmatched_alimenta_cuota' = 'true'
-- EXPECT: invariants ->> 'solo_pleno_alimenta_cuota' = 'true'
-- EXPECT: invariants ->> 'max_una_canonica_por_unidad' = 'true'
-- EXPECT: invariants ->> 'contradiccion_no_alimenta_cuota' = 'true'

-- El rebuild por defecto NO escribe:
-- SELECT (public.p0_rebuild_property_rights('test') ->> 'applied')::boolean;  -- false

-- ROLLBACK;