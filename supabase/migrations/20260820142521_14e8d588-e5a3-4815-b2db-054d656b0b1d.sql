CREATE OR REPLACE VIEW public.v_owner_pct_crm AS
 WITH base AS (
         SELECT bo.building_id,
            bo.owner_id,
            o.metadatos ->> 'tipo_de_derecho'::text AS derecho_raw,
            COALESCE(c.pct, h.pct) AS pct_hubspot,
            COALESCE(c.raw_value, h.raw_value) AS raw_value,
            c.pct IS NOT NULL AS de_contacto,
            COALESCE(c.normalizado, h.normalizado, false) AS normalizado,
            COALESCE(c.pct, h.pct) IS NULL AND (COALESCE(c.invalido, false) OR COALESCE(h.invalido, false)) AS invalido
           FROM building_owners bo
             JOIN owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
             LEFT JOIN LATERAL normalize_pct_propiedad(o.metadatos ->> 'porcentaje_de_participacion'::text) c(pct, normalizado, invalido, raw_value) ON true
             LEFT JOIN LATERAL normalize_pct_propiedad(bo.cuota::text) h(pct, normalizado, invalido, raw_value) ON true
        ), clasif AS (
         SELECT b.building_id,
            b.owner_id,
            b.derecho_raw,
            b.pct_hubspot,
            b.raw_value,
            b.de_contacto,
            b.normalizado,
            b.invalido,
            derecho_computa_propiedad(b.derecho_raw) AS computa,
            derecho_es_ganancial(b.derecho_raw) AS ganancial,
            derecho_es_familiar(b.derecho_raw) AS familiar,
            'usu'::text = ANY (derecho_grupos(b.derecho_raw)) AS tiene_usufructo
           FROM base b
        ), paso1 AS (
         SELECT c.building_id,
            c.owner_id,
            c.derecho_raw,
            c.pct_hubspot,
            c.raw_value,
            c.de_contacto,
            c.normalizado,
            c.invalido,
            c.computa,
            c.ganancial,
            c.familiar,
            c.tiene_usufructo,
                CASE
                    WHEN c.computa THEN c.pct_hubspot
                    ELSE NULL::numeric
                END AS pct1,
                CASE
                    WHEN c.tiene_usufructo THEN c.pct_hubspot
                    ELSE NULL::numeric
                END AS pct_usufructo
           FROM clasif c
        ), grp AS (
         SELECT p_0.building_id,
            round(p_0.pct1, 2) AS k,
            count(DISTINCT p_0.owner_id) AS n_owners,
            count(DISTINCT p_0.owner_id) FILTER (WHERE p_0.ganancial) AS n_gan
           FROM paso1 p_0
          WHERE p_0.pct1 IS NOT NULL
          GROUP BY p_0.building_id, round(p_0.pct1, 2)
        ), pares AS (
         SELECT p_1.building_id,
            p_1.owner_id,
            p_1.derecho_raw,
            p_1.pct_hubspot,
            p_1.raw_value,
            p_1.de_contacto,
            p_1.normalizado,
            p_1.invalido,
            p_1.computa,
            p_1.ganancial,
            p_1.familiar,
            p_1.tiene_usufructo,
            p_1.pct1,
            p_1.pct_usufructo,
            (p_1.pct1 IS NOT NULL AND COALESCE(
                CASE WHEN p_1.ganancial THEN g.n_owners > 1 ELSE g.n_gan > 0 END, false)) AS pareja_ganancial
           FROM paso1 p_1
             LEFT JOIN grp g ON g.building_id = p_1.building_id AND g.k = round(p_1.pct1, 2)
        ), paso2 AS (
         SELECT pa.building_id,
            pa.owner_id,
            pa.derecho_raw,
            pa.pct_hubspot,
            pa.raw_value,
            pa.de_contacto,
            pa.normalizado,
            pa.invalido,
            pa.computa,
            pa.ganancial,
            pa.familiar,
            pa.tiene_usufructo,
            pa.pct1,
            pa.pct_usufructo,
            pa.pareja_ganancial,
                CASE
                    WHEN pa.pareja_ganancial THEN round(pa.pct1 / 2::numeric, 2)
                    ELSE pa.pct1
                END AS pct2
           FROM pares pa
        ), sumas AS (
         SELECT paso2.building_id,
            round(sum(paso2.pct2), 2) AS suma_reglas,
            round(sum(paso2.pct_hubspot) FILTER (WHERE paso2.pct_hubspot IS NOT NULL), 2) AS suma_hubspot
           FROM paso2
          GROUP BY paso2.building_id
        )
 SELECT p.building_id,
    p.owner_id,
    p.derecho_raw,
    p.de_contacto,
    p.normalizado,
    p.invalido,
    p.raw_value,
    p.familiar,
    p.pct_hubspot,
    p.pct_usufructo,
        CASE
            WHEN p.pct2 IS NULL THEN NULL::numeric
            WHEN COALESCE(s.suma_reglas, 0::numeric) > 100.75 THEN round(p.pct2 * 100.0 / s.suma_reglas, 2)
            ELSE p.pct2
        END AS pct,
    NULLIF(concat_ws('+'::text,
        CASE
            WHEN p.tiene_usufructo AND NOT p.computa THEN 'usufructo_no_computa'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.familiar THEN 'es_familiar'::text
            ELSE NULL::text
        END,
        CASE
            WHEN p.pareja_ganancial THEN 'ganancial_compartido'::text
            ELSE NULL::text
        END,
        CASE
            WHEN COALESCE(s.suma_reglas, 0::numeric) > 100.75 AND p.pct2 IS NOT NULL THEN 'normalizado_100'::text
            ELSE NULL::text
        END), ''::text) AS regla,
    s.suma_hubspot,
    s.suma_reglas
   FROM paso2 p
     LEFT JOIN sumas s ON s.building_id = p.building_id;