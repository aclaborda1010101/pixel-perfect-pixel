
-- 1) Reemplazar v_owner_score con cálculo correcto por edificio
CREATE OR REPLACE VIEW public.v_owner_score
WITH (security_invoker = on) AS
WITH ns_per_owner_building AS (
  -- Sumamos pct por (owner, building) a través de TODAS las fincas (notas) y dividimos entre el número total de fincas del edificio.
  -- Esto convierte cuotas por finca (ej. 100% en 1 piso de 3) en cuotas por EDIFICIO (33.3%).
  SELECT
    t.owner_id,
    n.building_id,
    SUM(np.pct) FILTER (WHERE np.pct IS NOT NULL) AS sum_pct,
    bool_or(np.normalizado) AS normalizado,
    bool_and(np.invalido)   AS all_invalid,
    max(np.raw_value)       AS raw_value
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples n ON n.id = t.nota_simple_id
  CROSS JOIN LATERAL public.normalize_pct_propiedad(t.porcentaje::text) np(pct, normalizado, invalido, raw_value)
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL
  GROUP BY t.owner_id, n.building_id
),
ns_fincas_per_building AS (
  SELECT building_id, COUNT(DISTINCT id) AS n_fincas
  FROM public.notas_simples
  WHERE building_id IS NOT NULL AND status = 'listo'
  GROUP BY building_id
),
ns_pct AS (
  SELECT
    p.owner_id,
    p.building_id,
    -- pct por edificio = SUM(pct por finca) / N fincas del edificio
    CASE WHEN COALESCE(f.n_fincas,0) > 0 THEN ROUND(p.sum_pct / f.n_fincas, 2) ELSE NULL END AS pct,
    p.normalizado, p.all_invalid, p.raw_value
  FROM ns_per_owner_building p
  LEFT JOIN ns_fincas_per_building f ON f.building_id = p.building_id
),
pct_resolved AS (
  SELECT
    bo_1.owner_id,
    bo_1.building_id,
    CASE
      WHEN np.pct IS NOT NULL THEN np.pct
      WHEN hs.pct IS NOT NULL THEN hs.pct
      ELSE NULL::numeric
    END AS pct_propiedad,
    CASE
      WHEN np.pct IS NOT NULL THEN 'nota_simple'::text
      WHEN hs.pct IS NOT NULL THEN 'building_owners'::text
      ELSE 'desconocido'::text
    END AS pct_origen,
    CASE
      WHEN np.pct IS NOT NULL THEN COALESCE(np.normalizado, false)
      WHEN hs.pct IS NOT NULL THEN hs.normalizado
      ELSE false
    END AS pct_normalizado,
    CASE
      WHEN np.pct IS NULL AND hs.pct IS NULL
       AND (COALESCE(np.all_invalid, false) OR COALESCE(hs.invalido, false)) THEN true
      ELSE false
    END AS pct_invalido,
    COALESCE(np.raw_value, hs.raw_value) AS pct_raw
  FROM public.building_owners bo_1
  JOIN public.owners o_1 ON o_1.id = bo_1.owner_id
  LEFT JOIN ns_pct np ON np.owner_id = bo_1.owner_id AND np.building_id = bo_1.building_id
  LEFT JOIN LATERAL public.normalize_pct_propiedad(bo_1.cuota::text) hs(pct, normalizado, invalido, raw_value) ON true
)
SELECT
  o.id AS owner_id,
  o.nombre, o.telefono, o.email, o.rol,
  bo.building_id, bo.subrole, bo.rol_notas,
  bo.es_influencer, bo.influencer_score, bo.influencer_reason,
  o.metadatos,
  pr.pct_propiedad, pr.pct_origen, pr.pct_normalizado, pr.pct_invalido, pr.pct_raw,
  COALESCE(lc.calls_count, 0) AS contactos_previos,
  lc.last_call_at,
  round((0.30 *
      CASE WHEN pr.pct_propiedad IS NULL THEN 0::numeric
           ELSE 1.0 - LEAST(1.0, pr.pct_propiedad / 100.0) END
      + 0.25 *
      CASE WHEN pr.pct_propiedad IS NULL THEN 0::numeric
           ELSE LEAST(1.0, pr.pct_propiedad / 100.0) END
      + 0.20 * LEAST(1.0, COALESCE(lc.calls_count, 0)::numeric / 5.0)
      + 0.15 * CASE WHEN o.rol = 'desconocido'::owner_role THEN 0 ELSE 1 END::numeric
      + 0.10 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END::numeric
  ) * 100::numeric, 1) AS score
