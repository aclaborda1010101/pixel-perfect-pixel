
-- 1) Nº de fincas registrales con titulares por edificio (para explicar sumas < 100)
CREATE OR REPLACE VIEW public.v_building_fincas
WITH (security_invoker = on) AS
SELECT n.building_id,
       count(DISTINCT n.id)::int AS n_fincas
FROM public.notas_simples n
WHERE n.building_id IS NOT NULL
  AND COALESCE(n.status, 'listo') = 'listo'
  AND EXISTS (
    SELECT 1 FROM public.nota_simple_titulares t
    WHERE t.nota_simple_id = n.id AND t.porcentaje IS NOT NULL AND t.porcentaje > 0
  )
GROUP BY n.building_id;

GRANT SELECT ON public.v_building_fincas TO authenticated;

-- 2) Influenciadores: asociado al edificio, sin derecho en la nota y sin cuota en el CRM
CREATE OR REPLACE FUNCTION public.recalcular_influenciadores(p_building_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_marcados int := 0;
  v_desmarcados int := 0;
BEGIN
  WITH objetivo AS (
    SELECT v.building_id,
           v.owner_id,
           (v.pct_origen IN ('sin_derecho_en_nota', 'sin_cuota_crm')) AS debe,
           COALESCE(o.metadatos ->> 'tipologia_de_propietario', '') LIKE 'T8%' AS t8
    FROM public.v_owner_score v
    JOIN public.owners o ON o.id = v.owner_id
    WHERE p_building_id IS NULL OR v.building_id = p_building_id
  ), upd AS (
    UPDATE public.building_owners bo
    SET es_influencer = obj.debe,
        influencer_reason = CASE
          WHEN obj.debe AND obj.t8 THEN 'Sin derecho en la nota ni cuota en el CRM; marcado como influenciador en HubSpot'
          WHEN obj.debe THEN 'Sin derecho en la nota ni cuota en el CRM'
          ELSE bo.influencer_reason
        END
    FROM objetivo obj
    WHERE bo.building_id = obj.building_id
      AND bo.owner_id = obj.owner_id
      AND bo.es_influencer IS DISTINCT FROM obj.debe
    RETURNING obj.debe
  )
  SELECT count(*) FILTER (WHERE debe), count(*) FILTER (WHERE NOT debe)
  INTO v_marcados, v_desmarcados
  FROM upd;

  RETURN jsonb_build_object('marcados', v_marcados, 'desmarcados', v_desmarcados);
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_influenciadores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_influenciadores(uuid) TO authenticated, service_role;

-- 3) Estado de porcentajes: si el CRM valida (suma 100 ±0,75), el edificio queda verificado.
--    Nunca degrada un edificio ya verificado.
CREATE OR REPLACE FUNCTION public.recalcular_porcentajes_estado_crm(p_building_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n int := 0;
BEGIN
  WITH upd AS (
    UPDATE public.buildings b
    SET porcentajes_estado = 'verificado',
        porcentajes_verificado_at = COALESCE(b.porcentajes_verificado_at, now())
    FROM public.v_building_pct_fuente f
    WHERE f.building_id = b.id
      AND f.crm_valido
      AND b.porcentajes_estado IS DISTINCT FROM 'verificado'
      AND (p_building_id IS NULL OR b.id = p_building_id)
    RETURNING b.id
  )
  SELECT count(*) INTO v_n FROM upd;

  RETURN jsonb_build_object('verificados', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_porcentajes_estado_crm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_porcentajes_estado_crm(uuid) TO authenticated, service_role;
