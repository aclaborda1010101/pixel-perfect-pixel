-- 1) Interlocutor: solo admin y sales_manager
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
  )
$fn$;

REVOKE ALL ON FUNCTION public.can_manage_building_interlocutor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_building_interlocutor(uuid, uuid) TO authenticated, service_role;

-- 2) Situación comercial: rechaza cambios de estado hechos por comercial_zona
CREATE OR REPLACE FUNCTION public.guard_building_estado_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.estado IS DISTINCT FROM OLD.estado
     AND auth.uid() IS NOT NULL
     AND public.has_role(auth.uid(), 'comercial_zona'::app_role)
     AND NOT public.has_role(auth.uid(), 'admin'::app_role)
     AND NOT public.has_role(auth.uid(), 'sales_manager'::app_role)
  THEN
    RAISE EXCEPTION 'La situación comercial solo la puede cambiar la dirección o el responsable de equipo';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_guard_building_estado_change ON public.buildings;
CREATE TRIGGER trg_guard_building_estado_change
BEFORE UPDATE ON public.buildings
FOR EACH ROW EXECUTE FUNCTION public.guard_building_estado_change();