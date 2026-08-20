
CREATE OR REPLACE VIEW public.v_owner_score AS
WITH raw_owner_finca AS (
  SELECT t.owner_id, t.nota_simple_id, n.building_id,
     sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0) AS pct_raw_sum,
     max(t.porcentaje::text) AS raw_value,
     bool_and(t.porcentaje IS NULL OR t.porcentaje <= 0) AS all_invalid
  FROM nota_simple_titulares t
  JOIN notas_simples n ON n.id = t.nota_simple_id
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL
    AND COALESCE(n.status, 'listo') = 'listo'
    AND t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol])
  GROUP BY t.owner_id, t.nota_simple_id, n.building_id
), finca_totals AS (
  SELECT r.nota_simple_id, r.building_id, sum(r.pct_raw_sum) AS finca_sum
  FROM raw_owner_finca r
  WHERE r.pct_raw_sum IS NOT NULL AND r.pct_raw_sum > 0
  GROUP BY r.nota_simple_id, r.building_id
), building_data_fincas AS (
  SELECT ft.building_id, count(*)::numeric AS n_fincas FROM finca_totals ft GROUP BY ft.building_id
), owner_finca_norm AS (
  SELECT r.owner_id, r.building_id, r.nota_simple_id,
     CASE WHEN ft.finca_sum IS NOT NULL AND ft.finca_sum > 0 AND r.pct_raw_sum IS NOT NULL
          THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 END AS pct_finca_norm,
     r.raw_value, r.all_invalid
  FROM raw_owner_finca r
  LEFT JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id
), ns_pct AS (
  SELECT o_1.owner_id, o_1.building_id,
     round(sum(o_1.pct_finca_norm / NULLIF(bdf.n_fincas, 0)) FILTER (WHERE o_1.pct_finca_norm IS NOT NULL), 2) AS pct,
     bool_or(o_1.pct_finca_norm IS NOT NULL) AS has_norm,
     bool_and(o_1.all_invalid) AS all_invalid,
     max(o_1.raw_value) AS raw_value
  FROM owner_finca_norm o_1
  LEFT JOIN building_data_fincas bdf ON bdf.building_id = o_1.building_id
  GROUP BY o_1.owner_id, o_1.building_id
), raw_por_rol AS (
  SELECT t.owner_id, t.nota_simple_id, n.building_id,
     CASE WHEN t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol]) THEN 'pd'
          WHEN t.rol = 'nuda_propiedad'::nota_titular_rol THEN 'np' ELSE 'usu' END AS grupo,
     sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0) AS pct_raw_sum
  FROM nota_simple_titulares t
  JOIN notas_simples n ON n.id = t.nota_simple_id
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL
    AND COALESCE(n.status,'listo') = 'listo'
    AND t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol,'nuda_propiedad'::nota_titular_rol,'usufructo'::nota_titular_rol])
  GROUP BY t.owner_id, t.nota_simple_id, n.building_id,
     CASE WHEN t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol]) THEN 'pd'
          WHEN t.rol = 'nuda_propiedad'::nota_titular_rol THEN 'np' ELSE 'usu' END
), ns_rol AS (
  SELECT r.owner_id, r.building_id,
     round(sum(CASE WHEN r.grupo = 'pd' THEN r.pct_raw_sum / GREATEST(ft.finca_sum,100.0) * 100.0 / NULLIF(bdf.n_fincas,0) END), 2) AS pct_pleno,
     round(sum(CASE WHEN r.grupo = 'np' THEN r.pct_raw_sum / GREATEST(ft.finca_sum,100.0) * 100.0 / NULLIF(bdf.n_fincas,0) END), 2) AS pct_nuda,
     round(sum(CASE WHEN r.grupo = 'usu' THEN r.pct_raw_sum / GREATEST(ft.finca_sum,100.0) * 100.0 / NULLIF(bdf.n_fincas,0) END), 2) AS pct_usufructo
  FROM raw_por_rol r
  JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id AND ft.finca_sum > 0
  JOIN building_data_fincas bdf ON bdf.building_id = r.building_id
  GROUP BY r.owner_id, r.building_id
), con_hechos_nota AS (
  SELECT DISTINCT n.building_id
  FROM nota_simple_titulares t
  JOIN notas_simples n ON n.id = t.nota_simple_id
  WHERE n.building_id IS NOT NULL AND COALESCE(n.status,'listo') = 'listo'
    AND t.porcentaje IS NOT NULL
    AND t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol,'nuda_propiedad'::nota_titular_rol])
), nota_enlazada AS (
  -- edificios cuya nota YA está enlazada con al menos una ficha de propietario
  SELECT DISTINCT building_id FROM ns_pct WHERE pct IS NOT NULL
), pct_resolved AS (
  SELECT bo_1.owner_id, bo_1.building_id,
     CASE
       WHEN COALESCE(f.crm_valido, false) THEN crm.pct
       WHEN np.pct IS NOT NULL THEN np.pct
       WHEN chn.building_id IS NOT NULL AND ne.building_id IS NOT NULL THEN NULL::numeric
       WHEN hs.pct IS NOT NULL THEN hs.pct
       ELSE NULL::numeric
     END AS pct_propiedad,
     CASE WHEN COALESCE(f.crm_valido,false) THEN crm.pct ELSE COALESCE(np.pct, hs.pct) END AS pct_para_score,
     CASE
       WHEN COALESCE(f.crm_valido,false) THEN CASE WHEN crm.pct IS NOT NULL THEN 'crm_validado' ELSE 'sin_cuota_crm' END
       WHEN np.pct IS NOT NULL THEN CASE WHEN b.porcentajes_estado = 'verificado' THEN 'nota_simple' ELSE 'en_revision' END
       WHEN chn.building_id IS NOT NULL AND ne.building_id IS NOT NULL THEN 'sin_derecho_en_nota'
       WHEN hs.pct IS NOT NULL THEN CASE WHEN b.porcentajes_estado = 'verificado' THEN 'building_owners' ELSE 'en_revision' END
       ELSE 'desconocido'
     END AS pct_origen,
     CASE
       WHEN COALESCE(f.crm_valido,false) THEN crm.pct IS NOT NULL
       WHEN np.pct IS NOT NULL THEN b.porcentajes_estado = 'verificado'
       WHEN chn.building_id IS NOT NULL AND ne.building_id IS NOT NULL THEN false
       WHEN hs.pct IS NOT NULL THEN COALESCE(hs.normalizado,false) AND b.porcentajes_estado = 'verificado'
       ELSE false
     END AS pct_normalizado,
     CASE
       WHEN NOT COALESCE(f.crm_valido,false) AND np.pct IS NULL AND hs.pct IS NULL
            AND (COALESCE(np.all_invalid,false) OR COALESCE(hs.invalido,false)) THEN true
       ELSE false
     END AS pct_invalido,
     CASE WHEN COALESCE(f.crm_valido,false) THEN crm.raw_value ELSE COALESCE(np.raw_value, hs.raw_value) END AS pct_raw,
     CASE WHEN COALESCE(f.crm_valido,false) THEN crm.pct ELSE nr.pct_pleno END AS pct_pleno,
     CASE WHEN COALESCE(f.crm_valido,false) THEN NULL::numeric ELSE nr.pct_nuda END AS pct_nuda,
     CASE WHEN COALESCE(f.crm_valido,false) THEN NULL::numeric ELSE nr.pct_usufructo END AS pct_usufructo,
     COALESCE(f.pct_fuente, 'nota') AS pct_fuente_edificio
  FROM building_owners bo_1
  JOIN owners o_1 ON o_1.id = bo_1.owner_id
  JOIN buildings b ON b.id = bo_1.building_id
  LEFT JOIN v_building_pct_fuente f ON f.building_id = bo_1.building_id
  LEFT JOIN LATERAL normalize_pct_propiedad(o_1.metadatos ->> 'porcentaje_de_participacion') crm(pct, normalizado, invalido, raw_value) ON true
  LEFT JOIN ns_pct np ON np.owner_id = bo_1.owner_id AND np.building_id = bo_1.building_id
  LEFT JOIN ns_rol nr ON nr.owner_id = bo_1.owner_id AND nr.building_id = bo_1.building_id
  LEFT JOIN con_hechos_nota chn ON chn.building_id = bo_1.building_id
  LEFT JOIN nota_enlazada ne ON ne.building_id = bo_1.building_id
  LEFT JOIN LATERAL normalize_pct_propiedad(bo_1.cuota::text) hs(pct, normalizado, invalido, raw_value) ON true
), building_sum AS (
  -- Suma por edificio de lo que se mostraría. Si pasa de 100 es que la fuente
  -- mezcla varias fincas registrales: no se muestra ninguna cifra.
  SELECT pr.building_id,
     round(sum(pr.pct_propiedad) FILTER (WHERE pr.pct_propiedad IS NOT NULL AND NOT pr.pct_invalido), 2) AS suma
  FROM pct_resolved pr GROUP BY pr.building_id
)
SELECT o.id AS owner_id,
   o.nombre, o.telefono, o.email, o.rol,
   bo.building_id, bo.subrole, bo.rol_notas,
   (bo.es_influencer AND COALESCE(bs.suma, 0) <= 100.75
      AND pr.pct_origen = ANY (ARRAY['sin_derecho_en_nota','sin_cuota_crm'])) AS es_influencer,
   bo.influencer_score, bo.influencer_reason,
   o.metadatos,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN NULL::numeric ELSE pr.pct_propiedad END AS pct_propiedad,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN 'suma_incoherente' ELSE pr.pct_origen END AS pct_origen,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN false ELSE pr.pct_normalizado END AS pct_normalizado,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN true ELSE pr.pct_invalido END AS pct_invalido,
   pr.pct_raw,
   COALESCE(lc.calls_count, 0) AS contactos_previos,
   lc.last_call_at,
   round((0.30 * CASE WHEN pr.pct_para_score IS NULL THEN 0 ELSE 1.0 - LEAST(1.0, pr.pct_para_score/100.0) END
        + 0.25 * CASE WHEN pr.pct_para_score IS NULL THEN 0 ELSE LEAST(1.0, pr.pct_para_score/100.0) END
        + 0.20 * LEAST(1.0, COALESCE(lc.calls_count,0)::numeric / 5.0)
        + 0.15 * CASE WHEN o.rol = 'desconocido'::owner_role THEN 0 ELSE 1 END::numeric
        + 0.10 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END::numeric) * 100, 1) AS score,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN NULL::numeric ELSE pr.pct_pleno END AS pct_pleno,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN NULL::numeric ELSE pr.pct_nuda END AS pct_nuda,
   CASE WHEN COALESCE(bs.suma, 0) > 100.75 THEN NULL::numeric ELSE pr.pct_usufructo END AS pct_usufructo,
   COALESCE(pr.pct_fuente_edificio, 'nota') AS pct_fuente_edificio,
   COALESCE(bs.suma, 0) > 100.75 AS pct_incoherente,
   bs.suma AS pct_suma_edificio_bruta
