CREATE OR REPLACE VIEW public.v_owner_score WITH (security_invoker = on) AS
 WITH raw_owner_finca AS (
         SELECT t.owner_id,
            t.nota_simple_id,
            n.building_id,
            sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0::numeric) AS pct_raw_sum,
            max(t.porcentaje::text) AS raw_value,
            bool_and(t.porcentaje IS NULL OR t.porcentaje <= 0::numeric) AS all_invalid
           FROM nota_simple_titulares t
             JOIN notas_simples n ON n.id = t.nota_simple_id
          WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL AND COALESCE(n.status, 'listo'::text) = 'listo'::text AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol]))
          GROUP BY t.owner_id, t.nota_simple_id, n.building_id
        ), finca_totals AS (
         SELECT raw_owner_finca.nota_simple_id,
            raw_owner_finca.building_id,
            sum(raw_owner_finca.pct_raw_sum) AS finca_sum
           FROM raw_owner_finca
          WHERE raw_owner_finca.pct_raw_sum IS NOT NULL AND raw_owner_finca.pct_raw_sum > 0::numeric
          GROUP BY raw_owner_finca.nota_simple_id, raw_owner_finca.building_id
        ), building_data_fincas AS (
         SELECT finca_totals.building_id,
            count(*)::numeric AS n_fincas
           FROM finca_totals
          GROUP BY finca_totals.building_id
        ), owner_finca_norm AS (
         SELECT r.owner_id,
            r.building_id,
            r.nota_simple_id,
                CASE
                    WHEN ft.finca_sum IS NOT NULL AND ft.finca_sum > 0::numeric AND r.pct_raw_sum IS NOT NULL THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0
                    ELSE NULL::numeric
                END AS pct_finca_norm,
            r.raw_value,
            r.all_invalid
           FROM raw_owner_finca r
             LEFT JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id
        ), ns_pct AS (
         SELECT o_1.owner_id,
            o_1.building_id,
            round(sum(o_1.pct_finca_norm / NULLIF(bdf.n_fincas, 0::numeric)) FILTER (WHERE o_1.pct_finca_norm IS NOT NULL), 2) AS pct,
            bool_or(o_1.pct_finca_norm IS NOT NULL) AS has_norm,
            bool_and(o_1.all_invalid) AS all_invalid,
            max(o_1.raw_value) AS raw_value
           FROM owner_finca_norm o_1
             LEFT JOIN building_data_fincas bdf ON bdf.building_id = o_1.building_id
          GROUP BY o_1.owner_id, o_1.building_id
        ), raw_por_rol AS (
         SELECT t.owner_id,
            t.nota_simple_id,
            n.building_id,
                CASE
                    WHEN t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol]) THEN 'pd'::text
                    WHEN t.rol = 'nuda_propiedad'::nota_titular_rol THEN 'np'::text
                    ELSE 'usu'::text
                END AS grupo,
            sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0::numeric) AS pct_raw_sum
           FROM nota_simple_titulares t
             JOIN notas_simples n ON n.id = t.nota_simple_id
          WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL AND COALESCE(n.status, 'listo'::text) = 'listo'::text AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol, 'usufructo'::nota_titular_rol]))
          GROUP BY t.owner_id, t.nota_simple_id, n.building_id, (
                CASE
                    WHEN t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol]) THEN 'pd'::text
                    WHEN t.rol = 'nuda_propiedad'::nota_titular_rol THEN 'np'::text
                    ELSE 'usu'::text
                END)
        ), ns_rol AS (
         SELECT r.owner_id,
            r.building_id,
            round(sum(
                CASE
                    WHEN r.grupo = 'pd'::text THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 / NULLIF(bdf.n_fincas, 0::numeric)
                    ELSE NULL::numeric
                END), 2) AS pct_pleno,
            round(sum(
                CASE
                    WHEN r.grupo = 'np'::text THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 / NULLIF(bdf.n_fincas, 0::numeric)
                    ELSE NULL::numeric
                END), 2) AS pct_nuda,
            round(sum(
                CASE
                    WHEN r.grupo = 'usu'::text THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 / NULLIF(bdf.n_fincas, 0::numeric)
                    ELSE NULL::numeric
                END), 2) AS pct_usufructo
           FROM raw_por_rol r
             JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id AND ft.finca_sum > 0::numeric
             JOIN building_data_fincas bdf ON bdf.building_id = r.building_id
          GROUP BY r.owner_id, r.building_id
        ), con_hechos_nota AS (
         SELECT DISTINCT n.building_id
           FROM nota_simple_titulares t
             JOIN notas_simples n ON n.id = t.nota_simple_id
          WHERE n.building_id IS NOT NULL AND COALESCE(n.status, 'listo'::text) = 'listo'::text AND t.porcentaje IS NOT NULL AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol]))
        ), pct_resolved AS (
         SELECT bo_1.owner_id,
            bo_1.building_id,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN NULL::numeric
                    WHEN np.pct IS NOT NULL THEN np.pct
                    WHEN chn.building_id IS NOT NULL THEN NULL::numeric
                    WHEN hs.pct IS NOT NULL THEN hs.pct
                    ELSE NULL::numeric
                END AS pct_propiedad,
            COALESCE(np.pct, hs.pct) AS pct_para_score,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN 'en_revision'::text
                    WHEN np.pct IS NOT NULL THEN 'nota_simple'::text
                    WHEN chn.building_id IS NOT NULL THEN 'sin_derecho_en_nota'::text
                    WHEN hs.pct IS NOT NULL THEN 'building_owners'::text
                    ELSE 'desconocido'::text
                END AS pct_origen,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN false
                    WHEN np.pct IS NOT NULL THEN true
                    WHEN chn.building_id IS NOT NULL THEN false
                    WHEN hs.pct IS NOT NULL THEN COALESCE(hs.normalizado, false)
                    ELSE false
                END AS pct_normalizado,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN false
                    WHEN np.pct IS NULL AND chn.building_id IS NULL AND hs.pct IS NULL AND (COALESCE(np.all_invalid, false) OR COALESCE(hs.invalido, false)) THEN true
                    ELSE false
                END AS pct_invalido,
            COALESCE(np.raw_value, hs.raw_value) AS pct_raw,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN NULL::numeric
                    ELSE nr.pct_pleno
                END AS pct_pleno,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN NULL::numeric
                    ELSE nr.pct_nuda
                END AS pct_nuda,
                CASE
                    WHEN b.porcentajes_estado = 'a_revisar'::text THEN NULL::numeric
                    ELSE nr.pct_usufructo
                END AS pct_usufructo
           FROM building_owners bo_1
             JOIN owners o_1 ON o_1.id = bo_1.owner_id
             JOIN buildings b ON b.id = bo_1.building_id
             LEFT JOIN ns_pct np ON np.owner_id = bo_1.owner_id AND np.building_id = bo_1.building_id
             LEFT JOIN ns_rol nr ON nr.owner_id = bo_1.owner_id AND nr.building_id = bo_1.building_id
             LEFT JOIN con_hechos_nota chn ON chn.building_id = bo_1.building_id
             LEFT JOIN LATERAL normalize_pct_propiedad(bo_1.cuota::text) hs(pct, normalizado, invalido, raw_value) ON true
        )
 SELECT o.id AS owner_id,
    o.nombre,
    o.telefono,
    o.email,
    o.rol,
    bo.building_id,
    bo.subrole,
    bo.rol_notas,
    bo.es_influencer,
    bo.influencer_score,
    bo.influencer_reason,
    o.metadatos,
    pr.pct_propiedad,
    pr.pct_origen,
    pr.pct_normalizado,
    pr.pct_invalido,
    pr.pct_raw,
    COALESCE(lc.calls_count, 0) AS contactos_previos,
    lc.last_call_at,
    round((0.30 *
        CASE
            WHEN pr.pct_para_score IS NULL THEN 0::numeric
            ELSE 1.0 - LEAST(1.0, pr.pct_para_score / 100.0)
        END + 0.25 *
        CASE
            WHEN pr.pct_para_score IS NULL THEN 0::numeric
            ELSE LEAST(1.0, pr.pct_para_score / 100.0)
        END + 0.20 * LEAST(1.0, COALESCE(lc.calls_count, 0)::numeric / 5.0) + 0.15 *
        CASE
            WHEN o.rol = 'desconocido'::owner_role THEN 0
            ELSE 1
        END::numeric + 0.10 *
        CASE
            WHEN o.telefono IS NOT NULL AND o.telefono <> ''::text THEN 1
            ELSE 0
        END::numeric) * 100::numeric, 1) AS score,
    pr.pct_pleno,
    pr.pct_nuda,
    pr.pct_usufructo
   FROM owners o
     JOIN building_owners bo ON bo.owner_id = o.id
     LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
     LEFT JOIN v_owner_last_contact lc ON lc.owner_id = o.id
  WHERE o.merged_into IS NULL;