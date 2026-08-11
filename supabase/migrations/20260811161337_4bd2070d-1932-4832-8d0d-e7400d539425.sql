-- Roles: self + administración/gestión.
DROP POLICY IF EXISTS user_roles_select_authenticated ON public.user_roles;
CREATE POLICY user_roles_select_self_or_staff ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_gestor_access(auth.uid())
  );

-- Datos de HubSpot: solo miembros del equipo.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND cmd = 'SELECT' AND coalesce(qual,'') = 'true'
      AND (tablename LIKE 'hubspot\_%' OR tablename IN ('external_ids','call_playbook','deals_gemelos','hubspot_link_review','building_property_rights','building_analysis'))
      AND roles::text = '{authenticated}'
  LOOP
    EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_internal_member())', r.policyname, r.tablename);
  END LOOP;
END $$;

-- Configuración: lectura para el equipo, escritura solo administración.
DROP POLICY IF EXISTS auth_manage_app_settings ON public.app_settings;
DROP POLICY IF EXISTS app_settings_read_team ON public.app_settings;
CREATE POLICY app_settings_read_team ON public.app_settings
  FOR SELECT TO authenticated USING (public.is_internal_member());
