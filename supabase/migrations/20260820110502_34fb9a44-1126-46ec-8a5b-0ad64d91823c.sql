-- 1) Normalizador de nombres de persona (tolerante a tildes, partículas y orden)
CREATE OR REPLACE FUNCTION public.norm_person_name(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $fn$
  SELECT coalesce((
    SELECT string_agg(tok, ' ' ORDER BY tok)
    FROM (
      SELECT DISTINCT tok FROM unnest(string_to_array(
        regexp_replace(
          translate(lower(coalesce(p, '')),
            'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'),
          '[^a-z0-9 ]', ' ', 'g'), ' ')) AS tok
      WHERE tok <> ''
        AND length(tok) > 1
        AND tok NOT IN ('de','del','la','las','los','el','y','e','da','do','di','van','von','san','sta','don','dna','sr','sra','hros','herederos')
    ) s), '');
$fn$;

-- 2) Fuente de porcentajes por edificio: CRM completo vs nota registral
CREATE OR REPLACE VIEW public.v_building_pct_fuente AS
WITH q AS (
  SELECT bo.building_id, bo.owner_id, np.pct
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  LEFT JOIN LATERAL public.normalize_pct_propiedad(o.metadatos->>'porcentaje_de_participacion') AS np ON true
), agg AS (
  SELECT building_id,
         count(*) FILTER (WHERE pct IS NOT NULL AND pct > 0) AS n_con_cuota,
         round(sum(pct) FILTER (WHERE pct IS NOT NULL AND pct > 0), 2) AS suma
  FROM q GROUP BY building_id
)
SELECT b.id AS building_id,
       coalesce(a.n_con_cuota, 0) AS crm_titulares,
       a.suma AS crm_suma,
       (coalesce(a.n_con_cuota, 0) >= 2 AND a.suma IS NOT NULL AND abs(a.suma - 100) <= 0.75) AS crm_valido,
       CASE WHEN (coalesce(a.n_con_cuota, 0) >= 2 AND a.suma IS NOT NULL AND abs(a.suma - 100) <= 0.75)
            THEN 'crm' ELSE 'nota' END AS pct_fuente
FROM public.buildings b
LEFT JOIN agg a ON a.building_id = b.id;

GRANT SELECT ON public.v_building_pct_fuente TO authenticated, service_role;

-- 3) Titulares de la nota sin ficha, por edificio
CREATE OR REPLACE VIEW public.v_building_titulares_sin_ficha AS
SELECT n.building_id,
       count(*) AS n_sin_ficha,
       round(coalesce(sum(t.porcentaje) FILTER (WHERE t.porcentaje > 0), 0), 2) AS pct_sin_ficha
FROM public.nota_simple_titulares t
JOIN public.notas_simples n ON n.id = t.nota_simple_id
WHERE t.owner_id IS NULL AND t.company_id IS NULL
  AND n.building_id IS NOT NULL
  AND coalesce(n.status, 'listo') = 'listo'
GROUP BY n.building_id;

GRANT SELECT ON public.v_building_titulares_sin_ficha TO authenticated, service_role;

