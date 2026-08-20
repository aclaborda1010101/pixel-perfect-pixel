CREATE OR REPLACE VIEW public.v_building_pct_fuente AS
 WITH agg AS (
         SELECT cr.building_id,
            count(*) FILTER (WHERE cr.pct IS NOT NULL AND cr.pct > 0::numeric) AS n_con_cuota,
            round(sum(cr.pct) FILTER (WHERE cr.pct IS NOT NULL AND cr.pct > 0::numeric), 2) AS suma,
            max(cr.suma_hubspot) AS suma_hubspot
           FROM v_owner_pct_crm cr
          GROUP BY cr.building_id
        )
 SELECT b.id AS building_id,
    COALESCE(a.n_con_cuota, 0::bigint) AS crm_titulares,
    a.suma AS crm_suma,
    COALESCE(a.n_con_cuota, 0::bigint) >= 1 AND a.suma IS NOT NULL AND abs(a.suma - 100::numeric) <= 0.75 AS crm_valido,
        CASE
            WHEN COALESCE(a.n_con_cuota, 0::bigint) >= 1 AND a.suma IS NOT NULL AND abs(a.suma - 100::numeric) <= 0.75 THEN 'crm'::text
            ELSE 'nota'::text
        END AS pct_fuente,
    a.suma_hubspot AS crm_suma_hubspot
   FROM buildings b
     LEFT JOIN agg a ON a.building_id = b.id;

