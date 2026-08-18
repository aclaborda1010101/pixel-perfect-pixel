ALTER TABLE public.building_tasks
  ADD COLUMN IF NOT EXISTS completed_by uuid,
  ADD COLUMN IF NOT EXISTS completed_note text;

CREATE OR REPLACE FUNCTION public.resolve_building_task(p_task_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
         completed_by = CASE WHEN p_status = 'completed' THEN auth.uid() ELSE completed_by END,
         completed_note = COALESCE(NULLIF(btrim(p_note), ''), completed_note),
         updated_at = now()
   WHERE id = p_task_id;

  RETURN true;
END
$function$;

CREATE OR REPLACE VIEW public.v_tareas_llamada_sin_cerrar
WITH (security_invoker = true) AS
SELECT t.id AS task_id,
       t.user_id,
       t.building_id,
       t.task_type,
       t.title,
       t.created_at,
       t.due_date,
       o.owner_id,
       c.id AS call_id,
       c.fecha AS call_fecha
FROM public.building_tasks t
CROSS JOIN LATERAL (
  SELECT CASE
           WHEN split_part(t.task_key, ':', 5) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             THEN split_part(t.task_key, ':', 5)::uuid
         END AS owner_id
) o
JOIN LATERAL (
  SELECT c.id, c.fecha
  FROM public.calls c
  WHERE c.owner_id = o.owner_id
    AND c.fecha >= t.created_at
  ORDER BY c.fecha DESC
  LIMIT 1
) c ON true
WHERE t.status IN ('pending','in_progress')
  AND o.owner_id IS NOT NULL;

GRANT SELECT ON public.v_tareas_llamada_sin_cerrar TO authenticated;