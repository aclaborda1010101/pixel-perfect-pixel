
-- ============================================================
-- 1. NORMALIZADOR DE BARRIO (quita "(22)" y acentos)
-- ============================================================
CREATE OR REPLACE FUNCTION public.normalize_barrio(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    regexp_replace(
      upper(
        translate(
          regexp_replace(coalesce(p,''), '\s*\([^)]*\)\s*$', '', 'g'),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'AAAAAEEEEIIIIOOOOOUUUUNC'
        )
      ),
      '[^A-Z0-9]', '', 'g'
    ),
    ''
  );
$$;

-- ============================================================
-- 2. TABLAS DE CATÁLOGO
-- ============================================================
CREATE TABLE IF NOT EXISTS public.madrid_barrio_clusters (
  barrio_norm text PRIMARY KEY,
  distrito text NOT NULL,
  barrio text NOT NULL,
  cluster text NOT NULL CHECK (cluster IN (
    'ultra_prime','prime_value_add','flex_living_core',
    'outer_distressed','outer_distressed_selectivo','baja_prioridad'
  )),
  cluster_secundario text,
  notas text
);

ALTER TABLE public.madrid_barrio_clusters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clusters_select_auth ON public.madrid_barrio_clusters;
CREATE POLICY clusters_select_auth ON public.madrid_barrio_clusters
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS clusters_admin_write ON public.madrid_barrio_clusters;
CREATE POLICY clusters_admin_write ON public.madrid_barrio_clusters
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.madrid_calles_comerciales (
  calle_norm text PRIMARY KEY,
  calle text NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('buena','mala'))
);

ALTER TABLE public.madrid_calles_comerciales ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS calles_select_auth ON public.madrid_calles_comerciales;
CREATE POLICY calles_select_auth ON public.madrid_calles_comerciales
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS calles_admin_write ON public.madrid_calles_comerciales;
CREATE POLICY calles_admin_write ON public.madrid_calles_comerciales
  FOR ALL TO authenticated
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