CREATE OR REPLACE VIEW public.v_owner_score AS
 WITH raw_owner_finca AS (
         SELECT t.owner_id, t.nota_simple_id, n.building_id,
            sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0::numeric) AS pct_raw_sum,
            max(t.porcentaje::text) AS raw_value,
            bool_and(t.porcentaje IS NULL OR t.porcentaje <= 0::numeric) AS all_invalid
           FROM nota_simple_titulares t
             JOIN notas_simples n ON n.id = t.nota_simple_id
          WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL AND COALESCE(n.status,'listo') = 'listo'
            AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol,'nuda_propiedad'::nota_titular_rol]))
          GROUP BY t.owner_id, t.nota_simple_id, n.building_id
        ), finca_totals AS (
         SELECT r.nota_simple_id, r.building_id, sum(r.pct_raw_sum) AS finca_sum
           FROM raw_owner_finca r
          WHERE r.pct_raw_sum IS NOT NULL AND r.pct_raw_sum > 0::numeric
          GROUP BY r.nota_simple_id, r.building_id
        ), building_data_fincas AS (
         SELECT ft.building_id, count(*)::numeric AS n_fincas FROM finca_totals ft GROUP BY ft.building_id
        ), owner_finca_norm AS (
         SELECT r.owner_id, r.building_id, r.nota_simple_id,
                CASE WHEN ft.finca_sum IS NOT NULL AND ft.finca_sum > 0::numeric AND r.pct_raw_sum IS NOT NULL
                     THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 ELSE NULL::numeric END AS pct_finca_norm,
            r.raw_value, r.all_invalid
           FROM raw_owner_finca r
             LEFT JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id
        ), ns_pct AS (
         SELECT o_1.owner_id, o_1.building_id,
            round(sum(o_1.pct_finca_norm / NULLIF(bdf.n_fincas, 0::numeric)) FILTER (WHERE o_1.pct_finca_norm IS NOT NULL), 2) AS pct,
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
            sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0::numeric) AS pct_raw_sum
           FROM nota_simple_titulares t
             JOIN notas_simples n ON n.id = t.nota_simple_id
          WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL AND COALESCE(n.status,'listo') = 'listo'
            AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol,'nuda_propiedad'::nota_titular_rol,'usufructo'::nota_titular_rol]))
          GROUP BY t.owner_id, t.nota_simple_id, n.building_id, 4
        ), ns_rol AS (
         SELECT r.owner_id, r.building_id,
            round(sum(CASE WHEN r.grupo = 'pd' THEN r.pct_raw_sum / GREATEST(ft.finca_sum,100.0) * 100.0 / NULLIF(bdf.n_fincas,0::numeric) ELSE NULL::numeric END), 2) AS pct_pleno,
            round(sum(CASE WHEN r.grupo = 'np' THEN r.pct_raw_sum / GREATEST(ft.finca_sum,100.0) * 100.0 / NULLIF(bdf.n_fincas,0::numeric) ELSE NULL::numeric END), 2) AS pct_nuda,
            round(sum(CASE WHEN r.grupo = 'usu' THEN r.pct_raw_sum / GREATEST(ft.finca_sum,100.0) * 100.0 / NULLIF(bdf.n_fincas,0::numeric) ELSE NULL::numeric END), 2) AS pct_usufructo
           FROM raw_por_rol r
             JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id AND ft.finca_sum > 0::numeric
             JOIN building_data_fincas bdf ON bdf.building_id = r.building_id
          GROUP BY r.owner_id, r.building_id
        ), con_hechos_nota AS (
         SELECT DISTINCT n.building_id
           FROM nota_simple_titulares t
             JOIN notas_simples n ON n.id = t.nota_simple_id
          WHERE n.building_id IS NOT NULL AND COALESCE(n.status,'listo') = 'listo' AND t.porcentaje IS NOT NULL
            AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol,'ganancial'::nota_titular_rol,'nuda_propiedad'::nota_titular_rol]))
        ), nota_enlazada AS (
         SELECT DISTINCT ns_pct.building_id FROM ns_pct WHERE ns_pct.pct IS NOT NULL
        ), pct_resolved AS (
         SELECT bo_1.owner_id, bo_1.building_id,
            (cr.derecho_raw IS NOT NULL AND cr.derecho_raw <> ''
              AND NOT derecho_computa_propiedad(cr.derecho_raw)
              AND NOT ('usu' = ANY (derecho_grupos(cr.derecho_raw)))) AS crm_sin_propiedad,
                CASE
                    WHEN cr.derecho_raw IS NOT NULL AND cr.derecho_raw <> '' AND NOT derecho_computa_propiedad(cr.derecho_raw) THEN NULL::numeric
                    WHEN COALESCE(f.crm_valido, false) THEN cr.pct
                    WHEN np.pct IS NOT NULL THEN np.pct
                    WHEN chn.building_id IS NOT NULL AND ne.building_id IS NOT NULL THEN NULL::numeric
                    WHEN (CASE WHEN NOT cr.de_contacto THEN cr.pct ELSE NULL::numeric END) IS NOT NULL
                      THEN (CASE WHEN NOT cr.de_contacto THEN cr.pct ELSE NULL::numeric END)
                    WHEN cr.pct IS NOT NULL THEN cr.pct
                    ELSE NULL::numeric
                END AS pct_propiedad,
                CASE
                    WHEN cr.derecho_raw IS NOT NULL AND cr.derecho_raw <> '' AND NOT derecho_computa_propiedad(cr.derecho_raw) THEN NULL::numeric
                    WHEN COALESCE(f.crm_valido, false) THEN cr.pct
                    ELSE COALESCE(np.pct, CASE WHEN NOT cr.de_contacto THEN cr.pct ELSE NULL::numeric END, cr.pct)
                END AS pct_para_score,
                CASE
                    WHEN cr.derecho_raw IS NOT NULL AND cr.derecho_raw <> '' AND NOT derecho_computa_propiedad(cr.derecho_raw)
                      THEN CASE WHEN 'usu' = ANY (derecho_grupos(cr.derecho_raw)) THEN 'solo_usufructo_crm' ELSE 'sin_derecho_crm' END
                    WHEN COALESCE(f.crm_valido, false) THEN CASE WHEN cr.pct IS NOT NULL THEN 'crm_validado' ELSE 'sin_cuota_crm' END
                    WHEN np.pct IS NOT NULL THEN CASE WHEN b.porcentajes_estado = 'verificado' THEN 'nota_simple' ELSE 'en_revision' END
                    WHEN chn.building_id IS NOT NULL AND ne.building_id IS NOT NULL THEN 'sin_derecho_en_nota'
                    WHEN (CASE WHEN NOT cr.de_contacto THEN cr.pct ELSE NULL::numeric END) IS NOT NULL
                      THEN CASE WHEN b.porcentajes_estado = 'verificado' THEN 'building_owners' ELSE 'en_revision' END
                    WHEN cr.pct IS NOT NULL THEN 'crm_en_revision'
                    ELSE 'desconocido'
                END AS pct_origen,
                CASE
                    WHEN cr.derecho_raw IS NOT NULL AND cr.derecho_raw <> '' AND NOT derecho_computa_propiedad(cr.derecho_raw) THEN false
                    WHEN COALESCE(f.crm_valido, false) THEN cr.pct IS NOT NULL
                    WHEN np.pct IS NOT NULL THEN b.porcentajes_estado = 'verificado'
                    WHEN chn.building_id IS NOT NULL AND ne.building_id IS NOT NULL THEN false
                    WHEN (CASE WHEN NOT cr.de_contacto THEN cr.pct ELSE NULL::numeric END) IS NOT NULL
                      THEN COALESCE(cr.normalizado, false) AND b.porcentajes_estado = 'verificado'
                    ELSE false
                END AS pct_normalizado,
                CASE
                    WHEN NOT COALESCE(f.crm_valido, false) AND np.pct IS NULL AND cr.pct IS NULL
                      AND (COALESCE(np.all_invalid, false) OR COALESCE(cr.invalido, false)) THEN true
                    ELSE false
                END AS pct_invalido,
                CASE WHEN COALESCE(f.crm_valido, false) THEN cr.raw_value ELSE COALESCE(np.raw_value, cr.raw_value) END AS pct_raw,
                CASE
                    WHEN cr.derecho_raw IS NOT NULL AND cr.derecho_raw <> '' AND NOT derecho_computa_propiedad(cr.derecho_raw) THEN NULL::numeric
                    WHEN COALESCE(f.crm_valido, false) THEN cr.pct ELSE nr.pct_pleno END AS pct_pleno,
                CASE WHEN COALESCE(f.crm_valido, false) THEN NULL::numeric ELSE nr.pct_nuda END AS pct_nuda,
                CASE WHEN COALESCE(f.crm_valido, false) THEN cr.pct_usufructo ELSE nr.pct_usufructo END AS pct_usufructo,
            COALESCE(f.pct_fuente, 'nota') AS pct_fuente_edificio,
            COALESCE(cr.familiar, false) AS familiar_crm,
            cr.regla AS pct_regla,
            cr.derecho_raw AS derecho_crm,
            cr.suma_hubspot AS suma_hubspot_edificio
           FROM building_owners bo_1
             JOIN owners o_1 ON o_1.id = bo_1.owner_id
             JOIN buildings b ON b.id = bo_1.building_id
             LEFT JOIN v_building_pct_fuente f ON f.building_id = bo_1.building_id
             LEFT JOIN v_owner_pct_crm cr ON cr.building_id = bo_1.building_id AND cr.owner_id = bo_1.owner_id
             LEFT JOIN ns_pct np ON np.owner_id = bo_1.owner_id AND np.building_id = bo_1.building_id
             LEFT JOIN ns_rol nr ON nr.owner_id = bo_1.owner_id AND nr.building_id = bo_1.building_id
             LEFT JOIN con_hechos_nota chn ON chn.building_id = bo_1.building_id
             LEFT JOIN nota_enlazada ne ON ne.building_id = bo_1.building_id
        ), building_sum AS (
         SELECT pr_1.building_id,
            round(sum(pr_1.pct_propiedad) FILTER (WHERE pr_1.pct_propiedad IS NOT NULL AND NOT pr_1.pct_invalido), 2) AS suma
           FROM pct_resolved pr_1 GROUP BY pr_1.building_id
        )
 SELECT o.id AS owner_id, o.nombre, o.telefono, o.email, o.rol,
    bo.building_id, bo.subrole, bo.rol_notas,
    COALESCE(pr.familiar_crm, false)
      OR COALESCE(pr.crm_sin_propiedad, false)
      OR bo.es_influencer AND COALESCE(bs.suma, 0::numeric) <= 100.75
         AND (pr.pct_origen = ANY (ARRAY['sin_derecho_en_nota','sin_cuota_crm'])) AS es_influencer,
    bo.influencer_score, bo.influencer_reason, o.metadatos,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN NULL::numeric ELSE pr.pct_propiedad END AS pct_propiedad,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN 'suma_incoherente' ELSE pr.pct_origen END AS pct_origen,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN false ELSE pr.pct_normalizado END AS pct_normalizado,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN true ELSE pr.pct_invalido END AS pct_invalido,
    pr.pct_raw,
    COALESCE(lc.calls_count, 0) AS contactos_previos,
    lc.last_call_at,
    round((0.30 * CASE WHEN pr.pct_para_score IS NULL THEN 0::numeric ELSE 1.0 - LEAST(1.0, pr.pct_para_score / 100.0) END
         + 0.25 * CASE WHEN pr.pct_para_score IS NULL THEN 0::numeric ELSE LEAST(1.0, pr.pct_para_score / 100.0) END
         + 0.20 * LEAST(1.0, COALESCE(lc.calls_count, 0)::numeric / 5.0)
         + 0.15 * CASE WHEN o.rol = 'desconocido'::owner_role THEN 0 ELSE 1 END::numeric
         + 0.10 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END::numeric) * 100::numeric, 1) AS score,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN NULL::numeric ELSE pr.pct_pleno END AS pct_pleno,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN NULL::numeric ELSE pr.pct_nuda END AS pct_nuda,
    CASE WHEN COALESCE(bs.suma, 0::numeric) > 100.75 THEN NULL::numeric ELSE pr.pct_usufructo END AS pct_usufructo,
    COALESCE(pr.pct_fuente_edificio, 'nota') AS pct_fuente_edificio,
    COALESCE(bs.suma, 0::numeric) > 100.75 AS pct_incoherente,
    bs.suma AS pct_suma_edificio_bruta,
    pr.pct_regla, pr.derecho_crm, pr.suma_hubspot_edificio
   FROM owners o
     JOIN building_owners bo ON bo.owner_id = o.id
     LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
     LEFT JOIN building_sum bs ON bs.building_id = bo.building_id
     LEFT JOIN v_owner_last_contact lc ON lc.owner_id = o.id
  WHERE o.merged_into IS NULL;