
-- ============================================================
-- REGLA ÚNICA DEL ESTADO DE PROPIEDAD DE UN EDIFICIO
-- ============================================================
CREATE OR REPLACE VIEW public.v_building_estado_calculado AS
WITH agg AS (
  SELECT b.id AS building_id,
         COALESCE(sum(v.pct_propiedad) FILTER (WHERE NOT COALESCE(v.pct_invalido,false)), 0)::numeric AS suma,
         count(v.owner_id)::int AS n_personas
  FROM public.buildings b
  LEFT JOIN public.v_owner_score v ON v.building_id = b.id
  GROUP BY b.id
), nota AS (
  SELECT n.building_id,
         count(*) FILTER (WHERE t.owner_id IS NULL)::int AS titulares_sin_ficha,
         count(*)::int AS n_titulares,
         count(DISTINCT n.id)::int AS n_fincas
  FROM public.notas_simples n
  JOIN public.nota_simple_titulares t ON t.nota_simple_id = n.id
  WHERE COALESCE(n.status,'listo') = 'listo' AND n.building_id IS NOT NULL
  GROUP BY n.building_id
)
SELECT a.building_id,
       a.suma,
       a.n_personas,
       COALESCE(nt.titulares_sin_ficha,0) AS titulares_sin_ficha,
       COALESCE(nt.n_titulares,0)         AS n_titulares,
       COALESCE(nt.n_fincas,0)            AS n_fincas,
       CASE
         WHEN a.n_personas = 0 THEN 'sin_propietarios'
         WHEN a.suma = 0 AND COALESCE(nt.n_titulares,0) = 0 THEN 'sin_nota'
         WHEN a.suma BETWEEN 99.25 AND 100.75 AND COALESCE(nt.titulares_sin_ficha,0) > 0
           THEN 'verificado_pendiente_matching'
         WHEN a.suma BETWEEN 99.25 AND 100.75 THEN 'verificado'
         ELSE 'a_revisar'
       END AS estado_calculado
FROM agg a
LEFT JOIN nota nt ON nt.building_id = a.building_id;

GRANT SELECT ON public.v_building_estado_calculado TO authenticated;
GRANT SELECT ON public.v_building_estado_calculado TO service_role;

-- Recálculo canónico -----------------------------------------
CREATE OR REPLACE FUNCTION public.recalcular_porcentajes_estado(p_building_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cambios jsonb;
BEGIN
  WITH upd AS (
    UPDATE public.buildings b
    SET porcentajes_estado = c.estado_calculado,
        porcentajes_verificado_at = CASE
          WHEN c.estado_calculado = 'verificado' THEN COALESCE(b.porcentajes_verificado_at, now())
          ELSE NULL END
    FROM public.v_building_estado_calculado c
    WHERE c.building_id = b.id
      AND b.porcentajes_estado IS DISTINCT FROM c.estado_calculado
      AND (p_building_id IS NULL OR b.id = p_building_id)
    RETURNING b.id, c.estado_calculado AS nuevo
  )
  SELECT jsonb_object_agg(nuevo, n) FROM (
    SELECT nuevo, count(*) AS n FROM upd GROUP BY nuevo
  ) s INTO v_cambios;

  RETURN jsonb_build_object(
    'cambiados', COALESCE(v_cambios, '{}'::jsonb),
    'reparto', (SELECT jsonb_object_agg(porcentajes_estado, n) FROM (
        SELECT porcentajes_estado, count(*) n FROM public.buildings GROUP BY 1) t)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_porcentajes_estado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_porcentajes_estado(uuid) TO authenticated, service_role;

-- Las funciones antiguas delegan en la regla única ------------
CREATE OR REPLACE FUNCTION public.recalcular_porcentajes_estado_crm(p_building_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.recalcular_porcentajes_estado(p_building_id) $$;

CREATE OR REPLACE FUNCTION public.corregir_estados_incoherentes()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$ SELECT public.recalcular_porcentajes_estado(NULL) $$;

-- Auditoría: estado que contradice la suma ---------------------
CREATE OR REPLACE FUNCTION public.auditar_estado_vs_suma()
RETURNS TABLE(building_id uuid, estado text, estado_calculado text, suma numeric)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.porcentajes_estado, c.estado_calculado, c.suma
  FROM public.buildings b
  JOIN public.v_building_estado_calculado c ON c.building_id = b.id
  WHERE b.porcentajes_estado IS DISTINCT FROM c.estado_calculado
$$;

REVOKE ALL ON FUNCTION public.auditar_estado_vs_suma() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auditar_estado_vs_suma() TO authenticated, service_role;