-- ============================================================
-- 3. SEED: clasificación de barrios (del PDF)
-- ============================================================
INSERT INTO public.madrid_barrio_clusters (barrio_norm, distrito, barrio, cluster, cluster_secundario) VALUES
-- Centro
(normalize_barrio('Palacio'),'Centro','Palacio','ultra_prime',NULL),
(normalize_barrio('Embajadores'),'Centro','Embajadores','flex_living_core',NULL),
(normalize_barrio('Cortes'),'Centro','Cortes','ultra_prime',NULL),
(normalize_barrio('Justicia'),'Centro','Justicia','ultra_prime',NULL),
(normalize_barrio('Universidad'),'Centro','Universidad','flex_living_core','prime_value_add'),
(normalize_barrio('Sol'),'Centro','Sol','prime_value_add',NULL),
-- Arganzuela
(normalize_barrio('Imperial'),'Arganzuela','Imperial','flex_living_core',NULL),
(normalize_barrio('Acacias'),'Arganzuela','Acacias','flex_living_core',NULL),
(normalize_barrio('Chopera'),'Arganzuela','Chopera','flex_living_core',NULL),
(normalize_barrio('Legazpi'),'Arganzuela','Legazpi','flex_living_core',NULL),
(normalize_barrio('Delicias'),'Arganzuela','Delicias','flex_living_core',NULL),
(normalize_barrio('Palos de Moguer'),'Arganzuela','Palos de Moguer','flex_living_core',NULL),
(normalize_barrio('Palos de la Frontera'),'Arganzuela','Palos de la Frontera','flex_living_core',NULL),
(normalize_barrio('Atocha'),'Arganzuela','Atocha','prime_value_add',NULL),
-- Retiro
(normalize_barrio('Pacifico'),'Retiro','Pacifico','prime_value_add',NULL),
(normalize_barrio('Adelfas'),'Retiro','Adelfas','prime_value_add',NULL),
(normalize_barrio('Estrella'),'Retiro','Estrella','prime_value_add',NULL),
(normalize_barrio('Ibiza'),'Retiro','Ibiza','prime_value_add',NULL),
(normalize_barrio('Jerónimos'),'Retiro','Jerónimos','ultra_prime',NULL),
(normalize_barrio('Niño Jesus'),'Retiro','Niño Jesus','prime_value_add',NULL),
-- Salamanca
(normalize_barrio('Recoletos'),'Salamanca','Recoletos','ultra_prime',NULL),
(normalize_barrio('Goya'),'Salamanca','Goya','ultra_prime','prime_value_add'),
(normalize_barrio('Fuente del Berro'),'Salamanca','Fuente del Berro','prime_value_add',NULL),
(normalize_barrio('Guindalera'),'Salamanca','Guindalera','prime_value_add',NULL),
(normalize_barrio('Lista'),'Salamanca','Lista','ultra_prime',NULL),
(normalize_barrio('Castellana'),'Salamanca','Castellana','ultra_prime',NULL),
-- Chamartín
(normalize_barrio('El Viso'),'Chamartín','El Viso','ultra_prime',NULL),
(normalize_barrio('Prosperidad'),'Chamartín','Prosperidad','prime_value_add',NULL),
(normalize_barrio('Ciudad Jardin'),'Chamartín','Ciudad Jardin','prime_value_add',NULL),
(normalize_barrio('Ciudad Jardín'),'Chamartín','Ciudad Jardín','prime_value_add',NULL),
(normalize_barrio('Hispanoamérica'),'Chamartín','Hispanoamérica','ultra_prime',NULL),
(normalize_barrio('Nueva España'),'Chamartín','Nueva España','ultra_prime',NULL),
(normalize_barrio('Castilla'),'Chamartín','Castilla','prime_value_add',NULL),
-- Tetuán
(normalize_barrio('Bellas Vistas'),'Tetuán','Bellas Vistas','flex_living_core',NULL),
(normalize_barrio('Cuatro Caminos'),'Tetuán','Cuatro Caminos','flex_living_core',NULL),
(normalize_barrio('Castillejos'),'Tetuán','Castillejos','flex_living_core',NULL),
(normalize_barrio('Almenara'),'Tetuán','Almenara','flex_living_core',NULL),
(normalize_barrio('Valdeacederas'),'Tetuán','Valdeacederas','flex_living_core',NULL),
(normalize_barrio('Berruguete'),'Tetuán','Berruguete','flex_living_core',NULL),
-- Chamberí
(normalize_barrio('Gaztambide'),'Chamberí','Gaztambide','prime_value_add',NULL),
(normalize_barrio('Arapiles'),'Chamberí','Arapiles','prime_value_add',NULL),
(normalize_barrio('Trafalgar'),'Chamberí','Trafalgar','ultra_prime','prime_value_add'),
(normalize_barrio('Almagro'),'Chamberí','Almagro','ultra_prime',NULL),
(normalize_barrio('Ríos Rosas'),'Chamberí','Ríos Rosas','prime_value_add',NULL),
(normalize_barrio('Vallehermoso'),'Chamberí','Vallehermoso','prime_value_add',NULL),
-- Fuencarral - El Pardo
(normalize_barrio('El Pardo'),'Fuencarral - El Pardo','El Pardo','baja_prioridad',NULL),
(normalize_barrio('Fuentelarreina'),'Fuencarral - El Pardo','Fuentelarreina','baja_prioridad',NULL),
(normalize_barrio('Peñagrande'),'Fuencarral - El Pardo','Peñagrande','outer_distressed_selectivo',NULL),
(normalize_barrio('Pilar'),'Fuencarral - El Pardo','Pilar','outer_distressed',NULL),
(normalize_barrio('La Paz'),'Fuencarral - El Pardo','La Paz','baja_prioridad',NULL),
(normalize_barrio('Valverde'),'Fuencarral - El Pardo','Valverde','outer_distressed_selectivo',NULL),
(normalize_barrio('Mirasierra'),'Fuencarral - El Pardo','Mirasierra','baja_prioridad',NULL),
(normalize_barrio('El Goloso'),'Fuencarral - El Pardo','El Goloso','baja_prioridad',NULL),
-- Moncloa - Aravaca
(normalize_barrio('Casa de Campo'),'Moncloa - Aravaca','Casa de Campo','baja_prioridad',NULL),
(normalize_barrio('Argüelles'),'Moncloa - Aravaca','Argüelles','prime_value_add',NULL),
(normalize_barrio('Ciudad Universitaria'),'Moncloa - Aravaca','Ciudad Universitaria','prime_value_add',NULL),
(normalize_barrio('Valdezarza'),'Moncloa - Aravaca','Valdezarza','prime_value_add','outer_distressed_selectivo'),
(normalize_barrio('Valdemarín'),'Moncloa - Aravaca','Valdemarín','baja_prioridad',NULL),
(normalize_barrio('El Plantío'),'Moncloa - Aravaca','El Plantío','baja_prioridad',NULL),
(normalize_barrio('Aravaca'),'Moncloa - Aravaca','Aravaca','baja_prioridad',NULL),
-- Latina
(normalize_barrio('Los Cármenes'),'Latina','Los Cármenes','outer_distressed',NULL),
(normalize_barrio('Puerta del Ángel'),'Latina','Puerta del Ángel','flex_living_core','outer_distressed'),
(normalize_barrio('Lucero'),'Latina','Lucero','flex_living_core','outer_distressed'),
(normalize_barrio('Aluche'),'Latina','Aluche','outer_distressed',NULL),
(normalize_barrio('Campamento'),'Latina','Campamento','outer_distressed',NULL),
(normalize_barrio('Cuatro Vientos'),'Latina','Cuatro Vientos','outer_distressed_selectivo',NULL),
(normalize_barrio('Las Águilas'),'Latina','Las Águilas','outer_distressed',NULL),
-- Carabanchel
(normalize_barrio('Comillas'),'Carabanchel','Comillas','flex_living_core','outer_distressed'),
(normalize_barrio('Opañel'),'Carabanchel','Opañel','flex_living_core','outer_distressed'),
(normalize_barrio('San Isidro'),'Carabanchel','San Isidro','flex_living_core','outer_distressed'),
(normalize_barrio('Vista Alegre'),'Carabanchel','Vista Alegre','outer_distressed',NULL),
(normalize_barrio('Puerta Bonita'),'Carabanchel','Puerta Bonita','outer_distressed',NULL),
(normalize_barrio('Buenavista'),'Carabanchel','Buenavista','outer_distressed',NULL),
(normalize_barrio('Abrantes'),'Carabanchel','Abrantes','outer_distressed',NULL),
-- Usera
(normalize_barrio('Orcasitas'),'Usera','Orcasitas','outer_distressed',NULL),
(normalize_barrio('Orcasur'),'Usera','Orcasur','outer_distressed',NULL),
(normalize_barrio('San Fermín'),'Usera','San Fermín','outer_distressed',NULL),
(normalize_barrio('Almendrales'),'Usera','Almendrales','outer_distressed',NULL),
(normalize_barrio('Moscardó'),'Usera','Moscardó','outer_distressed',NULL),
(normalize_barrio('Zofío'),'Usera','Zofío','outer_distressed',NULL),
(normalize_barrio('Pradolongo'),'Usera','Pradolongo','outer_distressed',NULL),
-- Puente de Vallecas
(normalize_barrio('Entrevias'),'Puente de Vallecas','Entrevias','outer_distressed',NULL),
(normalize_barrio('San Diego'),'Puente de Vallecas','San Diego','outer_distressed',NULL),
(normalize_barrio('Palomeras Bajas'),'Puente de Vallecas','Palomeras Bajas','outer_distressed',NULL),
(normalize_barrio('Palomeras Sureste'),'Puente de Vallecas','Palomeras Sureste','outer_distressed',NULL),
(normalize_barrio('Portazgo'),'Puente de Vallecas','Portazgo','outer_distressed',NULL),
(normalize_barrio('Numancia'),'Puente de Vallecas','Numancia','outer_distressed',NULL),
-- Moratalaz
(normalize_barrio('Pavones'),'Moratalaz','Pavones','outer_distressed_selectivo',NULL),
(normalize_barrio('Horcajo'),'Moratalaz','Horcajo','outer_distressed_selectivo',NULL),
(normalize_barrio('Marroquina'),'Moratalaz','Marroquina','outer_distressed',NULL),
(normalize_barrio('Media Legua'),'Moratalaz','Media Legua','outer_distressed',NULL),
(normalize_barrio('Fontarrón'),'Moratalaz','Fontarrón','outer_distressed',NULL),
(normalize_barrio('Vinateros'),'Moratalaz','Vinateros','outer_distressed',NULL),
-- Ciudad Lineal
(normalize_barrio('Ventas'),'Ciudad Lineal','Ventas','outer_distressed',NULL),
(normalize_barrio('Pueblo Nuevo'),'Ciudad Lineal','Pueblo Nuevo','outer_distressed',NULL),
(normalize_barrio('Quintana'),'Ciudad Lineal','Quintana','outer_distressed',NULL),
(normalize_barrio('Concepción'),'Ciudad Lineal','Concepción','prime_value_add',NULL),
(normalize_barrio('San Pascual'),'Ciudad Lineal','San Pascual','prime_value_add',NULL),
(normalize_barrio('San Juan Bautista'),'Ciudad Lineal','San Juan Bautista','baja_prioridad',NULL),
(normalize_barrio('Colina'),'Ciudad Lineal','Colina','baja_prioridad',NULL),
(normalize_barrio('Atalaya'),'Ciudad Lineal','Atalaya','baja_prioridad',NULL),
(normalize_barrio('Costillares'),'Ciudad Lineal','Costillares','baja_prioridad',NULL),
-- Hortaleza
(normalize_barrio('Palomas'),'Hortaleza','Palomas','baja_prioridad',NULL),
(normalize_barrio('Piovera'),'Hortaleza','Piovera','baja_prioridad',NULL),
(normalize_barrio('Canillas'),'Hortaleza','Canillas','outer_distressed_selectivo',NULL),
(normalize_barrio('Pinar del Rey'),'Hortaleza','Pinar del Rey','outer_distressed_selectivo',NULL),
(normalize_barrio('Apóstol Santiago'),'Hortaleza','Apóstol Santiago','outer_distressed_selectivo',NULL),
(normalize_barrio('Valdefuentes'),'Hortaleza','Valdefuentes','baja_prioridad',NULL),
-- Villaverde
(normalize_barrio('San Andres'),'Villaverde','San Andres','outer_distressed',NULL),
(normalize_barrio('San Andrés'),'Villaverde','San Andrés','outer_distressed',NULL),
(normalize_barrio('San Cristobal'),'Villaverde','San Cristobal','outer_distressed',NULL),
(normalize_barrio('Butarque'),'Villaverde','Butarque','outer_distressed_selectivo',NULL),
(normalize_barrio('Los Rosales'),'Villaverde','Los Rosales','outer_distressed',NULL),
(normalize_barrio('Los Ángeles'),'Villaverde','Los Ángeles','outer_distressed',NULL),
-- Villa de Vallecas
(normalize_barrio('Casco Histórico de Vallecas'),'Villa de Vallecas','Casco Histórico de Vallecas','outer_distressed',NULL),
(normalize_barrio('Santa Eugenia'),'Villa de Vallecas','Santa Eugenia','outer_distressed_selectivo',NULL),
(normalize_barrio('Ensanche de Vallecas'),'Villa de Vallecas','Ensanche de Vallecas','baja_prioridad',NULL),
-- Vicálvaro
(normalize_barrio('Casco Histórico de Vicálvaro'),'Vicálvaro','Casco Histórico de Vicálvaro','outer_distressed_selectivo',NULL),
(normalize_barrio('Valdebernardo'),'Vicálvaro','Valdebernardo','baja_prioridad',NULL),
(normalize_barrio('Valderrivas'),'Vicálvaro','Valderrivas','baja_prioridad',NULL),
(normalize_barrio('El Cañaveral'),'Vicálvaro','El Cañaveral','baja_prioridad',NULL),
-- San Blas - Canillejas
(normalize_barrio('Simancas'),'San Blas - Canillejas','Simancas','outer_distressed',NULL),
(normalize_barrio('Hellín'),'San Blas - Canillejas','Hellín','outer_distressed',NULL),
(normalize_barrio('Amposta'),'San Blas - Canillejas','Amposta','outer_distressed',NULL),
(normalize_barrio('Arcos'),'San Blas - Canillejas','Arcos','outer_distressed',NULL),
(normalize_barrio('Rosas'),'San Blas - Canillejas','Rosas','outer_distressed_selectivo',NULL),
(normalize_barrio('Rejas'),'San Blas - Canillejas','Rejas','baja_prioridad',NULL),
(normalize_barrio('Canillejas'),'San Blas - Canillejas','Canillejas','outer_distressed',NULL),
(normalize_barrio('Salvador'),'San Blas - Canillejas','Salvador','baja_prioridad',NULL),
-- Barajas
(normalize_barrio('Alameda de Osuna'),'Barajas','Alameda de Osuna','baja_prioridad',NULL),
(normalize_barrio('Aeropuerto'),'Barajas','Aeropuerto','baja_prioridad',NULL),
(normalize_barrio('Casco Histórico de Barajas'),'Barajas','Casco Histórico de Barajas','outer_distressed_selectivo',NULL),
(normalize_barrio('Timón'),'Barajas','Timón','baja_prioridad',NULL),
(normalize_barrio('Corralejos'),'Barajas','Corralejos','baja_prioridad',NULL)
ON CONFLICT (barrio_norm) DO UPDATE SET
  distrito = EXCLUDED.distrito,
  barrio = EXCLUDED.barrio,
  cluster = EXCLUDED.cluster,
  cluster_secundario = EXCLUDED.cluster_secundario;

