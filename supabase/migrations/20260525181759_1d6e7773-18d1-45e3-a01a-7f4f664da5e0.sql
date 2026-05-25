
-- ============================================================
-- SCORING V2: tablas, columnas, buckets, funciones
-- ============================================================

-- 1. app_settings (clave/valor)
CREATE TABLE IF NOT EXISTS public.app_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings_select_auth" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings_admin_write" ON public.app_settings FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.app_settings(key,value) VALUES
  ('scoring_v2_enabled', 'false'::jsonb),
  ('google_maps_api_key_configured', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- 2. Columnas nuevas en buildings
ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS refcatastral text,
  ADD COLUMN IF NOT EXISTS score_v2 numeric,
  ADD COLUMN IF NOT EXISTS score_v2_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS score_v2_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS avisos_inteligentes jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS buildings_refcatastral_uniq ON public.buildings(refcatastral) WHERE refcatastral IS NOT NULL;
CREATE INDEX IF NOT EXISTS buildings_score_v2_idx ON public.buildings(score_v2 DESC NULLS LAST);

-- 3. catastro_data
CREATE TABLE IF NOT EXISTS public.catastro_data (
  refcatastral text PRIMARY KEY,
  building_id uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  lat double precision,
  lon double precision,
  plano_url text,
  dnprc_json jsonb,
  ancho_calle_m numeric,
  fetched_at timestamptz,
  fetch_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS catastro_data_building_idx ON public.catastro_data(building_id);
ALTER TABLE public.catastro_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catastro_select_auth" ON public.catastro_data FOR SELECT TO authenticated USING (true);
CREATE TRIGGER catastro_set_updated BEFORE UPDATE ON public.catastro_data FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. building_imagery
CREATE TABLE IF NOT EXISTS public.building_imagery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('satellite','streetview','oblique')),
  heading int,
  pitch int,
  zoom int,
  file_path text NOT NULL,
  public_url text NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_imagery_building_idx ON public.building_imagery(building_id);
ALTER TABLE public.building_imagery ENABLE ROW LEVEL SECURITY;
CREATE POLICY "imagery_select_auth" ON public.building_imagery FOR SELECT TO authenticated USING (true);

-- 5. building_analysis
CREATE TABLE IF NOT EXISTS public.building_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL UNIQUE REFERENCES public.buildings(id) ON DELETE CASCADE,
  ventanas_fachada_total int,
  ventanas_por_planta jsonb,
  patios_detectados int,
  segundas_escaleras boolean,
  esquina boolean,
  protegido_historicamente boolean,
  plantas_visibles int,
  plantas_max_normativa int,
  plantas_levantables int,
  metricas_extra jsonb,
  modelo_usado text,
  modelo_fallback boolean DEFAULT false,
  sources_used jsonb,
  confidence numeric,
  llm_raw_response jsonb,
  analyzed_at timestamptz,
  analyze_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.building_analysis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "analysis_select_auth" ON public.building_analysis FOR SELECT TO authenticated USING (true);
CREATE TRIGGER analysis_set_updated BEFORE UPDATE ON public.building_analysis FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. scoring_v2_seed
CREATE TABLE IF NOT EXISTS public.scoring_v2_seed (
  edificio text PRIMARY KEY,
  direccion text,
  hubspot_deal_id text,
  raw jsonb,
  matched_building_id uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  matched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scoring_v2_seed ENABLE ROW LEVEL SECURITY;
CREATE POLICY "seed_select_auth" ON public.scoring_v2_seed FOR SELECT TO authenticated USING (true);

-- 7. scoring_v2_jobs
CREATE TABLE IF NOT EXISTS public.scoring_v2_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phase text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  total int DEFAULT 0,
  processed int DEFAULT 0,
  failed int DEFAULT 0,
  log jsonb DEFAULT '[]'::jsonb,
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  cursor text
);
ALTER TABLE public.scoring_v2_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "jobs_select_auth" ON public.scoring_v2_jobs FOR SELECT TO authenticated USING (true);

-- 8. scoring_v2_feedback
CREATE TABLE IF NOT EXISTS public.scoring_v2_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  aviso_key text NOT NULL,
  vote int NOT NULL CHECK (vote IN (-1, 1)),
  user_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.scoring_v2_feedback ENABLE ROW LEVEL SECURITY;
CREATE POLICY "feedback_select_auth" ON public.scoring_v2_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "feedback_insert_auth" ON public.scoring_v2_feedback FOR INSERT TO authenticated WITH CHECK (true);

-- 9. building_processing_status
CREATE TABLE IF NOT EXISTS public.building_processing_status (
  building_id uuid PRIMARY KEY REFERENCES public.buildings(id) ON DELETE CASCADE,
  current_phase text,
  status text,
  started_at timestamptz,
  finished_at timestamptz,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.building_processing_status ENABLE ROW LEVEL SECURITY;
CREATE POLICY "procstatus_select_auth" ON public.building_processing_status FOR SELECT TO authenticated USING (true);
CREATE TRIGGER procstatus_set_updated BEFORE UPDATE ON public.building_processing_status FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 10. Storage buckets (públicos lectura)
INSERT INTO storage.buckets (id, name, public) VALUES ('catastro', 'catastro', true)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('building_imagery', 'building_imagery', true)
  ON CONFLICT (id) DO NOTHING;

CREATE POLICY "catastro_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'catastro');
CREATE POLICY "imagery_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'building_imagery');

-- 11. Función normativa Madrid
CREATE OR REPLACE FUNCTION public.madrid_plantas_max(ancho_m numeric)
RETURNS int
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE
    WHEN ancho_m IS NULL THEN NULL
    WHEN ancho_m > 20 THEN 7
    WHEN ancho_m >= 12 THEN 6
    WHEN ancho_m >= 8 THEN 5
    ELSE 4
  END;
$$;

-- 12. compute_score_v2
CREATE OR REPLACE FUNCTION public.compute_score_v2(p_building_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_an public.building_analysis%ROWTYPE;
  v_score numeric := 0;
  v_breakdown jsonb := '[]'::jsonb;
  v_avisos jsonb := '[]'::jsonb;
  v_ventanas_pts numeric := 0;
  v_esquina_pts numeric := 0;
  v_escaleras_pts numeric := 0;
  v_levantables_pts numeric := 0;
BEGIN
  SELECT * INTO v_an FROM public.building_analysis WHERE building_id = p_building_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Ventanas (peso 0.4, normalizado /50 ventanas = 100)
  v_ventanas_pts := LEAST(COALESCE(v_an.ventanas_fachada_total, 0)::numeric / 50.0 * 100.0, 100);
  -- Esquina (peso 0.2, binario)
  v_esquina_pts := CASE WHEN v_an.esquina THEN 100 ELSE 0 END;
  -- Segundas escaleras (peso 0.15)
  v_escaleras_pts := CASE WHEN v_an.segundas_escaleras THEN 100 ELSE 0 END;
  -- Plantas levantables (peso 0.25, /3 plantas = 100)
  v_levantables_pts := LEAST(COALESCE(v_an.plantas_levantables, 0)::numeric / 3.0 * 100.0, 100);

  v_score := round(v_ventanas_pts * 0.40 + v_esquina_pts * 0.20 + v_escaleras_pts * 0.15 + v_levantables_pts * 0.25, 2);

  v_breakdown := jsonb_build_array(
    jsonb_build_object('componente', 'ventanas', 'valor_raw', v_an.ventanas_fachada_total, 'peso', 0.40, 'contribucion', round(v_ventanas_pts*0.40, 2)),
    jsonb_build_object('componente', 'esquina', 'valor_raw', v_an.esquina, 'peso', 0.20, 'contribucion', round(v_esquina_pts*0.20, 2)),
    jsonb_build_object('componente', 'segundas_escaleras', 'valor_raw', v_an.segundas_escaleras, 'peso', 0.15, 'contribucion', round(v_escaleras_pts*0.15, 2)),
    jsonb_build_object('componente', 'plantas_levantables', 'valor_raw', v_an.plantas_levantables, 'peso', 0.25, 'contribucion', round(v_levantables_pts*0.25, 2))
  );

  -- Avisos
  IF COALESCE(v_an.plantas_levantables, 0) >= 2 THEN
    v_avisos := v_avisos || jsonb_build_object('key','elevable','label','Potencial de elevación','severity','high');
  END IF;
  IF v_an.esquina THEN
    v_avisos := v_avisos || jsonb_build_object('key','esquina','label','Edificio en esquina','severity','medium');
  END IF;
  IF v_an.segundas_escaleras THEN
    v_avisos := v_avisos || jsonb_build_object('key','doble_escalera','label','Dos escaleras detectadas','severity','medium');
  END IF;
  IF v_an.patios_detectados > 0 THEN
    v_avisos := v_avisos || jsonb_build_object('key','patios','label', v_an.patios_detectados || ' patio(s) interior(es)','severity','info');
  END IF;
  IF v_an.protegido_historicamente THEN
    v_avisos := v_avisos || jsonb_build_object('key','protegido','label','Protección histórica','severity','warn');
  END IF;
  IF COALESCE(v_an.ventanas_fachada_total,0) >= 30 THEN
    v_avisos := v_avisos || jsonb_build_object('key','mucha_ventana','label','Fachada con muchas ventanas','severity','info');
  END IF;
  IF COALESCE(v_an.confidence,1) < 0.6 THEN
    v_avisos := v_avisos || jsonb_build_object('key','low_conf','label','Confianza IA baja','severity','warn');
  END IF;

  UPDATE public.buildings
  SET score_v2 = v_score,
      score_v2_breakdown = v_breakdown,
      avisos_inteligentes = v_avisos,
      score_v2_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_score;
END;
$$;

-- 13. Trigger para auto-recompute en building_analysis
CREATE OR REPLACE FUNCTION public.trg_recompute_score_v2()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.compute_score_v2(NEW.building_id);
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS analysis_recompute_score ON public.building_analysis;
CREATE TRIGGER analysis_recompute_score
AFTER INSERT OR UPDATE ON public.building_analysis
FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_score_v2();
