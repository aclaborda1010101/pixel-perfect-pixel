
-- Clave aproximada: dos últimos tokens (apellidos) + inicial del nombre
CREATE OR REPLACE FUNCTION public.person_match_key(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT regexp_split_to_array(
      btrim(regexp_replace(public.normalize_person_name(coalesce(p_name,'')), '\s+', ' ', 'g')), ' '
    ) AS a
  )
  SELECT CASE
    WHEN array_length(a,1) IS NULL OR array_length(a,1) < 3 THEN NULL
    ELSE a[array_length(a,1)-1] || ' ' || a[array_length(a,1)] || ' ' || left(a[1],1)
  END
  FROM t;
$$;

CREATE OR REPLACE VIEW public.v_titularidad_registral AS
WITH nota_principal AS (
  SELECT DISTINCT ON (n.building_id)
         n.building_id, n.id AS nota_id, n.structured_json, n.created_at
  FROM notas_simples n
  WHERE n.building_id IS NOT NULL AND n.status = 'listo'
  ORDER BY n.building_id,
    (SELECT count(*) FROM nota_simple_titulares t
      WHERE t.nota_simple_id = n.id AND t.porcentaje IS NOT NULL) DESC,
    n.created_at DESC
)
SELECT
  np.building_id,
  np.nota_id,
  (np.structured_json ->> 'fecha_emision_nota') AS fecha_emision_nota,
  t.id AS titular_id,
  t.nombre_extraido,
  t.cif_dni,
  t.porcentaje,
  t.rol::text AS rol,
  (
    coalesce(t.company_id, NULL) IS NOT NULL
    OR (t.cif_dni ~* '^[ABCDEFGHJNPQRSUVW]')
    OR (public.normalize_person_name(t.nombre_extraido) ~ '(^| )(SL|SA|SLU|SAU|SOCIEDAD|INVERSIONES|PATRIMONIO|PATRIMONIAL|INMOBILIARIA)( |$)')
  ) AS es_sociedad,
  EXISTS (
    SELECT 1 FROM building_owners bo
    WHERE bo.building_id = np.building_id
      AND (
        bo.owner_name_norm = public.normalize_person_name(t.nombre_extraido)
        OR (public.person_match_key(t.nombre_extraido) IS NOT NULL
            AND public.person_match_key(bo.owner_name_norm) = public.person_match_key(t.nombre_extraido))
      )
  ) AS tiene_contacto_crm
FROM nota_principal np
JOIN nota_simple_titulares t ON t.nota_simple_id = np.nota_id;

GRANT SELECT ON public.v_titularidad_registral TO authenticated;
GRANT SELECT ON public.v_titularidad_registral TO service_role;

-- Volcado de cuotas: exacto + segundo intento aproximado (único candidato)
CREATE OR REPLACE FUNCTION public.volcar_cuotas_desde_notas()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_upd int := 0; v_edif int := 0; v_aprox int := 0;
BEGIN
  WITH nota_principal AS (
    SELECT DISTINCT ON (n.building_id) n.building_id, n.id AS nota_id
    FROM notas_simples n
    WHERE n.building_id IS NOT NULL AND n.status='listo'
    ORDER BY n.building_id,
      (SELECT count(*) FROM nota_simple_titulares t WHERE t.nota_simple_id=n.id AND t.porcentaje IS NOT NULL) DESC,
      n.created_at DESC
  ), pct AS (
    SELECT np.building_id,
           public.normalize_person_name(t.nombre_extraido) AS nn,
           least(100, round(sum(t.porcentaje)::numeric, 4)) AS cuota
    FROM nota_principal np
    JOIN nota_simple_titulares t ON t.nota_simple_id = np.nota_id
    WHERE t.porcentaje IS NOT NULL AND nullif(t.nombre_extraido,'') IS NOT NULL
    GROUP BY 1,2
  ), upd AS (
    UPDATE building_owners bo
       SET cuota = p.cuota,
           metadatos = coalesce(bo.metadatos,'{}'::jsonb)
                       || jsonb_build_object('cuota_origen','nota_simple_principal','cuota_match','exacto','cuota_fecha', now()::text)
    FROM pct p
    WHERE bo.building_id = p.building_id
      AND bo.owner_name_norm = p.nn
      AND (bo.cuota IS NULL OR bo.cuota <> p.cuota)
    RETURNING bo.building_id
  )
  SELECT count(*), count(DISTINCT building_id) INTO v_upd, v_edif FROM upd;

  -- Segundo intento: por apellidos + inicial, solo si hay UN único candidato en ambos lados
  WITH nota_principal AS (
    SELECT DISTINCT ON (n.building_id) n.building_id, n.id AS nota_id
    FROM notas_simples n
    WHERE n.building_id IS NOT NULL AND n.status='listo'
    ORDER BY n.building_id,
      (SELECT count(*) FROM nota_simple_titulares t WHERE t.nota_simple_id=n.id AND t.porcentaje IS NOT NULL) DESC,
      n.created_at DESC
  ), pct AS (
    SELECT np.building_id,
           public.person_match_key(t.nombre_extraido) AS mk,
           least(100, round(sum(t.porcentaje)::numeric, 4)) AS cuota,
           count(DISTINCT public.normalize_person_name(t.nombre_extraido)) AS n_nombres
    FROM nota_principal np
    JOIN nota_simple_titulares t ON t.nota_simple_id = np.nota_id
    WHERE t.porcentaje IS NOT NULL
      AND public.person_match_key(t.nombre_extraido) IS NOT NULL
      AND NOT (t.cif_dni ~* '^[ABCDEFGHJNPQRSUVW]')
    GROUP BY 1,2
  ), pct1 AS (
    SELECT * FROM pct WHERE n_nombres = 1
  ), cands AS (
    SELECT bo.building_id, bo.owner_id, public.person_match_key(bo.owner_name_norm) AS mk
    FROM building_owners bo
    WHERE bo.cuota IS NULL AND public.person_match_key(bo.owner_name_norm) IS NOT NULL
  ), uniq AS (
    SELECT c.building_id, c.mk, min(c.owner_id::text)::uuid AS owner_id, count(*) AS n
    FROM cands c
    GROUP BY 1,2
  ), upd2 AS (
    UPDATE building_owners bo
       SET cuota = p.cuota,
           metadatos = coalesce(bo.metadatos,'{}'::jsonb)
                       || jsonb_build_object('cuota_origen','nota_simple_principal','cuota_match','aproximado','cuota_fecha', now()::text)
    FROM pct1 p
    JOIN uniq u ON u.building_id = p.building_id AND u.mk = p.mk AND u.n = 1
    WHERE bo.building_id = u.building_id
      AND bo.owner_id = u.owner_id
      AND bo.cuota IS NULL
    RETURNING bo.building_id
  )
  SELECT count(*) INTO v_aprox FROM upd2;

  RETURN jsonb_build_object('cuotas_actualizadas', v_upd, 'edificios', v_edif, 'cuotas_aproximadas', v_aprox);
END $function$;
