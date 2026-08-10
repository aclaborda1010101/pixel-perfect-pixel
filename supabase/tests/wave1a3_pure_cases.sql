-- =====================================================================
-- WAVE 1A.3 · CASOS PUROS (sin DML sobre public)
-- =====================================================================
-- Este fichero SOLO ejecuta SELECT sobre helpers deterministas p0_*.
-- No inserta, actualiza ni borra NADA en el esquema public. Puede
-- ejecutarse en una base desechable creada por el runner de integración.
-- =====================================================================

DO $$
BEGIN
  -- ---------------- FECHAS: patrón completo, basura rechazada ----------
  ASSERT public.p0_parse_fecha_registral('2026-02-01') = DATE '2026-02-01', 'ISO válida';
  ASSERT public.p0_parse_fecha_registral('01/02/2026') = DATE '2026-02-01', 'DD/MM/YYYY válida';
  ASSERT public.p0_parse_fecha_registral('01/02/2026 finca 1/2') IS NULL, 'texto extra => NULL';
  ASSERT public.p0_parse_fecha_registral('finca 1') IS NULL, 'finca no es fecha';
  ASSERT public.p0_parse_fecha_registral('32/13/2026') IS NULL, 'fecha imposible => NULL';
  ASSERT public.p0_parse_fecha_registral('foo') IS NULL, 'basura => NULL';

  -- Primera fuente inválida + segunda válida => se usa la válida.
  ASSERT public.p0_nota_fecha_registral('{"fecha_emision_nota":"basura","fecha_nota":"2026-02-01"}'::jsonb)
         = DATE '2026-02-01', 'basura no contamina a la fuente válida';
  ASSERT NOT public.p0_nota_date_conflict('{"fecha_emision_nota":"basura","fecha_nota":"2026-02-01"}'::jsonb),
         'una sola fecha válida no es conflicto';

  -- Dos fechas válidas distintas => conflicto y fecha efectiva NULL.
  ASSERT public.p0_nota_date_conflict('{"fecha_nota":"2026-02-01","fecha_registral":"2025-01-01"}'::jsonb),
         'dos fechas válidas distintas => date_conflict';
  ASSERT public.p0_nota_fecha_registral('{"fecha_nota":"2026-02-01","fecha_registral":"2025-01-01"}'::jsonb) IS NULL,
         'conflicto => sin fecha efectiva';
  ASSERT NOT public.p0_nota_date_conflict('{"fecha_nota":"2026-02-01","fecha_registral":"01/02/2026"}'::jsonb),
         'misma fecha en dos formatos no es conflicto';

  -- ---------------- PORCENTAJES / FRACCIONES ---------------------------
  ASSERT public.p0_cita_pct_values('titular del 50 % del pleno dominio') @> ARRAY[50]::numeric[],
         '50 % reconocido';
  ASSERT public.p0_cita_pct_values('cincuenta por ciento y 25 por cien') @> ARRAY[25]::numeric[],
         '"por cien" reconocido';
  ASSERT public.p0_cita_pct_values('finca 1/2 del tomo 3') = '{}'::numeric[],
         'fracción desnuda con contexto de finca/tomo rechazada';
  ASSERT public.p0_cita_pct_values('1/2') = '{}'::numeric[],
         'fracción desnuda sin contexto rechazada';
  ASSERT public.p0_cita_pct_values('cuota de 1/2 parte indivisa') @> ARRAY[50]::numeric[],
         'fracción con contexto registral aceptada';
  ASSERT public.p0_cita_pct_values('inscripción de fecha 01/02/2026') = '{}'::numeric[],
         'fecha nunca es porcentaje';
  ASSERT NOT public.p0_frac_contexto_ok('cuota de 1/2 en la finca 12'), 'contexto de finca invalida la fracción';

  -- ---------------- LOCALIZADORES --------------------------------------
  ASSERT public.p0_locator_valid('3', NULL, NULL), 'página 3 válida';
  ASSERT NOT public.p0_locator_valid('0', NULL, NULL), 'página 0 inválida';
  ASSERT NOT public.p0_locator_valid('-1', NULL, NULL), 'página negativa inválida';
  ASSERT NOT public.p0_locator_valid('x', NULL, NULL), 'página "x" inválida';
  ASSERT NOT public.p0_locator_valid(NULL, '-5', NULL), 'offset negativo inválido';
  ASSERT public.p0_locator_valid(NULL, '0', NULL), 'offset 0 válido';
  ASSERT public.p0_locator_valid(NULL, NULL, '$.titulares[0].porcentaje'), 'ruta cerrada válida';
  ASSERT NOT public.p0_locator_valid(NULL, NULL, 'foo bar['), 'ruta abierta inválida';
  ASSERT NOT public.p0_locator_valid(NULL, NULL, ''), 'ruta vacía inválida';

  -- ---------------- UNIDAD REGISTRAL -----------------------------------
  ASSERT public.p0_unit_locator_valid('idufir', '12345678901'), 'IDUFIR válido';
  ASSERT NOT public.p0_unit_locator_valid('idufir', '123'), 'IDUFIR corto inválido';
  ASSERT public.p0_unit_locator_valid('finca', '1234'), 'finca válida';
  ASSERT NOT public.p0_unit_locator_valid('finca', 'FOO'), 'finca no numérica inválida';
  ASSERT public.p0_unit_locator_valid('refcat', '9872023VH5797S0001WX'), 'refcat válida';
  ASSERT NOT public.p0_unit_locator_valid('refcat', '123'), 'refcat corta inválida';

  -- ---------------- DERECHO vs RÉGIMEN ---------------------------------
  ASSERT public.p0_right_type_canonico('pleno', 'pleno dominio') = 'pleno_dominio', 'pleno dominio';
  ASSERT public.p0_right_type_canonico('pleno', 'usufructo') = 'otro', 'conflicto de fuentes => otro';
  ASSERT public.p0_right_type_canonico(NULL, 'ganancial') = 'otro', 'ganancial no es derecho';
  ASSERT public.p0_right_type_canonico(NULL, 'gananciales S.L.') = 'otro', 'nombre no crea derecho';

  -- El NOMBRE nunca determina el régimen.
  ASSERT public.p0_canon_regime(NULL, NULL, NULL, 'GANANCIALES PATRIMONIAL S.L.') = 'desconocido',
         'nombre de sociedad con "Gananciales" NO es régimen ganancial';
  ASSERT public.p0_canon_regime(NULL, 'con carácter ganancial', NULL, NULL) = 'gananciales',
         'literal registral sí determina régimen';
  ASSERT public.p0_regime_conflict(NULL, 'carácter ganancial y privativo', NULL),
         'ganancial + privativo => regime_conflict';
  ASSERT public.p0_canon_regime(NULL, 'carácter ganancial y privativo', NULL, NULL) = 'desconocido',
         'conflicto de régimen no elige ganador';
  ASSERT NOT public.p0_regime_conflict(NULL, 'privativo', NULL), 'un solo candidato no es conflicto';

  -- ---------------- NORMALIZACIÓN TOLERANTE ----------------------------
  ASSERT public.p0_norm_text('  MARÍA   PEDRAZA, 17 ') = 'maria pedraza 17', 'normalización tolerante';
  ASSERT public.p0_norm_text('Bruno  Ayllón 10') = 'bruno ayllon 10', 'acentos y espacios';
  ASSERT public.p0_norm_text('...') IS NULL, 'sin contenido => NULL';

  RAISE NOTICE 'WAVE 1A.3 · casos puros: OK';
END $$;

-- El rebuild real sigue deshabilitado: p_apply=true debe lanzar excepción.
DO $$
DECLARE lanzó boolean := false;
BEGIN
  BEGIN
    PERFORM public.p0_rebuild_property_rights('test', true);
  EXCEPTION WHEN others THEN
    lanzó := (SQLERRM LIKE '%REAL_REBUILD_DISABLED%');
  END;
  ASSERT lanzó, 'p_apply=true debe lanzar REAL_REBUILD_DISABLED_PENDING_DRY_RUN_APPROVAL';
  RAISE NOTICE 'WAVE 1A.3 · rebuild real deshabilitado: OK';
END $$;