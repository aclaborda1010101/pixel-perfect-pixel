CREATE OR REPLACE FUNCTION public.can_manage_building_interlocutor(_building_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR public.has_role(_user_id, 'sales_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.building_assignments ba
      WHERE ba.building_id = _building_id
        AND ba.user_id = _user_id
        AND ba.status = 'active'::assignment_status
    )
  )
$fn$;

REVOKE ALL ON FUNCTION public.can_manage_building_interlocutor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_building_interlocutor(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS settings_manager_horario ON public.app_settings;
CREATE POLICY settings_manager_horario ON public.app_settings
FOR ALL TO authenticated
USING (key = 'horario_laboral' AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'sales_manager'::app_role)))
WITH CHECK (key = 'horario_laboral' AND (public.has_role(auth.uid(), 'admin'::app_role) OR public.has_role(auth.uid(), 'sales_manager'::app_role)));