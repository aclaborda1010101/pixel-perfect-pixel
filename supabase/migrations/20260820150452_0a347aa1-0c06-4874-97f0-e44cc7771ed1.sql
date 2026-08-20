
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
  WITH base AS (
    SELECT v.building_id,
           v.owner_id,
           v.pct_propiedad,
           v.pct_origen,
           lower(COALESCE(v.derecho_crm, '')) AS d,
           COALESCE(o.metadatos ->> 'tipologia_de_propietario', '') LIKE 'T8%' AS t8
    FROM public.v_owner_score v
    JOIN public.owners o ON o.id = v.owner_id
    WHERE p_building_id IS NULL OR v.building_id = p_building_id
  ), objetivo AS (
    SELECT b.building_id, b.owner_id, b.t8, b.d,
      (
        -- HubSpot manda: familiar o "no corresponde" => influenciador
        b.d LIKE '%familiar%' OR b.d LIKE '%no corresponde%'
        OR (
          -- sin cuota de propiedad y sin ningún derecho reconocido
          b.pct_propiedad IS NULL
          AND b.d NOT LIKE '%usufructo%'
          AND b.d NOT LIKE '%pleno%'
          AND b.d NOT LIKE '%nuda%'
          AND b.pct_origen IN ('sin_derecho_en_nota','sin_cuota_crm','sin_derecho_crm','desconocido')
        )
      ) AS debe
    FROM base b
  ), upd AS (
    UPDATE public.building_owners bo
    SET es_influencer = obj.debe,
        influencer_reason = CASE
          WHEN obj.debe AND (obj.d LIKE '%familiar%' OR obj.d LIKE '%no corresponde%')
            THEN 'HubSpot marca su tipo de derecho como ' || obj.d
          WHEN obj.debe AND obj.t8
            THEN 'Sin derecho en la nota ni cuota en el CRM; marcado como influenciador en HubSpot'
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