-- Calles comerciales estratégicas
INSERT INTO public.madrid_calles_comerciales (calle_norm, calle, tipo) VALUES
(normalize_barrio('Bravo Murillo'),'Bravo Murillo','buena'),
(normalize_barrio('General Ricardos'),'General Ricardos','buena'),
(normalize_barrio('Marcelo Usera'),'Marcelo Usera','buena'),
(normalize_barrio('Alcalá'),'Alcalá','buena'),
(normalize_barrio('López de Hoyos'),'López de Hoyos','buena'),
(normalize_barrio('Paseo de Extremadura'),'Paseo de Extremadura','mala'),
(normalize_barrio('Avenida de la Albufera'),'Avenida de la Albufera','mala'),
(normalize_barrio('Antonio López'),'Antonio López','mala'),
(normalize_barrio('Santa Engracia'),'Santa Engracia','buena'),
(normalize_barrio('Fuencarral'),'Fuencarral','buena'),
(normalize_barrio('Hortaleza'),'Hortaleza','buena'),
(normalize_barrio('Princesa'),'Princesa','buena'),
(normalize_barrio('Narvaez'),'Narvaez','buena'),
(normalize_barrio('Narváez'),'Narváez','buena'),
(normalize_barrio('Ibiza'),'Ibiza','buena'),
(normalize_barrio('Menéndez Pelayo'),'Menéndez Pelayo','buena')
ON CONFLICT (calle_norm) DO UPDATE SET calle=EXCLUDED.calle, tipo=EXCLUDED.tipo;

