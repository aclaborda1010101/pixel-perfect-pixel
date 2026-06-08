
-- 1) madrid_calles_subzona
CREATE TABLE IF NOT EXISTS public.madrid_calles_subzona (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  calle_norm text NOT NULL,
  numero_desde integer,
  numero_hasta integer,
  barrio text,
  sub_zona text NOT NULL,
  cluster_override text NOT NULL,
  notas text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.madrid_calles_subzona TO authenticated, anon;
GRANT ALL ON public.madrid_calles_subzona TO service_role;
ALTER TABLE public.madrid_calles_subzona ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "calles_subzona_read" ON public.madrid_calles_subzona;
CREATE POLICY "calles_subzona_read" ON public.madrid_calles_subzona FOR SELECT TO authenticated, anon USING (true);
CREATE INDEX IF NOT EXISTS idx_calles_subzona_calle_norm ON public.madrid_calles_subzona (calle_norm);

INSERT INTO public.madrid_calles_subzona (calle_norm, barrio, sub_zona, cluster_override, notas) VALUES
  ('almagro','almagro','chamberi_prime','prime_value_add','Almagro'),
  ('genova','almagro','chamberi_prime','prime_value_add','Génova'),
  ('sagasta','almagro','chamberi_prime','prime_value_add','Sagasta'),
  ('fortuny','almagro','chamberi_prime','prime_value_add','Fortuny'),
  ('fernando el santo','almagro','chamberi_prime','prime_value_add','Fernando el Santo'),
  ('zurbano','almagro','chamberi_prime','prime_value_add','Zurbano'),
  ('zurbaran','almagro','chamberi_prime','prime_value_add','Zurbarán'),
  ('eduardo dato','almagro','chamberi_prime','prime_value_add','Pº Eduardo Dato'),
  ('rafael calvo','almagro','chamberi_prime','prime_value_add','Rafael Calvo'),
  ('gaztambide','arapiles','chamberi_flex','flex_living_core','Gaztambide (feedback)'),
  ('vallehermoso','gaztambide','chamberi_flex','flex_living_core','Vallehermoso'),
  ('hilarion eslava','gaztambide','chamberi_flex','flex_living_core','Hilarión Eslava'),
  ('magallanes','trafalgar','chamberi_flex','flex_living_core','Magallanes'),
  ('galileo','gaztambide','chamberi_flex','flex_living_core','Galileo'),
  ('donoso cortes','gaztambide','chamberi_flex','flex_living_core','Donoso Cortés'),
  ('andres mellado','gaztambide','chamberi_flex','flex_living_core','Andrés Mellado'),
  ('fernandez de los rios','arapiles','chamberi_flex','flex_living_core','Fernández de los Ríos'),
  ('cardenal cisneros','trafalgar','chamberi_flex','flex_living_core','Cardenal Cisneros'),
  ('serrano','recoletos','salamanca_prime','ultra_prime','Serrano'),
  ('velazquez','recoletos','salamanca_prime','ultra_prime','Velázquez'),
  ('castello','recoletos','salamanca_prime','prime_value_add','Castelló'),
  ('lagasca','recoletos','salamanca_prime','prime_value_add','Lagasca'),
  ('recoletos','recoletos','salamanca_prime','ultra_prime','Pº Recoletos'),
  ('claudio coello','recoletos','salamanca_prime','prime_value_add','Claudio Coello'),
  ('jose ortega y gasset','recoletos','salamanca_prime','prime_value_add','Ortega y Gasset'),
  ('hermosilla','recoletos','salamanca_prime','prime_value_add','Hermosilla'),
  ('porvenir','guindalera','salamanca_flex','flex_living_core','Porvenir (feedback)'),
  ('cartagena','guindalera','salamanca_flex','flex_living_core','Cartagena'),
  ('francisco silvela','guindalera','salamanca_flex','flex_living_core','Francisco Silvela'),
  ('pilar de zaragoza','guindalera','salamanca_flex','flex_living_core','Pilar de Zaragoza'),
  ('martinez izquierdo','guindalera','salamanca_flex','flex_living_core','Martínez Izquierdo'),
  ('fuente del berro','fuente del berro','salamanca_flex','flex_living_core','Fuente del Berro')
ON CONFLICT DO NOTHING;

-- 2) madrid_edificios_protegidos
CREATE TABLE IF NOT EXISTS public.madrid_edificios_protegidos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refcat text,
  refcat_norm text,
  direccion text,
  direccion_norm text,
  nivel_proteccion text,
  fuente text NOT NULL DEFAULT 'pgou_catalogo',
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.madrid_edificios_protegidos TO authenticated, anon;
GRANT ALL ON public.madrid_edificios_protegidos TO service_role;
ALTER TABLE public.madrid_edificios_protegidos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "protegidos_read" ON public.madrid_edificios_protegidos;
CREATE POLICY "protegidos_read" ON public.madrid_edificios_protegidos FOR SELECT TO authenticated, anon USING (true);
CREATE INDEX IF NOT EXISTS idx_protegidos_refcat_norm ON public.madrid_edificios_protegidos (refcat_norm);

