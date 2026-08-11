CREATE OR REPLACE FUNCTION public.get_sales_manager_panel(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role app_role;
  v_activas jsonb;
  v_realizadas jsonb;
BEGIN
  SELECT public.current_user_role() INTO v_role;
  IF v_role IS DISTINCT FROM 'admin'::app_role AND v_role IS DISTINCT FROM 'sales_manager'::app_role THEN
    RAISE EXCEPTION 'no autorizado';
  END IF;
  IF p_to <= p_from OR p_to - p_from > interval '400 days' THEN
    RAISE EXCEPTION 'intervalo no valido';
  END IF;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'due_date' NULLS LAST), '[]'::jsonb) INTO v_activas
  FROM (
    SELECT jsonb_build_object(
      'id', t.id, 'user_id', t.user_id, 'full_name', COALESCE(pr.full_name, ''),
      'task_type', t.task_type, 'title', t.title, 'status', t.status,
      'building_id', t.building_id, 'direccion', COALESCE(b.direccion, ''),
      'started_at', t.started_at, 'created_at', t.created_at, 'due_date', t.due_date
    ) AS x
    FROM public.building_tasks t
    LEFT JOIN public.profiles pr ON pr.id = t.user_id
    LEFT JOIN public.buildings b ON b.id = t.building_id
    WHERE t.status IN ('pending','in_progress')
      AND t.task_type <> 'simulation_v5'
  ) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'completed_at' DESC), '[]'::jsonb) INTO v_realizadas
  FROM (
    SELECT jsonb_build_object(
      'id', t.id, 'user_id', t.user_id, 'full_name', COALESCE(pr.full_name, ''),
      'task_type', t.task_type, 'title', t.title, 'status', t.status,
      'building_id', t.building_id, 'direccion', COALESCE(b.direccion, ''),
      'started_at', t.started_at, 'due_date', t.due_date, 'completed_at', t.completed_at
    ) AS x
    FROM public.building_tasks t
    LEFT JOIN public.profiles pr ON pr.id = t.user_id
    LEFT JOIN public.buildings b ON b.id = t.building_id
    WHERE t.status = 'completed'
      AND t.task_type <> 'simulation_v5'
      AND t.completed_at >= p_from AND t.completed_at < p_to
  ) s;

  RETURN jsonb_build_object(
    'from', p_from, 'to', p_to, 'generated_at', now(),
    'activas', v_activas, 'realizadas', v_realizadas
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_sales_manager_panel(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_manager_panel(timestamptz, timestamptz) TO authenticated;