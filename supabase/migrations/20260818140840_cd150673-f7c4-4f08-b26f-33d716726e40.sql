CREATE OR REPLACE FUNCTION public.tareas_llamada_sin_cerrar()
RETURNS TABLE(task_id uuid, user_id uuid, building_id uuid, task_type text, title text,
              created_at timestamptz, due_date timestamptz, owner_id uuid,
              call_id uuid, call_fecha timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO 'public'
AS $$
  SELECT v.task_id, v.user_id, v.building_id, v.task_type, v.title,
         v.created_at, v.due_date, v.owner_id, v.call_id, v.call_fecha
  FROM public.v_tareas_llamada_sin_cerrar v
  ORDER BY v.call_fecha DESC
  LIMIT 50
$$;

REVOKE ALL ON FUNCTION public.tareas_llamada_sin_cerrar() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tareas_llamada_sin_cerrar() TO authenticated;