FROM owners o
JOIN building_owners bo ON bo.owner_id = o.id
LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
LEFT JOIN building_sum bs ON bs.building_id = bo.building_id
LEFT JOIN v_owner_last_contact lc ON lc.owner_id = o.id
WHERE o.merged_into IS NULL;

-- Estado del reparto de propiedad, coherente con lo que se muestra
CREATE OR REPLACE FUNCTION public.recalcular_porcentajes_estado_crm(p_building_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_verificados int := 0;
  v_pendientes int := 0;
  v_revisar int := 0;
BEGIN
  -- 1) CRM completo que cuadra -> verificado
  WITH upd AS (
    UPDATE public.buildings b
    SET porcentajes_estado = 'verificado',
        porcentajes_verificado_at = COALESCE(b.porcentajes_verificado_at, now())
    FROM public.v_building_pct_fuente f
    WHERE f.building_id = b.id AND f.crm_valido
      AND b.porcentajes_estado IS DISTINCT FROM 'verificado'
      AND (p_building_id IS NULL OR b.id = p_building_id)
    RETURNING b.id
  ) SELECT count(*) INTO v_verificados FROM upd;

  -- 2) Verificados que no muestran ningún porcentaje -> pendientes de enlazar la nota
  WITH agg AS (
    SELECT v.building_id,
           COALESCE(sum(v.pct_propiedad) FILTER (WHERE NOT COALESCE(v.pct_invalido,false)), 0) AS suma,
           bool_or(v.pct_incoherente) AS incoherente
    FROM public.v_owner_score v
    WHERE p_building_id IS NULL OR v.building_id = p_building_id
    GROUP BY v.building_id
  ), upd AS (
    UPDATE public.buildings b
    SET porcentajes_estado = 'verificado_pendiente_matching',
        porcentajes_verificado_at = NULL
    FROM agg
    WHERE agg.building_id = b.id
      AND b.porcentajes_estado = 'verificado'
      AND NOT COALESCE(agg.incoherente, false)
      AND agg.suma = 0
      AND NOT EXISTS (
        SELECT 1 FROM public.v_building_pct_fuente f WHERE f.building_id = b.id AND f.crm_valido
      )
    RETURNING b.id
  ) SELECT count(*) INTO v_pendientes FROM upd;

  -- 3) Sumas incoherentes (varias fincas mezcladas) -> a revisar
  WITH agg AS (
    SELECT v.building_id, bool_or(v.pct_incoherente) AS incoherente
    FROM public.v_owner_score v
    WHERE p_building_id IS NULL OR v.building_id = p_building_id
    GROUP BY v.building_id
  ), upd AS (
    UPDATE public.buildings b
    SET porcentajes_estado = 'a_revisar', porcentajes_verificado_at = NULL
    FROM agg
    WHERE agg.building_id = b.id AND agg.incoherente
      AND b.porcentajes_estado IS DISTINCT FROM 'a_revisar'
    RETURNING b.id
  ) SELECT count(*) INTO v_revisar FROM upd;

  RETURN jsonb_build_object('verificados', v_verificados, 'pendientes_matching', v_pendientes, 'a_revisar', v_revisar);
END;
$$;

REVOKE ALL ON FUNCTION public.recalcular_porcentajes_estado_crm(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recalcular_porcentajes_estado_crm(uuid) TO authenticated, service_role;