-- 4) v_owner_score con precedencia de fuente por edificio (CRM o nota, nunca mezcla)
CREATE OR REPLACE VIEW public.v_owner_score AS
WITH raw_owner_finca AS (
  SELECT t.owner_id, t.nota_simple_id, n.building_id,
    sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0::numeric) AS pct_raw_sum,
    max(t.porcentaje::text) AS raw_value,
    bool_and(t.porcentaje IS NULL OR t.porcentaje <= 0::numeric) AS all_invalid
  FROM nota_simple_titulares t
    JOIN notas_simples n ON n.id = t.nota_simple_id
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL AND COALESCE(n.status, 'listo') = 'listo'
    AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol]))
  GROUP BY t.owner_id, t.nota_simple_id, n.building_id
), finca_totals AS (
  SELECT nota_simple_id, building_id, sum(pct_raw_sum) AS finca_sum
  FROM raw_owner_finca WHERE pct_raw_sum IS NOT NULL AND pct_raw_sum > 0::numeric
  GROUP BY nota_simple_id, building_id
), building_data_fincas AS (
  SELECT building_id, count(*)::numeric AS n_fincas FROM finca_totals GROUP BY building_id
), owner_finca_norm AS (
  SELECT r.owner_id, r.building_id, r.nota_simple_id,
    CASE WHEN ft.finca_sum IS NOT NULL AND ft.finca_sum > 0::numeric AND r.pct_raw_sum IS NOT NULL
      THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 ELSE NULL::numeric END AS pct_finca_norm,
    r.raw_value, r.all_invalid
  FROM raw_owner_finca r LEFT JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id
), ns_pct AS (
  SELECT o_1.owner_id, o_1.building_id,
    round(sum(o_1.pct_finca_norm / NULLIF(bdf.n_fincas, 0::numeric)) FILTER (WHERE o_1.pct_finca_norm IS NOT NULL), 2) AS pct,
    bool_or(o_1.pct_finca_norm IS NOT NULL) AS has_norm,
    bool_and(o_1.all_invalid) AS all_invalid,
    max(o_1.raw_value) AS raw_value
  FROM owner_finca_norm o_1 LEFT JOIN building_data_fincas bdf ON bdf.building_id = o_1.building_id
  GROUP BY o_1.owner_id, o_1.building_id
), raw_por_rol AS (
  SELECT t.owner_id, t.nota_simple_id, n.building_id,
    CASE WHEN t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol]) THEN 'pd'
         WHEN t.rol = 'nuda_propiedad'::nota_titular_rol THEN 'np' ELSE 'usu' END AS grupo,
    sum(t.porcentaje) FILTER (WHERE t.porcentaje IS NOT NULL AND t.porcentaje > 0::numeric) AS pct_raw_sum
  FROM nota_simple_titulares t JOIN notas_simples n ON n.id = t.nota_simple_id
  WHERE t.owner_id IS NOT NULL AND n.building_id IS NOT NULL AND COALESCE(n.status, 'listo') = 'listo'
    AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol, 'usufructo'::nota_titular_rol]))
  GROUP BY t.owner_id, t.nota_simple_id, n.building_id,
    (CASE WHEN t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol]) THEN 'pd'
          WHEN t.rol = 'nuda_propiedad'::nota_titular_rol THEN 'np' ELSE 'usu' END)
), ns_rol AS (
  SELECT r.owner_id, r.building_id,
    round(sum(CASE WHEN r.grupo = 'pd' THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 / NULLIF(bdf.n_fincas, 0::numeric) ELSE NULL::numeric END), 2) AS pct_pleno,
    round(sum(CASE WHEN r.grupo = 'np' THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 / NULLIF(bdf.n_fincas, 0::numeric) ELSE NULL::numeric END), 2) AS pct_nuda,
    round(sum(CASE WHEN r.grupo = 'usu' THEN r.pct_raw_sum / GREATEST(ft.finca_sum, 100.0) * 100.0 / NULLIF(bdf.n_fincas, 0::numeric) ELSE NULL::numeric END), 2) AS pct_usufructo
  FROM raw_por_rol r
    JOIN finca_totals ft ON ft.nota_simple_id = r.nota_simple_id AND ft.finca_sum > 0::numeric
    JOIN building_data_fincas bdf ON bdf.building_id = r.building_id
  GROUP BY r.owner_id, r.building_id
), con_hechos_nota AS (
  SELECT DISTINCT n.building_id
  FROM nota_simple_titulares t JOIN notas_simples n ON n.id = t.nota_simple_id
  WHERE n.building_id IS NOT NULL AND COALESCE(n.status, 'listo') = 'listo' AND t.porcentaje IS NOT NULL
    AND (t.rol = ANY (ARRAY['pleno'::nota_titular_rol, 'ganancial'::nota_titular_rol, 'nuda_propiedad'::nota_titular_rol]))
), pct_resolved AS (
  SELECT bo_1.owner_id, bo_1.building_id,
    -- Fuente única por edificio: si el CRM está completo manda el CRM
    CASE WHEN COALESCE(f.crm_valido, false) THEN crm.pct
         WHEN np.pct IS NOT NULL THEN np.pct
         WHEN chn.building_id IS NOT NULL THEN NULL::numeric
         WHEN hs.pct IS NOT NULL THEN hs.pct
         ELSE NULL::numeric END AS pct_propiedad,
    CASE WHEN COALESCE(f.crm_valido, false) THEN crm.pct
         ELSE COALESCE(np.pct, hs.pct) END AS pct_para_score,
    CASE WHEN COALESCE(f.crm_valido, false)
           THEN (CASE WHEN crm.pct IS NOT NULL THEN 'crm_validado' ELSE 'sin_cuota_crm' END)
         WHEN np.pct IS NOT NULL THEN (CASE WHEN b.porcentajes_estado = 'verificado' THEN 'nota_simple' ELSE 'en_revision' END)
         WHEN chn.building_id IS NOT NULL THEN 'sin_derecho_en_nota'
         WHEN hs.pct IS NOT NULL THEN (CASE WHEN b.porcentajes_estado = 'verificado' THEN 'building_owners' ELSE 'en_revision' END)
         ELSE 'desconocido' END AS pct_origen,
    CASE WHEN COALESCE(f.crm_valido, false) THEN (crm.pct IS NOT NULL)
         WHEN np.pct IS NOT NULL THEN (b.porcentajes_estado = 'verificado')
         WHEN chn.building_id IS NOT NULL THEN false
         WHEN hs.pct IS NOT NULL THEN (COALESCE(hs.normalizado, false) AND b.porcentajes_estado = 'verificado')
         ELSE false END AS pct_normalizado,
    CASE WHEN NOT COALESCE(f.crm_valido, false)
              AND np.pct IS NULL AND chn.building_id IS NULL AND hs.pct IS NULL
              AND (COALESCE(np.all_invalid, false) OR COALESCE(hs.invalido, false)) THEN true
         ELSE false END AS pct_invalido,
    CASE WHEN COALESCE(f.crm_valido, false) THEN crm.raw_value
         ELSE COALESCE(np.raw_value, hs.raw_value) END AS pct_raw,
    CASE WHEN COALESCE(f.crm_valido, false) THEN crm.pct ELSE nr.pct_pleno END AS pct_pleno,
    CASE WHEN COALESCE(f.crm_valido, false) THEN NULL::numeric ELSE nr.pct_nuda END AS pct_nuda,
    CASE WHEN COALESCE(f.crm_valido, false) THEN NULL::numeric ELSE nr.pct_usufructo END AS pct_usufructo,
    COALESCE(f.pct_fuente, 'nota') AS pct_fuente_edificio
  FROM building_owners bo_1
    JOIN owners o_1 ON o_1.id = bo_1.owner_id
    JOIN buildings b ON b.id = bo_1.building_id
    LEFT JOIN public.v_building_pct_fuente f ON f.building_id = bo_1.building_id
    LEFT JOIN LATERAL public.normalize_pct_propiedad(o_1.metadatos->>'porcentaje_de_participacion') AS crm ON true
    LEFT JOIN ns_pct np ON np.owner_id = bo_1.owner_id AND np.building_id = bo_1.building_id
    LEFT JOIN ns_rol nr ON nr.owner_id = bo_1.owner_id AND nr.building_id = bo_1.building_id
    LEFT JOIN con_hechos_nota chn ON chn.building_id = bo_1.building_id
    LEFT JOIN LATERAL normalize_pct_propiedad(bo_1.cuota::text) AS hs ON true
)
SELECT o.id AS owner_id, o.nombre, o.telefono, o.email, o.rol,
  bo.building_id, bo.subrole, bo.rol_notas,
  (bo.es_influencer AND pr.pct_propiedad IS NULL AND pr.pct_pleno IS NULL AND pr.pct_nuda IS NULL AND pr.pct_usufructo IS NULL) AS es_influencer,
  bo.influencer_score, bo.influencer_reason, o.metadatos,
  pr.pct_propiedad, pr.pct_origen, pr.pct_normalizado, pr.pct_invalido, pr.pct_raw,
  COALESCE(lc.calls_count, 0) AS contactos_previos, lc.last_call_at,
  round((0.30 * CASE WHEN pr.pct_para_score IS NULL THEN 0::numeric ELSE 1.0 - LEAST(1.0, pr.pct_para_score / 100.0) END
    + 0.25 * CASE WHEN pr.pct_para_score IS NULL THEN 0::numeric ELSE LEAST(1.0, pr.pct_para_score / 100.0) END
    + 0.20 * LEAST(1.0, COALESCE(lc.calls_count, 0)::numeric / 5.0)
    + 0.15 * CASE WHEN o.rol = 'desconocido'::owner_role THEN 0 ELSE 1 END::numeric
    + 0.10 * CASE WHEN o.telefono IS NOT NULL AND o.telefono <> '' THEN 1 ELSE 0 END::numeric) * 100::numeric, 1) AS score,
  pr.pct_pleno, pr.pct_nuda, pr.pct_usufructo,
  COALESCE(pr.pct_fuente_edificio, 'nota') AS pct_fuente_edificio