ALTER TABLE public.building_analysis ADD COLUMN IF NOT EXISTS proteccion_source text;

-- 3) Vista v_building_score con owners_count deduplicado (DROP+CREATE para cambiar columnas)
DROP VIEW IF EXISTS public.v_building_score CASCADE;
CREATE VIEW public.v_building_score AS
WITH agg AS (
  SELECT b.id, b.direccion, b.ciudad, b.division_horizontal,
    b.metadatos AS md, b.numero_propietarios,
    NULLIF(b.metadatos->>'metros_cuadrados__exactos_','')::numeric AS m2_exactos,
    NULLIF(b.metadatos->>'metros_cuadrados__rango_','') AS m2_rango,
    COALESCE(
      NULLIF(b.metadatos->>'viviendas__unidades___clonada_','')::integer,
      NULLIF(b.metadatos->>'viviendas__unidades_','')::integer,
      NULLIF(b.metadatos->>'num_viviendas','')::integer
    ) AS viviendas_unidades,
    public.count_distinct_owners(b.id) AS owners_count
  FROM public.buildings b
), scored AS (
  SELECT agg.*,
    agg.m2_exactos AS m2_total, agg.viviendas_unidades AS num_viviendas,
    LEAST(1.0, COALESCE(agg.viviendas_unidades,0)::numeric / 40.0) AS s_viviendas,
    LEAST(1.0, COALESCE(agg.m2_exactos,0::numeric) / 4000.0) AS s_m2,
    CASE WHEN agg.viviendas_unidades > 0 AND agg.m2_exactos IS NOT NULL
      THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, agg.m2_exactos / NULLIF(agg.viviendas_unidades,0)::numeric / 150.0))
      ELSE 0::numeric END AS s_ratio,
    CASE
      WHEN agg.owners_count >= 10 THEN 1.00
      WHEN agg.owners_count >= 7  THEN 0.90
      WHEN agg.owners_count >= 5  THEN 0.75
      WHEN agg.owners_count = 4   THEN 0.55
      WHEN agg.owners_count >= 2  THEN 0.30
      ELSE 0::numeric END AS s_owners,
    CASE WHEN agg.division_horizontal IS FALSE THEN 1.0 ELSE 0::numeric END AS s_no_dh,
    NULLIF(agg.md->>'metros_cuadrados_comercio','')::numeric AS m2_comercio_x,
    COALESCE(NULLIF(agg.md->>'metros_cuadrados_oficina',''), NULLIF(agg.md->>'metros_cuadrado_oficina',''))::numeric AS m2_oficina_x,
    NULLIF(agg.md->>'metros_cuadrados_almacen','')::numeric AS m2_almacen_x,
    NULLIF(agg.md->>'metros_cuadrados_industrial','')::numeric AS m2_industrial_x
  FROM agg
), ai AS (
  SELECT s.*, ba.id IS NOT NULL AS has_ai_analysis,
    ba.ventanas_fachada_total, ba.esquina, ba.segundas_escaleras,
    ba.protegido_historicamente, ba.plantas_levantables,
    ba.patios_detectados, ba.confidence,
    CASE WHEN ba.metricas_extra ? 'intencion_venta'
      THEN NULLIF(ba.metricas_extra->>'intencion_venta','')::boolean ELSE NULL::boolean END AS intencion_venta
  FROM scored s LEFT JOIN public.building_analysis ba ON ba.building_id = s.id
), calc AS (
  SELECT ai.*,
    round( (0.25*ai.s_m2 + 0.15*ai.s_viviendas + 0.20*ai.s_ratio + 0.20*ai.s_owners
          + 0.10*ai.s_no_dh + 0.10*CASE WHEN ai.has_ai_analysis THEN COALESCE(ai.confidence,0.5) ELSE 0 END
          ) * 100, 1) AS score_raw
  FROM ai
)
SELECT c.*, c.score_raw AS score,
  jsonb_build_array(
    jsonb_build_object('key','m2','label','Tamaño','pct',round(c.s_m2*100,0),'weight',25),
    jsonb_build_object('key','viv','label','Nº viviendas','pct',round(c.s_viviendas*100,0),'weight',15),
    jsonb_build_object('key','ratio','label','Ratio m²/viv','pct',round(c.s_ratio*100,0),'weight',20),
    jsonb_build_object('key','owners','label','Propietarios','pct',round(c.s_owners*100,0),'weight',20),
    jsonb_build_object('key','no_dh','label','Sin DH','pct',round(c.s_no_dh*100,0),'weight',10),
    jsonb_build_object('key','ai','label','Confianza IA','pct',round(COALESCE(c.confidence,0.5)*100,0),'weight',10)
  ) AS score_breakdown
