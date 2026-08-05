CREATE OR REPLACE VIEW public.v_cola_simulada AS
WITH rel AS (
  SELECT bo.building_id,
         bo.owner_id,
         bo.cuota,
         bo.metadatos AS rel_metadatos,
         o.nombre,
         o.telefono,
         o.estado_vital,
         np.pct AS cuota_pct,
         np.invalido AS cuota_invalida,
         (COALESCE(bo.metadatos->>'cuota_match','') = 'aproximado') AS es_aprox
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
    CROSS JOIN LATERAL public.normalize_pct_propiedad((bo.cuota)::text) np(pct, normalizado, invalido, raw_value)
),
agg AS (
  SELECT building_id,
         count(*)::int AS n_owners,
         count(*) FILTER (WHERE cuota_pct IS NOT NULL)::int AS n_con_cuota,
         count(*) FILTER (WHERE es_aprox)::int AS n_aprox,
         round(COALESCE(sum(cuota_pct), 0), 2) AS suma_cuotas
    FROM rel
   GROUP BY building_id
),
ns AS (
  SELECT building_id,
         count(*)::int AS n_notas,
         count(*) FILTER (WHERE status = 'listo')::int AS n_listas,
         count(*) FILTER (WHERE status = 'listo' AND COALESCE(raw_pdf_text,'') <> '')::int AS n_listas_texto,
         max(created_at) FILTER (WHERE status = 'listo') AS ultima_nota_at
    FROM public.notas_simples
   WHERE building_id IS NOT NULL
   GROUP BY building_id
),
tz AS (
  SELECT bo.building_id,
         count(*)::int AS n_rel,
         count(*) FILTER (WHERE vos.owner_id IS NULL)::int AS n_rel_sin_dato,
         count(*) FILTER (WHERE vos.pct_origen = 'nota_simple')::int AS n_rel_nota
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
    LEFT JOIN public.v_owner_score vos
      ON vos.owner_id = bo.owner_id AND vos.building_id = bo.building_id
   GROUP BY bo.building_id
),
gp_b AS (
  SELECT edificio_id AS building_id, count(*)::int AS n
    FROM public.guard_proposals
   WHERE estado = 'pendiente' AND edificio_id IS NOT NULL
   GROUP BY edificio_id
),
gp_o AS (
  SELECT entity_id, count(*)::int AS n
    FROM public.guard_proposals
   WHERE estado = 'pendiente' AND entity_id IS NOT NULL
   GROUP BY entity_id
),
gem AS (
  SELECT building_id, count(*)::int AS n
    FROM public.deals_gemelos
   WHERE building_id IS NOT NULL
   GROUP BY building_id
),
base AS (
  SELECT r.building_id,
         r.owner_id,
         r.nombre,
         r.telefono,
         r.cuota,
         r.cuota_pct,
         r.es_aprox,
         r.estado_vital,
         b.direccion,
         b.division_horizontal,
         b.hs_deal_id,
         COALESCE(a.n_owners, 0) AS n_owners,
         COALESCE(a.n_con_cuota, 0) AS n_con_cuota,
         COALESCE(a.n_aprox, 0) AS n_aprox,
         COALESCE(a.suma_cuotas, 0) AS suma_cuotas,
         COALESCE(ns.n_notas, 0) AS n_notas,
         COALESCE(ns.n_listas, 0) AS n_notas_listas,
         COALESCE(ns.n_listas_texto, 0) AS n_notas_texto,
         ns.ultima_nota_at,
         COALESCE(tz.n_rel, 0) AS n_rel,
         COALESCE(tz.n_rel_sin_dato, 0) AS n_rel_sin_dato,
         COALESCE(tz.n_rel_nota, 0) AS n_rel_nota,
         COALESCE(gp_b.n, 0) + COALESCE(gp_o.n, 0) AS n_guardas,
         COALESCE(gem.n, 0) AS n_gemelos,
         COALESCE(vbs.score_raw, 0) AS score_activo_raw,
         COALESCE(vos.score, 0) AS score_owner,
         vos.last_call_at,
         COALESCE(vos.contactos_previos, 0) AS contactos_previos,
         vos.pct_origen,
         GREATEST(0::numeric,
           (EXTRACT(epoch FROM (now() - COALESCE(vos.last_call_at, now() - interval '365 days'))) / 86400::numeric) - 30::numeric
         ) AS dias_cadencia_vencida
    FROM rel r
    JOIN public.buildings b ON b.id = r.building_id
    LEFT JOIN agg a ON a.building_id = r.building_id
    LEFT JOIN ns ON ns.building_id = r.building_id
    LEFT JOIN tz ON tz.building_id = r.building_id
    LEFT JOIN gp_b ON gp_b.building_id = r.building_id
    LEFT JOIN gp_o ON gp_o.entity_id = r.owner_id::text
    LEFT JOIN gem ON gem.building_id = r.building_id
    LEFT JOIN public.v_building_score vbs ON vbs.id = r.building_id
    LEFT JOIN public.v_owner_score vos ON vos.owner_id = r.owner_id AND vos.building_id = r.building_id
),
flags AS (
  SELECT base.*,
    (n_notas_listas > 0) AS ck_nota_lista,
    (n_notas_texto > 0) AS ck_nota_texto,
    (n_owners >= 1) AS ck_min_owner,
    (n_owners > 0 AND n_con_cuota = n_owners) AS ck_cuotas_completas,
    (n_aprox = 0) AS ck_sin_aprox,
    (suma_cuotas BETWEEN 99 AND 101) AS ck_suma_ok,
    (telefono IS NOT NULL AND telefono <> '') AS ck_telefono,
    (n_guardas = 0) AS ck_sin_guardas,
    (n_rel > 0 AND n_rel_nota = n_rel) AS ck_trazabilidad,
    (n_rel_sin_dato > 0) AS trazabilidad_desconocida,
    (hs_deal_id IS NOT NULL AND hs_deal_id <> '') AS ck_deal,
    (COALESCE(division_horizontal, false) = false) AS ck_sin_dh,
    (n_gemelos = 0) AS ck_sin_gemelo
  FROM base
)
SELECT
  f.building_id,
  f.direccion,
  f.owner_id,
  f.nombre,
  f.telefono,
  f.cuota,
  f.cuota_pct,
  f.suma_cuotas,
  f.n_owners,
  f.n_con_cuota,
  f.n_aprox,
  f.n_notas,
  f.n_notas_listas,
  f.n_notas_texto,
  f.ultima_nota_at,
  f.n_rel,
  f.n_rel_nota,
  f.n_rel_sin_dato,
  f.n_guardas,
  f.n_gemelos,
  f.pct_origen,
  f.score_activo_raw,
  f.score_owner,
  f.contactos_previos,
  f.last_call_at,
  round(f.dias_cadencia_vencida, 1) AS dias_cadencia_vencida,
  (f.ck_nota_lista AND f.ck_nota_texto AND f.ck_min_owner AND f.ck_cuotas_completas
   AND f.ck_sin_aprox AND f.ck_suma_ok AND f.ck_telefono AND f.ck_sin_guardas
   AND f.ck_trazabilidad AND f.ck_deal AND f.ck_sin_dh AND f.ck_sin_gemelo) AS apto_publicar_estricto,
  (NOT (f.ck_nota_lista AND f.ck_nota_texto AND f.ck_min_owner AND f.ck_cuotas_completas
        AND f.ck_sin_aprox AND f.ck_suma_ok AND f.ck_telefono AND f.ck_sin_guardas
        AND f.ck_trazabilidad AND f.ck_deal AND f.ck_sin_dh AND f.ck_sin_gemelo)
   AND f.ck_min_owner AND f.ck_cuotas_completas AND f.ck_sin_aprox AND f.ck_suma_ok
   AND f.ck_telefono AND f.ck_sin_guardas AND NOT f.ck_trazabilidad) AS apto_observacion,
  jsonb_build_array(
    jsonb_build_object('key','nota_lista','label','Nota simple asociada en estado listo',
      'estado', CASE WHEN f.ck_nota_lista THEN 'PASS' WHEN f.n_notas > 0 THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', f.n_notas_listas || ' de ' || f.n_notas || ' notas en estado listo',
      'fuente','notas_simples.status'),
    jsonb_build_object('key','nota_texto','label','Nota lista con texto extraído',
      'estado', CASE WHEN f.ck_nota_texto THEN 'PASS' WHEN f.ck_nota_lista THEN 'FAIL' ELSE 'UNKNOWN' END,
      'valor', f.n_notas_texto || ' notas con texto',
      'fuente','notas_simples.raw_pdf_text'),
    jsonb_build_object('key','min_owner','label','Al menos un propietario',
      'estado', CASE WHEN f.ck_min_owner THEN 'PASS' ELSE 'FAIL' END,
      'valor', f.n_owners || ' propietarios',
      'fuente','building_owners'),
    jsonb_build_object('key','cuotas_completas','label','Todos los propietarios con porcentaje',
      'estado', CASE WHEN f.ck_cuotas_completas THEN 'PASS' ELSE 'FAIL' END,
      'valor', f.n_con_cuota || ' de ' || f.n_owners || ' con porcentaje',
      'fuente','building_owners.cuota'),
    jsonb_build_object('key','sin_aprox','label','Ningún porcentaje aproximado',
      'estado', CASE WHEN f.ck_sin_aprox THEN 'PASS' ELSE 'FAIL' END,
      'valor', f.n_aprox || ' porcentajes aproximados',
      'fuente','building_owners.metadatos.cuota_match'),
    jsonb_build_object('key','suma_ok','label','Suma de porcentajes entre 99 y 101',
      'estado', CASE WHEN f.ck_suma_ok THEN 'PASS' ELSE 'FAIL' END,
      'valor', to_char(f.suma_cuotas, 'FM990D00') || ' %',
      'fuente','building_owners.cuota (normalizado)'),
    jsonb_build_object('key','trazabilidad','label','Porcentaje con trazabilidad registral (nota simple)',
      'estado', CASE WHEN f.ck_trazabilidad THEN 'PASS' WHEN f.trazabilidad_desconocida THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', f.n_rel_nota || ' de ' || f.n_rel || ' relaciones con origen nota simple',
      'fuente','v_owner_score.pct_origen'),
    jsonb_build_object('key','telefono','label','Propietario con teléfono',
      'estado', CASE WHEN f.ck_telefono THEN 'PASS' ELSE 'FAIL' END,
      'valor', CASE WHEN f.ck_telefono THEN 'Teléfono disponible' ELSE 'Sin teléfono' END,
      'fuente','owners.telefono'),
    jsonb_build_object('key','deal','label','Negocio de HubSpot vinculado',
      'estado', CASE WHEN f.ck_deal THEN 'PASS' ELSE 'FAIL' END,
      'valor', COALESCE(f.hs_deal_id, 'sin negocio'),
      'fuente','buildings.hs_deal_id'),
    jsonb_build_object('key','sin_dh','label','Sin división horizontal',
      'estado', CASE WHEN f.division_horizontal IS NULL THEN 'UNKNOWN' WHEN f.ck_sin_dh THEN 'PASS' ELSE 'FAIL' END,
      'valor', CASE WHEN f.division_horizontal IS NULL THEN 'desconocido' WHEN f.division_horizontal THEN 'Con división horizontal' ELSE 'Sin división horizontal' END,
      'fuente','buildings.division_horizontal'),
    jsonb_build_object('key','sin_gemelo','label','Sin negocio gemelo detectado',
      'estado', CASE WHEN f.ck_sin_gemelo THEN 'PASS' ELSE 'FAIL' END,
      'valor', f.n_gemelos || ' gemelos',
      'fuente','deals_gemelos'),
    jsonb_build_object('key','sin_guardas','label','Sin guardas pendientes',
      'estado', CASE WHEN f.ck_sin_guardas THEN 'PASS' ELSE 'FAIL' END,
      'valor', f.n_guardas || ' propuestas pendientes',
      'fuente','guard_proposals')
  ) AS checkpoints,
  ARRAY_REMOVE(ARRAY[
    CASE WHEN NOT f.ck_nota_lista THEN 'Sin nota simple en estado listo' END,
    CASE WHEN f.ck_nota_lista AND NOT f.ck_nota_texto THEN 'La nota simple no tiene texto extraído' END,
    CASE WHEN NOT f.ck_min_owner THEN 'Sin propietarios' END,
    CASE WHEN NOT f.ck_cuotas_completas THEN f.n_con_cuota || ' de ' || f.n_owners || ' propietarios con porcentaje' END,
    CASE WHEN NOT f.ck_sin_aprox THEN f.n_aprox || ' porcentajes marcados como aproximados' END,
    CASE WHEN NOT f.ck_suma_ok THEN 'Suma de porcentajes ' || to_char(f.suma_cuotas,'FM990D00') || ' %' END,
    CASE WHEN NOT f.ck_telefono THEN 'Propietario sin teléfono' END,
    CASE WHEN NOT f.ck_sin_guardas THEN f.n_guardas || ' guardas pendientes' END,
    CASE WHEN NOT f.ck_trazabilidad THEN 'porcentaje_sin_trazabilidad_nota' END,
    CASE WHEN NOT f.ck_deal THEN 'Sin negocio de HubSpot vinculado' END,
    CASE WHEN NOT f.ck_sin_dh THEN 'Edificio con división horizontal' END,
    CASE WHEN NOT f.ck_sin_gemelo THEN 'Negocio gemelo sin resolver' END
  ], NULL) AS bloqueos,
  round((GREATEST(f.score_activo_raw, 10::numeric) * GREATEST(f.score_owner, 1::numeric))
        * (1::numeric + f.dias_cadencia_vencida / 30.0), 2) AS prioridad,
  'Se propone porque el activo puntúa ' || round(f.score_activo_raw) ||
  ' (score_raw, sin propietarios), el propietario ' || round(f.score_owner) ||
  ' y lleva ' || round(f.dias_cadencia_vencida) ||
  ' días de cadencia vencida. La prioridad multiplica score del activo por score del propietario y suma un 3,3 % por cada día de cadencia vencida.'
    AS prioridad_explicacion
FROM flags f;