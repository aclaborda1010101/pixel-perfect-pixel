-- =====================================================================
-- WAVE 1A.3 P0.5 · FUZZ REAL (PostgreSQL) DE p0_json_path_resolve
-- =====================================================================
-- Contrato: la función es TOTAL. Para CUALQUIER entrada devuelve un jsonb
-- o NULL, y JAMÁS lanza excepción (ni invalid_text_representation por un
-- índice gigante, ni numeric_value_out_of_range, ni nada).
-- Ejecuta cada caso capturando WHEN OTHERS: una sola excepción => FAIL.
-- Sin DML, sin dependencias de datos.
-- =====================================================================

DO $fuzz$
DECLARE
  sj jsonb := '{"titulares":[{"nombre":"A","porcentaje":"100 %"},{"nombre":"B"}],
                "meta":{"n":1},"vacio":[],"escalar":7,"ñ":{"x":1}}'::jsonb;
  rutas text[];
  r text;
  res jsonb;
  n_ok int := 0;
  n_err int := 0;
  primer_error text;
BEGIN
  rutas := ARRAY[
    -- índices límite y desbordes
    '$.titulares[0]', '$.titulares[1]', '$.titulares[2]',
    '$.titulares[2147483646]', '$.titulares[2147483647]',
    '$.titulares[2147483648]', '$.titulares[4294967296]',
    '$.titulares[9223372036854775808]',
    '$.titulares[' || repeat('9', 100)  || ']',
    '$.titulares[' || repeat('9', 1000) || ']',
    '$.titulares[' || repeat('0', 5000) || '1]',
    '$.titulares[' || repeat('1', 100000) || ']',
    -- negativos y signos
    '$.titulares[-1]', '$.titulares[-2147483648]', '$.titulares[+1]',
    '$.titulares[ 1]', '$.titulares[1 ]', '$.titulares[1_0]',
    -- no numéricos / basura sintáctica
    '$.titulares[]', '$.titulares[abc]', '$.titulares[0x10]', '$.titulares[1e3]',
    '$.titulares[0.5]', '$.titulares[NaN]', '$.titulares[Infinity]',
    '$.titulares[[0]]', '$.titulares[0][0]', '$.titulares[0', 'titulares0]',
    -- arrays / claves inexistentes
    '$.no_existe', '$.no_existe[0]', '$.vacio[0]', '$.escalar[0]',
    '$.escalar.nombre', '$.meta[0]', '$.titulares[0].nombre[0]',
    '$.titulares[0].no_existe', '$.titulares[1].porcentaje',
    -- Unicode y bytes raros
    '$.ñ', '$.ñ.x', '$.tîtulares[0]', '$.титулары[0]', '$.名前',
    '$.titulares[０]', '$.titulares[٢]', '$.titulares[' || chr(8236) || '1]',
    '$.' || repeat('ñ', 500), '$.titulares[0].' || repeat('ñ', 500),
    -- vacíos, espacios y raíces
    '', ' ', '$', '$.', '.', '..', '$..titulares', '$.titulares..0',
    -- rutas absurdamente profundas
    '$.' || array_to_string(array(SELECT 'a' FROM generate_series(1, 2000)), '.'),
    repeat('$.titulares[0]', 200)
  ];

  FOREACH r IN ARRAY rutas LOOP
    BEGIN
      res := public.p0_json_path_resolve(sj, r);
      -- valor definido: jsonb o NULL, ambos aceptables
      n_ok := n_ok + 1;
      -- la función también debe ser total con documento NULL y con basura
      PERFORM public.p0_json_path_resolve(NULL::jsonb, r);
      PERFORM public.p0_json_path_resolve('[]'::jsonb, r);
      PERFORM public.p0_json_path_resolve('null'::jsonb, r);
      PERFORM public.p0_json_path_resolve('123'::jsonb, r);
      PERFORM public.p0_ruta_elemento(sj, r);
    EXCEPTION WHEN OTHERS THEN
      n_err := n_err + 1;
      IF primer_error IS NULL THEN
        primer_error := format('ruta=%s sqlstate=%s error=%s', left(r, 80), SQLSTATE, SQLERRM);
      END IF;
    END;
  END LOOP;

  ASSERT n_err = 0,
    format('p0_json_path_resolve NO es total: %s excepciones sobre %s casos. Primera: %s',
           n_err, array_length(rutas, 1), primer_error);

  -- NULL de ruta y de documento
  PERFORM public.p0_json_path_resolve(sj, NULL);
  PERFORM public.p0_json_path_resolve(NULL, NULL);

  RAISE NOTICE 'CASO OK · fuzz p0_json_path_resolve: % rutas, 0 excepciones', n_ok;
END $fuzz$;

-- Fuzz aleatorio masivo: índices y claves generados, misma exigencia.
DO $fuzz2$
DECLARE
  sj jsonb := '{"titulares":[{"nombre":"A"}]}'::jsonb;
  r text; i int; n_err int := 0; primer_error text;
BEGIN
  FOR i IN 1..2000 LOOP
    r := '$.titulares[' || (
      CASE (i % 5)
        WHEN 0 THEN repeat((i % 10)::text, 1 + (i % 300))
        WHEN 1 THEN (2147483647::bigint + i)::text
        WHEN 2 THEN '-' || i::text
        WHEN 3 THEN md5(i::text)
        ELSE chr(191 + (i % 60)) || i::text
      END) || ']';
    BEGIN
      PERFORM public.p0_json_path_resolve(sj, r);
      PERFORM public.p0_safe_int(regexp_replace(r, '^\$\.titulares\[|\]$', '', 'g'));
    EXCEPTION WHEN OTHERS THEN
      n_err := n_err + 1;
      IF primer_error IS NULL THEN
        primer_error := format('ruta=%s sqlstate=%s error=%s', left(r, 80), SQLSTATE, SQLERRM);
      END IF;
    END;
  END LOOP;
  ASSERT n_err = 0,
    format('fuzz aleatorio: %s excepciones. Primera: %s', n_err, primer_error);
  RAISE NOTICE 'CASO OK · fuzz aleatorio 2000 rutas + p0_safe_int: 0 excepciones';
END $fuzz2$;

-- p0_safe_int es total y respeta el rango int4.
DO $safe$
DECLARE v text; n_err int := 0;
BEGIN
  FOREACH v IN ARRAY ARRAY['0','1','2147483647','2147483648','-1','-2147483648',
                           repeat('9', 64), repeat('9', 65), repeat('9', 5000),
                           '', ' ', '  12  ', '007', '1.0', '1e3', 'abc', '٢',
                           '１２３', chr(1)||'1', NULL] LOOP
    BEGIN
      PERFORM public.p0_safe_int(v);
    EXCEPTION WHEN OTHERS THEN n_err := n_err + 1;
    END;
  END LOOP;
  ASSERT n_err = 0, format('p0_safe_int no es total: %s excepciones', n_err);
  ASSERT public.p0_safe_int('2147483647') = 2147483647, 'límite superior válido';
  ASSERT public.p0_safe_int('2147483648') IS NULL, 'desborde int4 => NULL';
  ASSERT public.p0_safe_int('-1') IS NULL, 'negativo => NULL';
  ASSERT public.p0_safe_int(repeat('9', 5000)) IS NULL, 'miles de dígitos => NULL';
  RAISE NOTICE 'CASO OK · p0_safe_int total y acotada a int4 no negativo';
END $safe$;
