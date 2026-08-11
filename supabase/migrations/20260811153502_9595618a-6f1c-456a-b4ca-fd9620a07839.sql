CREATE OR REPLACE FUNCTION public.resolve_building_task(
  p_task_id uuid, p_status text, p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_task public.building_tasks%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed','skipped','no_procede','blocked','cancelled') THEN
    RAISE EXCEPTION 'resolve_building_task: estado no admitido %', p_status;
  END IF;

  SELECT * INTO v_task FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolve_building_task: tarea inexistente';
  END IF;
  IF v_task.user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin'::public.app_role)
     AND NOT public.has_role(auth.uid(), 'sales_manager'::public.app_role) THEN
    RAISE EXCEPTION 'resolve_building_task: la tarea no es tuya';
  END IF;
  IF v_task.status IN ('completed','skipped','no_procede','cancelled','superseded') THEN
    RETURN false;
  END IF;

  UPDATE public.building_tasks
     SET status = p_status,
         completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE id = p_task_id;

  RETURN true;
END
$fn$;

REVOKE ALL ON FUNCTION public.resolve_building_task(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_building_task(uuid, text, text) TO authenticated, service_role;