-- ============================================================
-- 4. COLUMNAS NUEVAS
-- ============================================================
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS mala_gestion_score smallint,
  ADD COLUMN IF NOT EXISTS mala_gestion_evidencias jsonb,
  ADD COLUMN IF NOT EXISTS edificio_reformado boolean,
  ADD COLUMN IF NOT EXISTS gestion_profesional boolean,
  ADD COLUMN IF NOT EXISTS local_pb_m2 numeric,
  ADD COLUMN IF NOT EXISTS local_pb_fachada_m numeric,
  ADD COLUMN IF NOT EXISTS local_pb_esquina boolean,
  ADD COLUMN IF NOT EXISTS local_pb_viviendas_potenciales smallint,
  ADD COLUMN IF NOT EXISTS local_pb_tipo_calle text;

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS cluster_asignado text,
  ADD COLUMN IF NOT EXISTS cluster_score numeric,
  ADD COLUMN IF NOT EXISTS cluster_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS cluster_motivo text;

-- ============================================================
-- 5. FUNCIÓN DE SCORING POR CLUSTERS
-- ============================================================
CREATE OR REPLACE FUNCTION public.compute_cluster_score(p_building_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  ba public.building_analysis%ROWTYPE;
  md jsonb;
  v_barrio_norm text;
  v_cluster text;
  v_cluster_secundario text;
  v_m2 numeric;
  v_viv integer;
  v_owners integer;
  v_ratio numeric;
  v_mg integer; -- mala gestión 0-10
  v_score numeric := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_motivo text := '';
  v_calle_tipo text;
  v_pen numeric := 0;
  s_tamano numeric := 0; w_tamano numeric := 0; rango_tamano text;
  s_ratio numeric := 0; w_ratio numeric := 0; rango_ratio text;
  s_viv numeric := 0; w_viv numeric := 0;
  s_own numeric := 0; w_own numeric := 0;
  s_mg numeric := 0; w_mg numeric := 0;
  s_local numeric := 0; w_local numeric := 0;
BEGIN
  SELECT * INTO b FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  md := COALESCE(b.metadatos,'{}'::jsonb);

  SELECT * INTO ba FROM public.building_analysis WHERE building_id = p_building_id;

  -- Resolver cluster
  v_barrio_norm := normalize_barrio(md->>'barrios_completos__clonada_');
  SELECT cluster, cluster_secundario INTO v_cluster, v_cluster_secundario
  FROM public.madrid_barrio_clusters WHERE barrio_norm = v_barrio_norm;
  IF v_cluster IS NULL THEN
    v_cluster := 'baja_prioridad';
    v_motivo := 'barrio no clasificado → baja_prioridad';
  ELSE
    v_motivo := 'barrio ' || coalesce(md->>'barrios_completos__clonada_','?') || ' → ' || v_cluster;
  END IF;

  -- Variables base
  v_m2 := NULLIF(md->>'metros_cuadrados__exactos_','')::numeric;
  v_viv := COALESCE(
    NULLIF(md->>'viviendas__unidades___clonada_','')::integer,
    NULLIF(md->>'viviendas__unidades_','')::integer,
    NULLIF(md->>'num_viviendas','')::integer
  );
  v_owners := (SELECT count(*)::integer FROM building_owners bo WHERE bo.building_id = p_building_id);
  v_ratio := CASE WHEN v_viv>0 AND v_m2 IS NOT NULL THEN v_m2/v_viv ELSE NULL END;
  v_mg := COALESCE(ba.mala_gestion_score, 0);

  -- Pesos por cluster (sec. 1 del PDF)
  IF v_cluster = 'ultra_prime' THEN
    w_tamano:=20; w_ratio:=20; w_own:=20; w_mg:=25; w_viv:=0; w_local:=15; -- 15 = "salida institucional" → bonus local/comercial proxy
    s_tamano := CASE
      WHEN v_m2 BETWEEN 1500 AND 4000 THEN 1.0
      WHEN v_m2 BETWEEN 1000 AND 1500 OR v_m2 BETWEEN 4000 AND 5000 THEN 0.5
      ELSE 0 END;
    rango_tamano := '1500-4000';
    s_ratio := CASE
      WHEN v_ratio BETWEEN 90 AND 160 THEN 1.0
      WHEN v_ratio BETWEEN 50 AND 90 THEN 0.5
      WHEN v_ratio < 50 THEN 0.2 ELSE 0.3 END;
    rango_ratio := '90-160';
  ELSIF v_cluster = 'prime_value_add' THEN
    w_tamano:=20; w_ratio:=25; w_viv:=15; w_own:=20; w_mg:=20; w_local:=0;
    s_tamano := CASE
      WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0
      WHEN v_m2 BETWEEN 500 AND 800 OR v_m2 BETWEEN 1800 AND 2500 THEN 0.5
      ELSE 0 END;
    rango_tamano := '800-1800';
    s_ratio := CASE
      WHEN v_ratio BETWEEN 60 AND 110 THEN 1.0
      WHEN v_ratio BETWEEN 40 AND 60 OR v_ratio BETWEEN 110 AND 140 THEN 0.5
      ELSE 0.2 END;
    rango_ratio := '60-110';
  ELSIF v_cluster = 'flex_living_core' THEN
    w_tamano:=0; w_ratio:=30; w_viv:=20; w_own:=20; w_mg:=20; w_local:=10;
    s_ratio := CASE
      WHEN v_ratio BETWEEN 35 AND 70 THEN 1.0
      WHEN v_ratio BETWEEN 70 AND 100 THEN 0.5
      WHEN v_ratio < 35 THEN 0.4 ELSE 0.2 END;
    rango_ratio := '35-70';
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 ELSE 0.5 END;
    rango_tamano := '800-1800';
  ELSIF v_cluster IN ('outer_distressed','outer_distressed_selectivo') THEN
    w_tamano:=20; w_ratio:=25; w_own:=25; w_mg:=20; w_local:=10; w_viv:=0;
    s_tamano := CASE
      WHEN v_m2 BETWEEN 300 AND 1000 THEN 1.0
      WHEN v_m2 BETWEEN 200 AND 300 OR v_m2 BETWEEN 1000 AND 1500 THEN 0.5
      ELSE 0.2 END;
    rango_tamano := '300-1000';
    s_ratio := CASE
      WHEN v_ratio BETWEEN 40 AND 80 THEN 1.0
      WHEN v_ratio BETWEEN 30 AND 40 OR v_ratio BETWEEN 80 AND 110 THEN 0.5
      ELSE 0.2 END;
    rango_ratio := '40-80';
  ELSE -- baja_prioridad
    w_tamano:=10; w_ratio:=10; w_viv:=10; w_own:=10; w_mg:=10; w_local:=5;
    s_tamano := CASE WHEN v_m2 IS NOT NULL THEN 0.5 ELSE 0 END;
    s_ratio := 0.4;
    rango_tamano := 'n/a'; rango_ratio := 'n/a';
  END IF;

  -- Sub-scores 0..1 normalizados
  s_viv := LEAST(1.0, COALESCE(v_viv,0)::numeric / 25.0);
  s_own := LEAST(1.0, COALESCE(v_owners,0)::numeric / 20.0);
  s_mg  := COALESCE(v_mg,0)::numeric / 10.0;

  -- Bonus local PB
  IF ba.local_pb_m2 IS NOT NULL OR ba.local_pb_fachada_m IS NOT NULL THEN
    s_local := LEAST(1.0,
        CASE WHEN COALESCE(ba.local_pb_fachada_m,0) > 6 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_m2,0) >= 80 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_esquina,false) THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_viviendas_potenciales,0) >= 2 THEN 0.25 ELSE 0 END
    );
  END IF;
  -- Bonus calle comercial: si la dirección contiene una calle del catálogo
  SELECT tipo INTO v_calle_tipo
  FROM public.madrid_calles_comerciales
  WHERE normalize_barrio(b.direccion) LIKE '%' || calle_norm || '%'
  LIMIT 1;
  IF v_calle_tipo IS NOT NULL THEN
    s_local := LEAST(1.0, s_local + 0.3);
  END IF;

  -- Penalizaciones
  IF COALESCE(ba.edificio_reformado,false) THEN v_pen := v_pen + 25; END IF;
  IF COALESCE(ba.gestion_profesional,false) THEN v_pen := v_pen + 15; END IF;
  IF COALESCE(ba.protegido_historicamente,false) THEN v_pen := v_pen + 5; END IF;

  -- Score final
  v_score := round(
       s_tamano*w_tamano
     + s_ratio*w_ratio
     + s_viv*w_viv
     + s_own*w_own
     + s_mg*w_mg
     + s_local*w_local
     - v_pen
  , 1);
  v_score := GREATEST(0, LEAST(100, v_score));

  v_breakdown := jsonb_build_array(
    jsonb_build_object('key','tamano','label','Tamaño m² (rango '||rango_tamano||')','valor_raw',v_m2,'peso',w_tamano,'contribucion',round(s_tamano*w_tamano,1)),
    jsonb_build_object('key','ratio','label','m²/vivienda (rango '||rango_ratio||')','valor_raw',round(coalesce(v_ratio,0),1),'peso',w_ratio,'contribucion',round(s_ratio*w_ratio,1)),
    jsonb_build_object('key','viviendas','label','Nº viviendas','valor_raw',v_viv,'peso',w_viv,'contribucion',round(s_viv*w_viv,1)),
    jsonb_build_object('key','propietarios','label','Nº propietarios','valor_raw',v_owners,'peso',w_own,'contribucion',round(s_own*w_own,1)),
    jsonb_build_object('key','mala_gestion','label','Mala gestión / conflicto','valor_raw',v_mg,'peso',w_mg,'contribucion',round(s_mg*w_mg,1)),
    jsonb_build_object('key','local','label','Local PB / calle comercial','valor_raw',v_calle_tipo,'peso',w_local,'contribucion',round(s_local*w_local,1))
  );
  IF v_pen > 0 THEN
    v_breakdown := v_breakdown || jsonb_build_object(
      'key','penalizacion','label','Penalizaciones (reformado/gestión pro/protegido)',
      'valor_raw',null,'peso',-1,'contribucion',-v_pen);
  END IF;

  UPDATE public.buildings
  SET cluster_asignado = v_cluster,
      cluster_score = v_score,
      cluster_breakdown = v_breakdown,
      cluster_motivo = v_motivo,
      score = v_score,
      score_breakdown = v_breakdown,
      score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_score;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_buildings_cluster ON public.buildings(cluster_asignado);