FROM calc c;

GRANT SELECT ON public.v_building_score TO authenticated, anon, service_role;

-- 4) compute_cluster_score con lookup por calle + label tamaño claro
CREATE OR REPLACE FUNCTION public.compute_cluster_score(p_building_id uuid)
 RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  b record; ba public.building_analysis%ROWTYPE; md jsonb;
  v_barrio_norm text; v_calle_norm text; v_calle_subzona text; v_calle_override text;
  v_cluster text; v_cluster_secundario text;
  v_m2 numeric; v_viv integer; v_owners integer; v_owners_raw integer; v_ratio numeric;
  v_mg integer; v_score numeric:=0; v_breakdown jsonb:='[]'::jsonb; v_avisos jsonb:='[]'::jsonb;
  v_motivo text:=''; v_calle_tipo text; v_pen numeric:=0; v_bonus numeric:=0;
  v_terciario_m2 numeric; v_terciario_pct numeric;
  v_n_escaleras integer; v_protegido boolean; v_aviso_cambio_uso boolean:=false;
  s_tamano numeric:=0; w_tamano numeric:=0; rango_tamano text;
  s_ratio numeric:=0; w_ratio numeric:=0; rango_ratio text;
  s_viv numeric:=0; w_viv numeric:=0; s_own numeric:=0; w_own numeric:=0;
  s_mg numeric:=0; w_mg numeric:=0; s_local numeric:=0; w_local numeric:=0;
