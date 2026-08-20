-- ============================================================
-- HubSpot es la fuente del dato; las reglas registrales del
-- proyecto se aplican ANTES de mostrarlo.
--  1. El usufructo no cuenta como propiedad (se conserva aparte).
--  2. Los gananciales son UNA propiedad compartida, no dos.
--  3. Si aun así la suma pasa de 100, se reparte proporcionalmente
--     y se etiqueta para poder explicarlo en la ficha.
--  4. "Es Familiar" de HubSpot = influenciador.
-- ============================================================

CREATE OR REPLACE FUNCTION public.derecho_grupos(p_raw text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT COALESCE(array_agg(DISTINCT g), '{}'::text[])
  FROM (
    SELECT CASE
      WHEN lower(btrim(x)) LIKE 'pleno dominio con car%'  THEN 'pd_gan'
      WHEN lower(btrim(x)) LIKE 'nuda propiedad con car%' THEN 'np_gan'
      WHEN lower(btrim(x)) LIKE 'pleno dominio%'          THEN 'pd'
      WHEN lower(btrim(x)) LIKE 'nuda propiedad%'         THEN 'np'
      WHEN lower(btrim(x)) LIKE 'usufructo%'              THEN 'usu'
      WHEN lower(btrim(x)) LIKE 'es familiar%'            THEN 'fam'
      WHEN lower(btrim(x)) LIKE 'es empresa%'             THEN 'emp'
      WHEN lower(btrim(x)) LIKE 'no corresponde%'         THEN 'nc'
      ELSE 'desconocido' END AS g
    FROM unnest(string_to_array(COALESCE(p_raw, ''), ';')) AS x
    WHERE btrim(x) <> ''
  ) t
$$;

CREATE OR REPLACE FUNCTION public.derecho_computa_propiedad(p_raw text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN public.derecho_grupos(p_raw) = '{}'::text[] THEN true  -- sin dato: no bloqueamos
    WHEN public.derecho_grupos(p_raw) && ARRAY['pd','pd_gan','np','np_gan'] THEN true
    ELSE false END
$$;

CREATE OR REPLACE FUNCTION public.derecho_es_ganancial(p_raw text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT public.derecho_grupos(p_raw) && ARRAY['pd_gan','np_gan']
$$;

CREATE OR REPLACE FUNCTION public.derecho_es_familiar(p_raw text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT ('fam' = ANY (public.derecho_grupos(p_raw)))
     AND NOT public.derecho_computa_propiedad(p_raw)
$$;

-- Cuotas de HubSpot con las reglas registrales aplicadas
CREATE OR REPLACE VIEW public.v_owner_pct_crm
WITH (security_invoker = true) AS
WITH base AS (
  SELECT bo.building_id,
         bo.owner_id,
         o.metadatos ->> 'tipo_de_derecho' AS derecho_raw,
         COALESCE(c.pct, h.pct)            AS pct_hubspot,
         COALESCE(c.raw_value, h.raw_value) AS raw_value,
         (c.pct IS NOT NULL)               AS de_contacto,
         COALESCE(c.normalizado, h.normalizado, false) AS normalizado,
         (COALESCE(c.pct, h.pct) IS NULL AND (COALESCE(c.invalido,false) OR COALESCE(h.invalido,false))) AS invalido
  FROM building_owners bo
  JOIN owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  LEFT JOIN LATERAL normalize_pct_propiedad(o.metadatos ->> 'porcentaje_de_participacion') c ON true
  LEFT JOIN LATERAL normalize_pct_propiedad(bo.cuota::text) h ON true
), clasif AS (
  SELECT b.*,
         public.derecho_computa_propiedad(b.derecho_raw) AS computa,
         public.derecho_es_ganancial(b.derecho_raw)      AS ganancial,
         public.derecho_es_familiar(b.derecho_raw)       AS familiar,
         ('usu' = ANY (public.derecho_grupos(b.derecho_raw))) AS tiene_usufructo
  FROM base b
), paso1 AS (   -- regla 1: usufructo / familiar / empresa no suman propiedad
  SELECT c.*,
         CASE WHEN c.computa THEN c.pct_hubspot ELSE NULL END AS pct1,
         CASE WHEN c.tiene_usufructo THEN c.pct_hubspot ELSE NULL END AS pct_usufructo
  FROM clasif c
), pares AS ( -- regla 2: gananciales = una sola propiedad compartida
  SELECT p.*,
         EXISTS (
           SELECT 1 FROM paso1 q
           WHERE q.building_id = p.building_id
             AND q.owner_id <> p.owner_id
             AND q.pct1 IS NOT NULL AND p.pct1 IS NOT NULL
             AND round(q.pct1, 2) = round(p.pct1, 2)
             AND (q.ganancial OR p.ganancial)
         ) AS pareja_ganancial
  FROM paso1 p
), paso2 AS (
  SELECT pa.*,
         CASE WHEN pa.pareja_ganancial THEN round(pa.pct1 / 2, 2) ELSE pa.pct1 END AS pct2
  FROM pares pa
), sumas AS (
  SELECT building_id,
         round(sum(pct2), 2) AS suma_reglas,
         round(sum(pct_hubspot) FILTER (WHERE pct_hubspot IS NOT NULL), 2) AS suma_hubspot
  FROM paso2 GROUP BY building_id
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
       CASE WHEN p.pct2 IS NULL THEN NULL
            WHEN COALESCE(s.suma_reglas, 0) > 100.75
              THEN round(p.pct2 * 100.0 / s.suma_reglas, 2)
            ELSE p.pct2 END AS pct,
       NULLIF(concat_ws('+',
         CASE WHEN p.tiene_usufructo AND NOT p.computa THEN 'usufructo_no_computa' END,
         CASE WHEN p.familiar THEN 'es_familiar' END,
         CASE WHEN p.pareja_ganancial THEN 'ganancial_compartido' END,
         CASE WHEN COALESCE(s.suma_reglas, 0) > 100.75 AND p.pct2 IS NOT NULL THEN 'normalizado_100' END
       ), '') AS regla,
       s.suma_hubspot,
       s.suma_reglas
FROM paso2 p
LEFT JOIN sumas s ON s.building_id = p.building_id;

GRANT SELECT ON public.v_owner_pct_crm TO authenticated;
GRANT SELECT ON public.v_owner_pct_crm TO service_role;

-- La validez de la fuente CRM se mide DESPUÉS de aplicar las reglas
CREATE OR REPLACE VIEW public.v_building_pct_fuente
WITH (security_invoker = true) AS
WITH agg AS (
  SELECT cr.building_id,
         count(*) FILTER (WHERE cr.pct IS NOT NULL AND cr.pct > 0) AS n_con_cuota,
         round(sum(cr.pct) FILTER (WHERE cr.pct IS NOT NULL AND cr.pct > 0), 2) AS suma,
         max(cr.suma_hubspot) AS suma_hubspot
  FROM public.v_owner_pct_crm cr
  GROUP BY cr.building_id
)
SELECT b.id AS building_id,
       COALESCE(a.n_con_cuota, 0) AS crm_titulares,
       a.suma AS crm_suma,
       (COALESCE(a.n_con_cuota, 0) >= 2 AND a.suma IS NOT NULL AND abs(a.suma - 100) <= 0.75) AS crm_valido,
       CASE WHEN COALESCE(a.n_con_cuota, 0) >= 2 AND a.suma IS NOT NULL AND abs(a.suma - 100) <= 0.75
            THEN 'crm' ELSE 'nota' END AS pct_fuente,
       a.suma_hubspot AS crm_suma_hubspot
FROM buildings b
LEFT JOIN agg a ON a.building_id = b.id;

GRANT SELECT ON public.v_building_pct_fuente TO authenticated;
GRANT SELECT ON public.v_building_pct_fuente TO service_role;