FROM public.owners o
JOIN public.building_owners bo ON bo.owner_id = o.id
LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
LEFT JOIN public.v_owner_last_contact lc ON lc.owner_id = o.id
WHERE o.merged_into IS NULL;

-- 2) Ajuste de la función de auditoría: añade estado "sin_nota_simple"
CREATE OR REPLACE FUNCTION public.recompute_building_owner_metrics(p_building_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_updated int := 0;
  v_inconsistente int := 0;
BEGIN
  WITH ids AS (
    SELECT b.id FROM public.buildings b
    WHERE p_building_ids IS NULL OR b.id = ANY(p_building_ids)
  ),
  base AS (
    SELECT vo.building_id, vo.owner_id, vo.pct_propiedad, vo.pct_origen
    FROM public.v_owner_score vo
    JOIN public.building_owners bo
      ON bo.building_id = vo.building_id AND bo.owner_id = vo.owner_id
    WHERE vo.building_id IN (SELECT id FROM ids)
  ),
  dedup AS (
    SELECT building_id, owner_id, MAX(pct_propiedad) AS pct, MAX(pct_origen) AS origen
    FROM base
    GROUP BY building_id, owner_id
  ),
  sums AS (
    SELECT building_id,
           COUNT(*) AS n_owners_unicos,
           ROUND(SUM(COALESCE(pct,0))::numeric, 2) AS sum_pct,
           bool_or(origen = 'nota_simple') AS has_nota
    FROM dedup
    GROUP BY building_id
  ),
  upd AS (
    UPDATE public.building_analysis ba
    SET metricas_extra = COALESCE(ba.metricas_extra,'{}'::jsonb)
      || jsonb_build_object(
           'owners_unicos_post_dedup', s.n_owners_unicos,
           'pct_propiedad_sum', s.sum_pct,
           'pct_propiedad_estado',
              CASE
                WHEN NOT s.has_nota AND s.sum_pct > 0 THEN 'sin_nota_simple'
                WHEN s.sum_pct BETWEEN 95 AND 105 THEN 'ok'
                WHEN s.sum_pct = 0 THEN 'sin_pct'
                WHEN s.sum_pct > 105 THEN 'sobre_105'
                ELSE 'bajo_95'
              END,
           'pct_propiedad_needs_review',
              CASE
                WHEN NOT s.has_nota THEN true
                WHEN s.sum_pct BETWEEN 95 AND 105 OR s.sum_pct = 0 THEN false
                ELSE true
              END,
           'pct_propiedad_audited_at', to_jsonb(now())
         )
    FROM sums s
    WHERE ba.building_id = s.building_id
    RETURNING ba.building_id, s.sum_pct
  )
  SELECT COUNT(*) FILTER (WHERE TRUE), COUNT(*) FILTER (WHERE sum_pct < 95 OR sum_pct > 105)
    INTO v_updated, v_inconsistente
  FROM upd;

  UPDATE public.buildings b
  SET numero_propietarios = sub.n
  FROM (
    SELECT building_id, COUNT(DISTINCT owner_id) AS n
    FROM public.building_owners
    WHERE building_id IN (SELECT id FROM public.buildings WHERE p_building_ids IS NULL OR id = ANY(p_building_ids))
    GROUP BY building_id
  ) sub
  WHERE b.id = sub.building_id;

  RETURN jsonb_build_object('buildings_updated', v_updated, 'inconsistentes', v_inconsistente);
END $function$;
