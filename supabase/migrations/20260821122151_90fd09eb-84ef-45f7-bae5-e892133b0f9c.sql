CREATE OR REPLACE FUNCTION public.get_scoring_cards()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH owner_counts AS (
    SELECT bo.building_id, count(DISTINCT bo.owner_id)::int AS owners_count
    FROM public.building_owners bo
    WHERE COALESCE(bo.rol_notas, '') NOT ILIKE '%representante%'
      AND COALESCE(bo.rol_notas, '') NOT ILIKE '%apoderado%'
    GROUP BY bo.building_id
  ),
  company_counts AS (
    SELECT bc.building_id, count(DISTINCT bc.company_id)::int AS company_count
    FROM public.building_companies bc
    WHERE COALESCE(bc.role::text, '') = ANY (ARRAY['titular','usufructuario','arrendador','otro'])
    GROUP BY bc.building_id
  ),
  assigned AS (
    SELECT ba.building_id
    FROM public.building_assignments ba
    WHERE ba.user_id = auth.uid() AND ba.status = 'active'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id, 'direccion', b.direccion, 'ciudad', b.ciudad,
    'barrio', COALESCE(b.barrio, b.metadatos->>'barrio', b.metadatos->>'hs_barrio'),
    'distrito', COALESCE(b.distrito, b.metadatos->>'distrito', b.metadatos->>'hs_distrito'),
    'division_horizontal', b.division_horizontal,
    'num_viviendas', COALESCE(NULLIF(b.metadatos->>'viviendas__unidades___clonada_', '')::int, NULLIF(b.metadatos->>'viviendas__unidades_', '')::int, NULLIF(b.metadatos->>'num_viviendas', '')::int),
    'm2_total', NULLIF(b.metadatos->>'metros_cuadrados__exactos_', '')::numeric,
    'owners_count', COALESCE(bo.owners_count, 0) + COALESCE(cc.company_count, 0),
    'score', COALESCE(b.cluster_score, b.score, 0), 'score_activo', b.score_activo,
    'score_propietarios', b.score_propietarios, 'score_total', b.score_total,
    'porcentajes_estado', b.porcentajes_estado, 'es_estrella', COALESCE(b.es_estrella, false),
    'avisos_inteligentes', b.avisos_inteligentes,
    'score_summary', CASE
        WHEN b.score_summary IS NULL THEN NULL
        WHEN strpos(b.score_summary, '.') = 0 THEN b.score_summary
        ELSE split_part(b.score_summary, '.', 1) || '.' || split_part(b.score_summary, '.', 2)
      END,
    'score_breakdown', CASE
        WHEN jsonb_typeof(b.score_breakdown) = 'array' THEN jsonb_path_query_array(b.score_breakdown, '$[0 to 2]')
        ELSE b.score_breakdown
      END,
    'confianza_media', b.confianza_media,
    'cartera_demo_seed', COALESCE(b.cartera_demo_seed, false), 'cluster_asignado', b.cluster_asignado,
    'comercial', b.comercial, 'iee_estado', b.iee_estado,
    'metadatos', jsonb_build_object('tenemos_la_nota_simple_', b.metadatos->>'tenemos_la_nota_simple_', 'barrio', b.metadatos->>'barrio', 'distrito', b.metadatos->>'distrito'),
    'has_analysis', ba.building_id IS NOT NULL, 'ventanas_fachada_total', ba.ventanas_fachada_total,
    'ventanas_patios_total', ba.ventanas_patios_total, 'segundas_escaleras', ba.segundas_escaleras,
    'plantas_levantables', ba.plantas_levantables, 'tiene_azotea_transitable', ba.tiene_azotea_transitable,
    'esquina', ba.esquina, 'protegido_historicamente', ba.protegido_historicamente,
    'edificio_reformado', ba.edificio_reformado, 'gestion_profesional', ba.gestion_profesional,
    'prior_count', 0, 'assigned', a.building_id IS NOT NULL
  ) ORDER BY COALESCE(b.score_total, b.score, b.cluster_score, 0) DESC, b.id), '[]'::jsonb)
  FROM public.buildings b
  LEFT JOIN owner_counts bo ON bo.building_id = b.id
  LEFT JOIN company_counts cc ON cc.building_id = b.id
  LEFT JOIN public.building_analysis ba ON ba.building_id = b.id
  LEFT JOIN assigned a ON a.building_id = b.id
  WHERE auth.uid() IS NOT NULL;
$fn$;