FROM owners o
  JOIN building_owners bo ON bo.owner_id = o.id
  LEFT JOIN pct_resolved pr ON pr.owner_id = bo.owner_id AND pr.building_id = bo.building_id
  LEFT JOIN v_owner_last_contact lc ON lc.owner_id = o.id
WHERE o.merged_into IS NULL;

GRANT SELECT ON public.v_owner_score TO authenticated, service_role;

-- 5) Enlace de titulares de nota con contactos que YA existen en HubSpot (traídos a owners)
CREATE OR REPLACE FUNCTION public.enlazar_titulares_con_contactos(
  p_building_id uuid DEFAULT NULL,
  p_limit int DEFAULT 5000,
  p_dry_run boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_enlazados int := 0;
  v_dudosos int := 0;
  r record;
  c_exacto uuid;
  n_exacto int;
  c_aprox uuid;
  n_aprox int;
BEGIN
  FOR r IN
    SELECT t.id, t.nombre_extraido, t.porcentaje, n.building_id,
           public.norm_person_name(t.nombre_extraido) AS nn
    FROM public.nota_simple_titulares t
    JOIN public.notas_simples n ON n.id = t.nota_simple_id
    WHERE t.owner_id IS NULL AND t.company_id IS NULL
      AND n.building_id IS NOT NULL
      AND coalesce(n.status, 'listo') = 'listo'
      AND (p_building_id IS NULL OR n.building_id = p_building_id)
    ORDER BY t.porcentaje DESC NULLS LAST
    LIMIT greatest(p_limit, 1)
  LOOP
    IF r.nn IS NULL OR length(r.nn) < 6 THEN CONTINUE; END IF;

    SELECT count(*), min(cand.owner_id) INTO n_exacto, c_exacto
    FROM (
      SELECT bo.owner_id
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
      JOIN public.external_ids ei ON ei.entity_type = 'owner' AND ei.entity_id = o.id
        AND ei.provider = 'hubspot' AND ei.provider_object_type = 'contact'
      WHERE bo.building_id = r.building_id
        AND public.norm_person_name(o.nombre) = r.nn
    ) cand;

    IF n_exacto = 1 THEN
      IF NOT p_dry_run THEN
        UPDATE public.nota_simple_titulares
        SET owner_id = c_exacto,
            metadatos = coalesce(metadatos, '{}'::jsonb)
              || jsonb_build_object('enlace_hubspot', jsonb_build_object('modo', 'exacto', 'at', now()))
        WHERE id = r.id;
      END IF;
      v_enlazados := v_enlazados + 1;
      CONTINUE;
    END IF;

    SELECT count(*), min(cand.owner_id) INTO n_aprox, c_aprox
    FROM (
      SELECT bo.owner_id
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
      JOIN public.external_ids ei ON ei.entity_type = 'owner' AND ei.entity_id = o.id
        AND ei.provider = 'hubspot' AND ei.provider_object_type = 'contact'
      WHERE bo.building_id = r.building_id
        AND length(public.norm_person_name(o.nombre)) >= 6
        AND levenshtein(public.norm_person_name(o.nombre), r.nn) <= 2
    ) cand;

    IF n_aprox = 1 AND n_exacto = 0 THEN
      IF NOT p_dry_run THEN
        UPDATE public.nota_simple_titulares
        SET owner_id = c_aprox,
            metadatos = coalesce(metadatos, '{}'::jsonb)
              || jsonb_build_object('enlace_hubspot', jsonb_build_object('modo', 'aproximado', 'at', now()))
        WHERE id = r.id;
      END IF;
      v_enlazados := v_enlazados + 1;
    ELSIF (n_exacto > 1 OR n_aprox > 1) THEN
      v_dudosos := v_dudosos + 1;
      IF NOT p_dry_run THEN
        INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
        SELECT 9, 'nota_titular', r.id::text, r.building_id,
               coalesce(r.nombre_extraido, 'Titular') || ' · coincidencia dudosa',
               'Hay varias personas parecidas en el edificio; no se enlaza automáticamente.',
               jsonb_build_object('accion', 'revisar_enlace', 'titular_id', r.id, 'building_id', r.building_id)
        WHERE NOT EXISTS (
          SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda = 9 AND gp.entity_id = r.id::text
        );
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('enlazados', v_enlazados, 'dudosos', v_dudosos, 'dry_run', p_dry_run);
END;
$fn$;

REVOKE ALL ON FUNCTION public.enlazar_titulares_con_contactos(uuid, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enlazar_titulares_con_contactos(uuid, int, boolean) TO service_role;

-- 6) Guarda 7: titulares de la nota sin ficha (propuesta de alta, requiere aprobación humana)
CREATE OR REPLACE FUNCTION public.detect_guarda_7()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n int := 0;
BEGIN
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 7, 'nota_titular', t.id::text, n.building_id,
         coalesce(t.nombre_extraido, 'Titular sin nombre') || ' · falta darlo de alta',
         format('Consta en la nota del Registro con %s%% en %s y no tiene ficha en el sistema.',
                coalesce(round(t.porcentaje, 2)::text, 'sin'), coalesce(b.direccion, 'edificio sin dirección')),
         jsonb_build_object('accion', 'alta_titular', 'titular_id', t.id,
                            'nombre', t.nombre_extraido, 'porcentaje', t.porcentaje,
                            'building_id', n.building_id)
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples n ON n.id = t.nota_simple_id
  JOIN public.buildings b ON b.id = n.building_id
  WHERE t.owner_id IS NULL AND t.company_id IS NULL
    AND coalesce(n.status, 'listo') = 'listo'
    AND NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda = 7 AND gp.entity_id = t.id::text)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

