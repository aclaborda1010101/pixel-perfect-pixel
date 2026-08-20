-- Regresión: la suma visible de porcentajes de propiedad de un edificio
-- NUNCA puede pasar de 100 (±0,75). Si la fuente mezcla varias fincas,
-- la vista debe ocultar los porcentajes y marcar pct_incoherente.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM (
    SELECT v.building_id,
           sum(v.pct_propiedad) FILTER (WHERE NOT coalesce(v.pct_invalido,false)) AS suma
    FROM public.v_owner_score v
    GROUP BY v.building_id
  ) s WHERE s.suma > 100.75;
  IF n > 0 THEN
    RAISE EXCEPTION 'FAIL: % edificios muestran una suma superior a 100 %%', n;
  END IF;
  RAISE NOTICE 'PASS: ningun edificio supera el 100 %%';
END $$;
