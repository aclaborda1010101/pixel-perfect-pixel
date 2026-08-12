CREATE OR REPLACE FUNCTION public.start_building_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.building_tasks%ROWTYPE;
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'la tarea no te pertenece' USING ERRCODE = '42501';
  END IF;

  v_mode := COALESCE(to_jsonb(v_row) ->> 'generation_mode', 'production');
  IF v_mode NOT IN ('production','manual') THEN
    RAISE EXCEPTION 'modo de generación no iniciable: %', v_mode USING ERRCODE = '22023';
  END IF;

  IF v_row.status IN ('completed','skipped','no_procede','blocked','cancelled') THEN
    RAISE EXCEPTION 'la tarea en estado % no se puede empezar', v_row.status USING ERRCODE = '22023';
  END IF;

  IF v_row.status = 'in_progress' AND v_row.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status,
                              'started_at', v_row.started_at, 'idempotent', true);
  END IF;

  IF v_row.status NOT IN ('pending','in_progress') THEN
    RAISE EXCEPTION 'estado no admitido para empezar: %', COALESCE(v_row.status, 'null') USING ERRCODE = '22023';
  END IF;

  UPDATE public.building_tasks
     SET started_at = COALESCE(started_at, now()),
         status = 'in_progress',
         updated_at = now()
   WHERE id = p_task_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status,
                            'started_at', v_row.started_at, 'idempotent', false);
END $$;

REVOKE ALL ON FUNCTION public.start_building_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_building_task(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_building_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.building_tasks%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.user_id IS DISTINCT FROM v_uid AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'la tarea no te pertenece' USING ERRCODE = '42501';
  END IF;

  IF v_row.status IS NULL OR v_row.status NOT IN ('completed','skipped','no_procede','blocked','cancelled') THEN
    RAISE EXCEPTION 'estado no reabrible: %', COALESCE(v_row.status,'null') USING ERRCODE = '22023';
  END IF;

  UPDATE public.building_tasks
     SET status = 'pending', started_at = NULL, completed_at = NULL, updated_at = now()
   WHERE id = p_task_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status,
                            'started_at', v_row.started_at);
END $$;

REVOKE ALL ON FUNCTION public.reopen_building_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_building_task(uuid) TO authenticated;