BEGIN
  SELECT * INTO b FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  md := COALESCE(b.metadatos,'{}'::jsonb);
  SELECT * INTO ba FROM public.building_analysis WHERE building_id = p_building_id;

  v_barrio_norm := normalize_barrio(md->>'barrios_completos__clonada_');
  v_calle_norm := normalize_barrio(b.direccion);

  -- LOOKUP CALLE (subzona) gana sobre barrio
  SELECT sub_zona, cluster_override INTO v_calle_subzona, v_calle_override
  FROM public.madrid_calles_subzona
  WHERE v_calle_norm LIKE '%' || calle_norm || '%'
  ORDER BY length(calle_norm) DESC LIMIT 1;

  IF v_calle_override IS NOT NULL THEN
    v_cluster := v_calle_override;
    v_motivo := 'subzona ' || v_calle_subzona || ' → ' || v_cluster;
  ELSE
    SELECT cluster, cluster_secundario INTO v_cluster, v_cluster_secundario
    FROM public.madrid_barrio_clusters WHERE barrio_norm = v_barrio_norm;
    IF v_cluster IS NULL THEN
      v_cluster := 'baja_prioridad'; v_motivo := 'barrio no clasificado → baja_prioridad';
    ELSE
      v_motivo := 'barrio ' || coalesce(md->>'barrios_completos__clonada_','?') || ' → ' || v_cluster;
    END IF;
  END IF;

  v_m2 := NULLIF(md->>'metros_cuadrados__exactos_','')::numeric;
  v_viv := COALESCE(NULLIF(md->>'viviendas__unidades___clonada_','')::integer,
    NULLIF(md->>'viviendas__unidades_','')::integer, NULLIF(md->>'num_viviendas','')::integer);
  v_owners_raw := (SELECT count(*)::integer FROM building_owners bo WHERE bo.building_id = p_building_id);
  v_owners := public.count_distinct_owners(p_building_id);
  v_ratio := CASE WHEN v_viv>0 AND v_m2 IS NOT NULL THEN v_m2/v_viv ELSE NULL END;
  v_mg := COALESCE(ba.mala_gestion_score, 0);
  v_n_escaleras := COALESCE(ba.n_escaleras_en_piso01, 0);
  v_protegido := COALESCE(ba.protegido_historicamente, false);

  v_terciario_m2 := COALESCE(NULLIF(md->>'metros_cuadrado_oficina','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_comercio','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_ocio_hostel','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_industrial','')::numeric,0);
  v_terciario_pct := CASE WHEN COALESCE(v_m2,0) > 0 THEN v_terciario_m2 / v_m2 ELSE NULL END;

  IF v_cluster = 'ultra_prime' AND COALESCE(v_m2,0) < 1000 THEN
    v_avisos := v_avisos || jsonb_build_object('key','ultra_prime_no_aplica',
      'label','Ultra Prime degradado','severity','medium',
      'detail','Barrio mapea a ultra_prime pero el edificio tiene ' || COALESCE(v_m2::text,'?') ||
              ' m² (<1000 m² requeridos). Reclasificado como prime_value_add.');
    v_cluster := 'prime_value_add';
    v_motivo := v_motivo || ' · degradado (tamaño insuficiente para institucional)';
  END IF;

  IF v_protegido AND v_n_escaleras >= 2 THEN
    v_aviso_cambio_uso := true;
    v_avisos := v_avisos || jsonb_build_object('key','cambio_uso_hospedaje',
      'label','Apto cambio de uso a hospedaje','severity','high',
      'detail','Cumple las dos condiciones críticas del PGOU Madrid: edificio protegido y ≥2 cajas de escalera.');
    IF COALESCE(v_terciario_pct,0) >= 0.66 THEN
      v_avisos := v_avisos || jsonb_build_object('key','ultra_prime_cambio_uso',
        'label','Ultra Prime · cambio de uso terciario','severity','high',
        'detail','Terciario ' || round(v_terciario_pct*100,0)::text || '% + protegido + ≥2 escaleras → hotel/coliving premium.');
      v_cluster := 'ultra_prime';
      v_motivo := v_motivo || ' · upgrade ultra_prime por cambio de uso terciario';
    END IF;
  END IF;

  IF v_cluster = 'ultra_prime' THEN
    w_tamano:=20; w_ratio:=20; w_own:=20; w_mg:=25; w_viv:=0; w_local:=15;
    s_tamano := CASE WHEN v_m2 BETWEEN 1500 AND 4000 THEN 1.0
      WHEN v_m2 BETWEEN 1000 AND 1500 OR v_m2 BETWEEN 4000 AND 5000 THEN 0.5 ELSE 0 END;
    rango_tamano := '1500-4000';
    s_ratio := CASE WHEN v_ratio BETWEEN 90 AND 160 THEN 1.0
      WHEN v_ratio BETWEEN 50 AND 90 THEN 0.5 WHEN v_ratio < 50 THEN 0.2 ELSE 0.3 END;
    rango_ratio := '90-160';
  ELSIF v_cluster = 'prime_value_add' THEN
    w_tamano:=20; w_ratio:=25; w_viv:=15; w_own:=20; w_mg:=20; w_local:=0;
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0
      WHEN v_m2 BETWEEN 500 AND 800 OR v_m2 BETWEEN 1800 AND 2500 THEN 0.5 ELSE 0 END;
    rango_tamano := '800-1800';
    s_ratio := CASE WHEN v_ratio BETWEEN 60 AND 110 THEN 1.0
      WHEN v_ratio BETWEEN 40 AND 60 OR v_ratio BETWEEN 110 AND 140 THEN 0.5 ELSE 0.2 END;
    rango_ratio := '60-110';
  ELSIF v_cluster = 'flex_living_core' THEN
    w_tamano:=0; w_ratio:=30; w_viv:=20; w_own:=20; w_mg:=20; w_local:=10;
    s_ratio := CASE WHEN v_ratio BETWEEN 35 AND 70 THEN 1.0
      WHEN v_ratio BETWEEN 70 AND 100 THEN 0.5
      WHEN v_ratio < 35 THEN 0.4 ELSE 0.2 END;
    rango_ratio := '35-70';
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 ELSE 0.5 END;
    rango_tamano := '800-1800';
  ELSIF v_cluster IN ('outer_distressed','outer_distressed_selectivo') THEN
    w_tamano:=20; w_ratio:=25; w_own:=25; w_mg:=20; w_local:=10; w_viv:=0;
    s_tamano := CASE WHEN v_m2 BETWEEN 300 AND 1000 THEN 1.0
      WHEN v_m2 BETWEEN 200 AND 300 OR v_m2 BETWEEN 1000 AND 1500 THEN 0.5 ELSE 0.2 END;
    rango_tamano := '300-1000';
    s_ratio := CASE WHEN v_ratio BETWEEN 40 AND 80 THEN 1.0
      WHEN v_ratio BETWEEN 30 AND 40 OR v_ratio BETWEEN 80 AND 110 THEN 0.5 ELSE 0.2 END;
    rango_ratio := '40-80';
  ELSE
    w_tamano:=10; w_ratio:=10; w_viv:=10; w_own:=10; w_mg:=10; w_local:=5;
    s_tamano := CASE WHEN v_m2 IS NOT NULL THEN 0.5 ELSE 0 END;
    s_ratio := 0.4; rango_tamano := 'n/a'; rango_ratio := 'n/a';
  END IF;

  s_viv := LEAST(1.0, COALESCE(v_viv,0)::numeric / 25.0);
  s_own := CASE
    WHEN v_owners >= 10 THEN 1.00 WHEN v_owners >= 7 THEN 0.90
    WHEN v_owners >= 5 THEN 0.75 WHEN v_owners = 4 THEN 0.55
    WHEN v_owners >= 2 THEN 0.30 ELSE 0.0 END;
  s_mg := COALESCE(v_mg,0)::numeric / 10.0;

  IF ba.local_pb_m2 IS NOT NULL OR ba.local_pb_fachada_m IS NOT NULL THEN
    s_local := LEAST(1.0,
        CASE WHEN COALESCE(ba.local_pb_fachada_m,0) > 6 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_m2,0) >= 80 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_esquina,false) THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_viviendas_potenciales,0) >= 2 THEN 0.25 ELSE 0 END);
  END IF;
  SELECT tipo INTO v_calle_tipo FROM public.madrid_calles_comerciales
   WHERE normalize_barrio(b.direccion) LIKE '%' || calle_norm || '%' LIMIT 1;
  IF v_calle_tipo IS NOT NULL THEN s_local := LEAST(1.0, s_local + 0.3); END IF;

  IF v_aviso_cambio_uso THEN v_bonus := v_bonus + 10;
  ELSIF v_protegido THEN v_pen := v_pen + 5; END IF;
  IF COALESCE(ba.edificio_reformado,false) THEN v_pen := v_pen + 25; END IF;
  IF COALESCE(ba.gestion_profesional,false) THEN v_pen := v_pen + 15; END IF;

  IF COALESCE(v_terciario_pct,0) >= 0.66 AND NOT v_aviso_cambio_uso THEN
    v_avisos := v_avisos || jsonb_build_object('key','terciario_alto',
      'label','Terciario ' || round(v_terciario_pct*100,0)::text || '%',
      'severity','medium',
      'detail','Más del 66% del edificio es uso terciario. Candidato a operación institucional o reposicionamiento mixto.');
  END IF;

  IF v_owners >= 5 THEN
    v_avisos := v_avisos || jsonb_build_object('key','proindiviso_fuerte',
      'label', v_owners::text || ' propietarios (deduped)',
      'severity', CASE WHEN v_owners >= 10 THEN 'high' ELSE 'medium' END,
      'detail','Proindiviso con ' || v_owners::text || ' propietarios distintos (raw: ' || v_owners_raw::text ||
              '). Fuerte palanca de negociación.');
  END IF;

  v_score := round(s_tamano*w_tamano + s_ratio*w_ratio + s_viv*w_viv + s_own*w_own
                 + s_mg*w_mg + s_local*w_local + v_bonus - v_pen, 1);
  v_score := GREATEST(0, LEAST(100, v_score));

  v_breakdown := jsonb_build_array(
    jsonb_build_object('key','tamano',
      'label','Tamaño edificio (óptimo cluster ' || rango_tamano || ' m²)',
      'valor_raw', v_m2, 'peso', w_tamano, 'contribucion', round(s_tamano*w_tamano,1)),
    jsonb_build_object('key','ratio',
      'label','Ratio m²/vivienda (óptimo cluster ' || rango_ratio || ')',
      'valor_raw', round(coalesce(v_ratio,0),1), 'peso', w_ratio, 'contribucion', round(s_ratio*w_ratio,1)),
    jsonb_build_object('key','viviendas','label','Nº viviendas',
      'valor_raw', v_viv, 'peso', w_viv, 'contribucion', round(s_viv*w_viv,1)),
    jsonb_build_object('key','propietarios',
      'label','Nº propietarios (deduped · raw ' || v_owners_raw::text || ')',
      'valor_raw', v_owners, 'peso', w_own, 'contribucion', round(s_own*w_own,1)),
    jsonb_build_object('key','mala_gestion','label','Mala gestión / conflicto',
      'valor_raw', v_mg, 'peso', w_mg, 'contribucion', round(s_mg*w_mg,1)),
    jsonb_build_object('key','local','label','Local PB / calle comercial',
      'valor_raw', v_calle_tipo, 'peso', w_local, 'contribucion', round(s_local*w_local,1)));
  IF v_bonus > 0 THEN
    v_breakdown := v_breakdown || jsonb_build_object('key','bonus_cambio_uso',
      'label','Bonus protección + doble escalera (cambio de uso)','valor_raw',null,'peso',10,'contribucion',v_bonus);
  END IF;
  IF v_pen > 0 THEN
    v_breakdown := v_breakdown || jsonb_build_object('key','penalizacion',
      'label','Penalizaciones (reformado / gestión pro / protegido sin doble esc.)',
      'valor_raw',null,'peso',-1,'contribucion',-v_pen);
  END IF;

  UPDATE public.buildings
  SET cluster_asignado = v_cluster, cluster_score = v_score, cluster_breakdown = v_breakdown,
      cluster_motivo = v_motivo, avisos_inteligentes = v_avisos, numero_propietarios = v_owners,
      score = v_score, score_breakdown = v_breakdown, score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_score;
END;
$function$;
