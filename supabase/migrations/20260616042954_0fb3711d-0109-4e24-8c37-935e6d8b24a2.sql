
CREATE OR REPLACE VIEW public.v_owner_score
WITH (security_invoker = on) AS
WITH ns_per_owner_finca AS (
  -- Por (owner, finca, building): tomamos el MAX del pct entre roles (nuda/usufructo/pleno) para no duplicar
  SELECT
    t.owner_id,
    t.nota_simple_id,
    n.building_id,
    MAX(np.pct)          AS pct,
    bool_or(np.normalizado) AS normalizado,
    bool_and(np.invalido)   AS all_invalid,
    max(np.raw_value)       AS raw_value
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples n ON n.id = t.nota_simple_id
  CROSS JOIN LATERAL public.normalize_pct_propiedad(t.porcentaje::text) np(pct, normalizado, invalido, raw_value)
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL
  GROUP BY t.owner_id, t.nota_simple_id, n.building_id
),
ns_per_owner_building AS (
  SELECT owner_id, building_id,
         SUM(pct) FILTER (WHERE pct IS NOT NULL) AS sum_pct,
         bool_or(normalizado) AS normalizado,
         bool_and(all_invalid) AS all_invalid,
         max(raw_value) AS raw_value
  FROM ns_per_owner_finca
  GROUP BY owner_id, building_id
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
