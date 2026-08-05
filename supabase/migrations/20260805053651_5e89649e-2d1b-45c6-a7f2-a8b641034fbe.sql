DROP VIEW IF EXISTS public.v_cola_simulada;

CREATE VIEW public.v_cola_simulada AS
WITH rel AS (
  SELECT bo.building_id, bo.owner_id, bo.cuota, bo.metadatos AS rel_metadatos,
         o.nombre, o.telefono, o.estado_vital,
         np.pct AS cuota_pct, np.invalido AS cuota_invalida,
         COALESCE(bo.metadatos ->> 'cuota_match', '') = 'aproximado' AS es_aprox
  FROM building_owners bo
  JOIN owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  CROSS JOIN LATERAL normalize_pct_propiedad(bo.cuota::text) np(pct, normalizado, invalido, raw_value)
), agg AS (
  SELECT building_id, count(*)::int AS n_owners,
         count(*) FILTER (WHERE cuota_pct IS NOT NULL)::int AS n_con_cuota,
         count(*) FILTER (WHERE es_aprox)::int AS n_aprox,
         round(COALESCE(sum(cuota_pct), 0), 2) AS suma_cuotas
  FROM rel GROUP BY building_id
), ns AS (
  SELECT building_id, count(*)::int AS n_notas,
         count(*) FILTER (WHERE status = 'listo')::int AS n_listas,
         count(*) FILTER (WHERE status = 'listo' AND COALESCE(raw_pdf_text, '') <> '')::int AS n_listas_texto,
         max(created_at) FILTER (WHERE status = 'listo') AS ultima_nota_at
  FROM notas_simples WHERE building_id IS NOT NULL GROUP BY building_id
), coh AS (
  SELECT bo.building_id,
         count(*)::int AS n_rel,
         count(*) FILTER (WHERE vos.owner_id IS NULL)::int AS n_rel_sin_dato,
         count(*) FILTER (WHERE vos.pct_origen = 'nota_simple')::int AS n_rel_nota,
         count(*) FILTER (WHERE vos.pct_origen = 'nota_simple' AND vos.pct_propiedad IS NOT NULL)::int AS n_pct_nota,
         round(COALESCE(sum(vos.pct_propiedad) FILTER (WHERE vos.pct_origen = 'nota_simple'), 0), 2) AS suma_nota,
         count(*) FILTER (
           WHERE vos.pct_origen = 'nota_simple' AND vos.pct_propiedad IS NOT NULL
             AND (np.pct IS NULL OR abs(np.pct - vos.pct_propiedad) > 0.5)
         )::int AS n_incoherentes
  FROM building_owners bo
  JOIN owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  CROSS JOIN LATERAL normalize_pct_propiedad(bo.cuota::text) np(pct, normalizado, invalido, raw_value)
  LEFT JOIN v_owner_score vos ON vos.owner_id = bo.owner_id AND vos.building_id = bo.building_id
  GROUP BY bo.building_id
), gp_b AS (
  SELECT edificio_id AS building_id, count(*)::int AS n FROM guard_proposals
  WHERE estado = 'pendiente' AND edificio_id IS NOT NULL GROUP BY edificio_id
), gp_o AS (
  SELECT entity_id, count(*)::int AS n FROM guard_proposals
  WHERE estado = 'pendiente' AND entity_id IS NOT NULL GROUP BY entity_id
), gem AS (
  SELECT building_id, count(*)::int AS n FROM deals_gemelos
  WHERE building_id IS NOT NULL GROUP BY building_id
), base AS (
  SELECT r.building_id, r.owner_id, r.nombre, r.telefono, r.cuota, r.cuota_pct, r.es_aprox, r.estado_vital,
         b.direccion, b.division_horizontal, b.hs_deal_id,
         COALESCE(a.n_owners, 0) AS n_owners,
         COALESCE(a.n_con_cuota, 0) AS n_con_cuota,
         COALESCE(a.n_aprox, 0) AS n_aprox,
         COALESCE(a.suma_cuotas, 0) AS suma_cuotas,
         COALESCE(ns.n_notas, 0) AS n_notas,
         COALESCE(ns.n_listas, 0) AS n_notas_listas,
         COALESCE(ns.n_listas_texto, 0) AS n_notas_texto,
         ns.ultima_nota_at,
         COALESCE(coh.n_rel, 0) AS n_rel,
         COALESCE(coh.n_rel_sin_dato, 0) AS n_rel_sin_dato,
         COALESCE(coh.n_rel_nota, 0) AS n_rel_nota,
         COALESCE(coh.n_pct_nota, 0) AS n_pct_nota,
         COALESCE(coh.suma_nota, 0) AS suma_nota,
         COALESCE(coh.n_incoherentes, 0) AS n_incoherentes,
         COALESCE(gp_b.n, 0) + COALESCE(gp_o.n, 0) AS n_guardas,
         COALESCE(gem.n, 0) AS n_gemelos,
         COALESCE(vbs.score_raw, 0) AS score_activo_raw,
         COALESCE(vos.score, 0) AS score_owner,
         vos.last_call_at,
         COALESCE(vos.contactos_previos, 0) AS contactos_previos,
         vos.pct_origen,
         ext.entity_id AS deal_map_building_id,
         GREATEST(0::numeric, EXTRACT(epoch FROM now() - COALESCE(vos.last_call_at, now() - '365 days'::interval)) / 86400::numeric - 30::numeric) AS dias_cadencia_vencida
  FROM rel r
  JOIN buildings b ON b.id = r.building_id
  LEFT JOIN agg a ON a.building_id = r.building_id
  LEFT JOIN ns ON ns.building_id = r.building_id
  LEFT JOIN coh ON coh.building_id = r.building_id
  LEFT JOIN gp_b ON gp_b.building_id = r.building_id
  LEFT JOIN gp_o ON gp_o.entity_id = r.owner_id::text
  LEFT JOIN gem ON gem.building_id = r.building_id
  LEFT JOIN v_building_score vbs ON vbs.id = r.building_id
  LEFT JOIN v_owner_score vos ON vos.owner_id = r.owner_id AND vos.building_id = r.building_id
  LEFT JOIN LATERAL (
    SELECT e.entity_id FROM external_ids e
    WHERE e.provider = 'hubspot' AND e.entity_type = 'building'
      AND e.provider_object_type = 'deal' AND e.provider_id = b.hs_deal_id
    LIMIT 1
  ) ext ON b.hs_deal_id IS NOT NULL AND b.hs_deal_id <> ''
), flags AS (
  SELECT base.*,
    base.n_notas_listas > 0 AS ck_nota_lista,
    base.n_notas_texto > 0 AS ck_nota_texto,
    base.n_owners >= 1 AS ck_min_owner,
    base.n_owners > 0 AND base.n_con_cuota = base.n_owners AS ck_cuotas_completas,
    base.n_aprox = 0 AS ck_sin_aprox,
    base.suma_cuotas >= 99 AND base.suma_cuotas <= 101 AS ck_suma_ok,
    base.n_pct_nota > 0 AND base.suma_nota >= 99 AND base.suma_nota <= 101 AS ck_suma_nota_ok,
    base.n_pct_nota > 0 AND base.n_incoherentes = 0 AS ck_coherencia,
    base.n_pct_nota = 0 AS coherencia_desconocida,
    base.telefono IS NOT NULL AND base.telefono <> '' AS ck_telefono,
    base.n_guardas = 0 AS ck_sin_guardas,
    base.n_rel > 0 AND base.n_rel_nota = base.n_rel AS ck_trazabilidad,
    base.n_rel_sin_dato > 0 AS trazabilidad_desconocida,
    (base.hs_deal_id IS NOT NULL AND base.hs_deal_id <> '' AND base.deal_map_building_id = base.building_id) AS ck_deal,
    CASE
      WHEN base.hs_deal_id IS NULL OR base.hs_deal_id = '' THEN 'sin_deal'
      WHEN base.deal_map_building_id IS NULL THEN 'sin_mapa'
      WHEN base.deal_map_building_id <> base.building_id THEN 'conflicto'
      ELSE 'ok'
    END AS deal_estado,
    COALESCE(base.division_horizontal, false) = false AS ck_sin_dh,
    base.n_gemelos = 0 AS ck_sin_gemelo
  FROM base
)
SELECT building_id, direccion, owner_id, nombre, telefono, cuota, cuota_pct,
  suma_cuotas, suma_nota, n_pct_nota, n_incoherentes,
  n_owners, n_con_cuota, n_aprox, n_notas, n_notas_listas, n_notas_texto, ultima_nota_at,
  n_rel, n_rel_nota, n_rel_sin_dato, n_guardas, n_gemelos, pct_origen,
  hs_deal_id, deal_map_building_id, deal_estado,
  score_activo_raw, score_owner, contactos_previos, last_call_at,
  round(dias_cadencia_vencida, 1) AS dias_cadencia_vencida,
  (ck_nota_lista AND ck_nota_texto AND ck_min_owner AND ck_cuotas_completas AND ck_sin_aprox
   AND ck_suma_ok AND ck_suma_nota_ok AND ck_coherencia AND ck_telefono AND ck_sin_guardas
   AND ck_trazabilidad AND ck_deal AND ck_sin_dh AND ck_sin_gemelo) AS apto_publicar_estricto,
  (NOT (ck_nota_lista AND ck_nota_texto AND ck_min_owner AND ck_cuotas_completas AND ck_sin_aprox
        AND ck_suma_ok AND ck_suma_nota_ok AND ck_coherencia AND ck_telefono AND ck_sin_guardas
        AND ck_trazabilidad AND ck_deal AND ck_sin_dh AND ck_sin_gemelo)
   AND ck_min_owner AND ck_cuotas_completas AND ck_sin_aprox AND ck_suma_ok AND ck_telefono
   AND ck_sin_guardas AND ck_deal AND n_incoherentes = 0 AND NOT ck_trazabilidad) AS apto_observacion,
  jsonb_build_array(
    jsonb_build_object('key','nota_lista','label','Nota simple asociada en estado listo','estado',
      CASE WHEN ck_nota_lista THEN 'PASS' WHEN n_notas > 0 THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', n_notas_listas || ' de ' || n_notas || ' notas en estado listo', 'fuente','notas_simples.status'),
    jsonb_build_object('key','nota_texto','label','Nota lista con texto extraído','estado',
      CASE WHEN ck_nota_texto THEN 'PASS' WHEN ck_nota_lista THEN 'FAIL' ELSE 'UNKNOWN' END,
      'valor', n_notas_texto || ' notas con texto', 'fuente','notas_simples.raw_pdf_text'),
    jsonb_build_object('key','min_owner','label','Al menos un propietario','estado',
      CASE WHEN ck_min_owner THEN 'PASS' ELSE 'FAIL' END,
      'valor', n_owners || ' propietarios', 'fuente','building_owners'),
    jsonb_build_object('key','cuotas_completas','label','Todos los propietarios con porcentaje','estado',
      CASE WHEN ck_cuotas_completas THEN 'PASS' ELSE 'FAIL' END,
      'valor', n_con_cuota || ' de ' || n_owners || ' con porcentaje', 'fuente','building_owners.cuota'),
    jsonb_build_object('key','sin_aprox','label','Ningún porcentaje aproximado','estado',
      CASE WHEN ck_sin_aprox THEN 'PASS' ELSE 'FAIL' END,
      'valor', n_aprox || ' porcentajes aproximados', 'fuente','building_owners.metadatos.cuota_match'),
    jsonb_build_object('key','suma_ok','label','Suma de porcentajes operativos entre 99 y 101','estado',
      CASE WHEN ck_suma_ok THEN 'PASS' ELSE 'FAIL' END,
      'valor', to_char(suma_cuotas, 'FM990D00') || ' %', 'fuente','building_owners.cuota (normalizado)'),
    jsonb_build_object('key','suma_nota','label','Suma de porcentajes de nota simple entre 99 y 101','estado',
      CASE WHEN ck_suma_nota_ok THEN 'PASS' WHEN coherencia_desconocida THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', to_char(suma_nota, 'FM990D00') || ' % (' || n_pct_nota || ' relaciones con % de nota)',
      'fuente','v_owner_score.pct_propiedad (pct_origen = nota_simple)'),
    jsonb_build_object('key','coherencia_cuota_nota','label','Cuota operativa coherente con la nota simple','estado',
      CASE WHEN ck_coherencia THEN 'PASS' WHEN coherencia_desconocida THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', CASE WHEN coherencia_desconocida THEN 'Sin porcentajes de nota simple'
               ELSE n_incoherentes || ' de ' || n_pct_nota || ' relaciones discrepantes · operativo '
                    || to_char(suma_cuotas,'FM990D00') || ' % vs nota ' || to_char(suma_nota,'FM990D00') || ' %' END,
      'fuente','building_owners.cuota vs v_owner_score.pct_propiedad'),
    jsonb_build_object('key','trazabilidad','label','Porcentaje con trazabilidad registral (nota simple)','estado',
      CASE WHEN ck_trazabilidad THEN 'PASS' WHEN trazabilidad_desconocida THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', n_rel_nota || ' de ' || n_rel || ' relaciones con origen nota simple', 'fuente','v_owner_score.pct_origen'),
    jsonb_build_object('key','telefono','label','Propietario con teléfono','estado',
      CASE WHEN ck_telefono THEN 'PASS' ELSE 'FAIL' END,
      'valor', CASE WHEN ck_telefono THEN 'Teléfono disponible' ELSE 'Sin teléfono' END, 'fuente','owners.telefono'),
    jsonb_build_object('key','deal','label','Negocio de HubSpot vinculado y coherente','estado',
      CASE WHEN deal_estado = 'ok' THEN 'PASS' WHEN deal_estado = 'sin_mapa' THEN 'UNKNOWN' ELSE 'FAIL' END,
      'valor', CASE
        WHEN deal_estado = 'sin_deal' THEN 'sin negocio'
        WHEN deal_estado = 'sin_mapa' THEN COALESCE(hs_deal_id,'') || ' sin registro en external_ids'
        WHEN deal_estado = 'conflicto' THEN COALESCE(hs_deal_id,'') || ' mapeado a otro edificio (' || deal_map_building_id::text || ')'
        ELSE COALESCE(hs_deal_id,'') END,
      'fuente','buildings.hs_deal_id vs external_ids(hubspot/deal)'),
    jsonb_build_object('key','sin_dh','label','Sin división horizontal','estado',
      CASE WHEN division_horizontal IS NULL THEN 'UNKNOWN' WHEN ck_sin_dh THEN 'PASS' ELSE 'FAIL' END,
      'valor', CASE WHEN division_horizontal IS NULL THEN 'desconocido'
                    WHEN division_horizontal THEN 'Con división horizontal'
                    ELSE 'Sin división horizontal' END, 'fuente','buildings.division_horizontal'),
    jsonb_build_object('key','sin_gemelo','label','Sin negocio gemelo detectado','estado',
      CASE WHEN ck_sin_gemelo THEN 'PASS' ELSE 'FAIL' END,
      'valor', n_gemelos || ' gemelos', 'fuente','deals_gemelos'),
    jsonb_build_object('key','sin_guardas','label','Sin guardas pendientes','estado',
      CASE WHEN ck_sin_guardas THEN 'PASS' ELSE 'FAIL' END,
      'valor', n_guardas || ' propuestas pendientes', 'fuente','guard_proposals')
  ) AS checkpoints,
  array_remove(ARRAY[
    CASE WHEN NOT ck_nota_lista THEN 'Sin nota simple en estado listo' END,
    CASE WHEN ck_nota_lista AND NOT ck_nota_texto THEN 'La nota simple no tiene texto extraído' END,
    CASE WHEN NOT ck_min_owner THEN 'Sin propietarios' END,
    CASE WHEN NOT ck_cuotas_completas THEN n_con_cuota || ' de ' || n_owners || ' propietarios con porcentaje' END,
    CASE WHEN NOT ck_sin_aprox THEN n_aprox || ' porcentajes marcados como aproximados' END,
    CASE WHEN NOT ck_suma_ok THEN 'Suma de porcentajes operativos ' || to_char(suma_cuotas,'FM990D00') || ' %' END,
    CASE WHEN NOT ck_suma_nota_ok AND NOT coherencia_desconocida THEN 'Suma de porcentajes de nota simple ' || to_char(suma_nota,'FM990D00') || ' %' END,
    CASE WHEN coherencia_desconocida THEN 'Sin porcentajes de nota simple para contrastar' END,
    CASE WHEN n_incoherentes > 0 THEN 'cuota_operativa_incoherente_con_nota (' || to_char(suma_cuotas,'FM990D00') || ' % vs ' || to_char(suma_nota,'FM990D00') || ' %)' END,
    CASE WHEN NOT ck_telefono THEN 'Propietario sin teléfono' END,
    CASE WHEN NOT ck_sin_guardas THEN n_guardas || ' guardas pendientes' END,
    CASE WHEN NOT ck_trazabilidad THEN 'porcentaje_sin_trazabilidad_nota' END,
    CASE WHEN deal_estado = 'sin_deal' THEN 'Sin negocio de HubSpot vinculado' END,
    CASE WHEN deal_estado = 'sin_mapa' THEN 'Negocio de HubSpot sin registro en external_ids' END,
    CASE WHEN deal_estado = 'conflicto' THEN 'Negocio de HubSpot mapeado a otro edificio' END,
    CASE WHEN NOT ck_sin_dh THEN 'Edificio con división horizontal' END,
    CASE WHEN NOT ck_sin_gemelo THEN 'Negocio gemelo sin resolver' END
  ], NULL) AS bloqueos,
  round(GREATEST(score_activo_raw, 10) * GREATEST(score_owner, 1) * (1 + dias_cadencia_vencida / 30.0), 2) AS prioridad,
  'Se propone porque el activo puntúa ' || round(score_activo_raw)
    || ' (score_raw, sin propietarios), el propietario ' || round(score_owner)
    || ' y lleva ' || round(dias_cadencia_vencida)
    || ' días de cadencia vencida. La prioridad multiplica score del activo por score del propietario y suma un 3,3 % por cada día de cadencia vencida.' AS prioridad_explicacion
FROM flags f;

GRANT SELECT ON public.v_cola_simulada TO authenticated;