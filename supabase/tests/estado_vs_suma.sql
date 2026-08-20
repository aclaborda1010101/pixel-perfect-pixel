-- Regresión: el estado de propiedad de un edificio NUNCA puede contradecir
-- su suma de porcentajes. La regla única vive en v_building_estado_calculado.
DO $$
DECLARE n int; ejemplo text;
BEGIN
  SELECT count(*) INTO n
  FROM public.buildings b
  JOIN public.v_building_estado_calculado c ON c.building_id = b.id
  WHERE b.porcentajes_estado IS DISTINCT FROM c.estado_calculado;

  IF n > 0 THEN
    SELECT string_agg(x.t, ' | ') INTO ejemplo FROM (
      SELECT b.direccion || ': ' || b.porcentajes_estado || ' vs ' || c.estado_calculado
             || ' (suma ' || c.suma || ')' AS t
      FROM public.buildings b
      JOIN public.v_building_estado_calculado c ON c.building_id = b.id
      WHERE b.porcentajes_estado IS DISTINCT FROM c.estado_calculado
      LIMIT 5
    ) x;
    RAISE EXCEPTION 'FAIL: % edificios con estado que contradice su suma. Ej: %', n, ejemplo;
  END IF;
  RAISE NOTICE 'PASS: ningun edificio contradice su suma de propiedad';
END $$;