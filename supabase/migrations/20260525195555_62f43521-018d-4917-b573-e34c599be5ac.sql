
-- app_settings: full access auth (ya existe settings_admin_write para admin, añadimos auth general)
DROP POLICY IF EXISTS "auth_manage_app_settings" ON public.app_settings;
CREATE POLICY "auth_manage_app_settings" ON public.app_settings
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_catastro_data" ON public.catastro_data;
CREATE POLICY "auth_manage_catastro_data" ON public.catastro_data
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_building_imagery" ON public.building_imagery;
CREATE POLICY "auth_manage_building_imagery" ON public.building_imagery
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_building_analysis" ON public.building_analysis;
CREATE POLICY "auth_manage_building_analysis" ON public.building_analysis
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_scoring_v2_seed" ON public.scoring_v2_seed;
CREATE POLICY "auth_manage_scoring_v2_seed" ON public.scoring_v2_seed
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_scoring_v2_jobs" ON public.scoring_v2_jobs;
CREATE POLICY "auth_manage_scoring_v2_jobs" ON public.scoring_v2_jobs
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_scoring_v2_feedback" ON public.scoring_v2_feedback;
CREATE POLICY "auth_manage_scoring_v2_feedback" ON public.scoring_v2_feedback
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "auth_manage_building_processing_status" ON public.building_processing_status;
CREATE POLICY "auth_manage_building_processing_status" ON public.building_processing_status
  FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
