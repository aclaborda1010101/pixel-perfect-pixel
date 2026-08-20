-- 1) Un edificio sin propietarios no puede estar verificado
CREATE OR REPLACE FUNCTION public.trg_verificado_requiere_propietarios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.porcentajes_estado IN ('verificado', 'verificado_pendiente_matching')
     AND NOT EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = NEW.id)
  THEN
    NEW.porcentajes_estado := 'sin_propietarios';
    NEW.porcentajes_verificado_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verificado_requiere_propietarios ON public.buildings;
CREATE TRIGGER trg_verificado_requiere_propietarios
BEFORE INSERT OR UPDATE OF porcentajes_estado ON public.buildings
FOR EACH ROW EXECUTE FUNCTION public.trg_verificado_requiere_propietarios();

-- 2) Auditoría de combinaciones imposibles
CREATE OR REPLACE FUNCTION public.auditar_estados_incoherentes()
RETURNS TABLE(caso text, total bigint, ejemplos uuid[])
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH sumas AS (
    SELECT v.building_id,
           COALESCE(sum(v.pct_propiedad) FILTER (WHERE NOT COALESCE(v.pct_invalido,false)), 0) AS suma
    FROM public.v_owner_score v
    GROUP BY v.building_id
  ),
  casos AS (
    SELECT 'verificado_sin_propietarios'::text AS caso, b.id
    FROM public.buildings b
    WHERE b.porcentajes_estado = 'verificado'
      AND NOT EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = b.id)
    UNION ALL
    SELECT 'verificado_sin_ningun_porcentaje', b.id
    FROM public.buildings b JOIN sumas s ON s.building_id = b.id
    WHERE b.porcentajes_estado = 'verificado' AND s.suma = 0
    UNION ALL
    SELECT 'verificado_suma_mayor_100', b.id
    FROM public.buildings b JOIN sumas s ON s.building_id = b.id
    WHERE b.porcentajes_estado = 'verificado' AND s.suma > 100.75
    UNION ALL
    SELECT 'sin_propietarios_con_propietarios', b.id
    FROM public.buildings b
    WHERE b.porcentajes_estado = 'sin_propietarios'
      AND EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = b.id)
    UNION ALL
    SELECT 'sin_nota_con_notas', b.id
    FROM public.buildings b
    WHERE b.porcentajes_estado = 'sin_nota'
      AND EXISTS (SELECT 1 FROM public.notas_simples n WHERE n.building_id = b.id)
  )
  SELECT caso, count(*)::bigint, (array_agg(id ORDER BY id))[1:5]
  FROM casos GROUP BY caso ORDER BY 2 DESC;
$$;

REVOKE ALL ON FUNCTION public.auditar_estados_incoherentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditar_estados_incoherentes() TO authenticated, service_role;

-- 3) Corrección masiva de estados imposibles
CREATE OR REPLACE FUNCTION public.corregir_estados_incoherentes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sin_prop int := 0;
  v_recuperados int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.buildings b
    SET porcentajes_estado = 'sin_propietarios', porcentajes_verificado_at = NULL
    WHERE b.porcentajes_estado IN ('verificado','verificado_pendiente_matching')
      AND NOT EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = b.id)
    RETURNING b.id
  ) SELECT count(*) INTO v_sin_prop FROM upd;

  WITH upd2 AS (
    UPDATE public.buildings b
    SET porcentajes_estado = 'a_revisar'
    WHERE b.porcentajes_estado = 'sin_propietarios'
      AND EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = b.id)
    RETURNING b.id
  ) SELECT count(*) INTO v_recuperados FROM upd2;

  RETURN jsonb_build_object('marcados_sin_propietarios', v_sin_prop, 'recuperados_a_revisar', v_recuperados);
END;
$$;

REVOKE ALL ON FUNCTION public.corregir_estados_incoherentes() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corregir_estados_incoherentes() TO authenticated, service_role;