-- 7) Guarda 8: nombres que parecen contener varias personas (solo listar, nunca separar)
CREATE OR REPLACE FUNCTION public.detect_guarda_8()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE n int := 0;
BEGIN
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 8, 'nota_titular', t.id::text, n.building_id,
         'Varias personas en un mismo nombre',
         format('«%s» (%s%%) parece contener más de una persona. Requiere revisión humana; no se separa automáticamente.',
                t.nombre_extraido, coalesce(round(t.porcentaje, 2)::text, 'sin')),
         jsonb_build_object('accion', 'revisar_nombre_multiple', 'titular_id', t.id,
                            'nombre', t.nombre_extraido, 'building_id', n.building_id)
  FROM public.nota_simple_titulares t
  JOIN public.notas_simples n ON n.id = t.nota_simple_id
  WHERE t.nombre_extraido IS NOT NULL
    AND coalesce(n.status, 'listo') = 'listo'
    AND (
      t.nombre_extraido ~* '[a-záéíóúñ]{3,}\s+[a-záéíóúñ]{3,}\s*,\s*[a-záéíóúñ]{3,}\s+[a-záéíóúñ]{3,}\s*,'
      OR t.nombre_extraido ~* '[a-záéíóúñ]{3,}\s+[a-záéíóúñ]{3,}\s+y\s+[a-záéíóúñ]{3,}\s+[a-záéíóúñ]{3,}\s+[a-záéíóúñ]{3,}'
    )
    AND NOT EXISTS (SELECT 1 FROM public.guard_proposals gp WHERE gp.guarda = 8 AND gp.entity_id = t.id::text)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$fn$;

REVOKE ALL ON FUNCTION public.detect_guarda_7() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.detect_guarda_8() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.detect_guarda_7() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_guarda_8() TO service_role;