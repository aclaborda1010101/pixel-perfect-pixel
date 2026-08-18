CREATE TABLE IF NOT EXISTS public.hubspot_write_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objeto text NOT NULL CHECK (objeto IN ('task','contact')),
  accion text NOT NULL CHECK (accion IN ('upsert','update')),
  entidad_tipo text NOT NULL,
  entidad_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','simulado','enviado','error','descartado')),
  intentos integer NOT NULL DEFAULT 0,
  last_error text,
  hubspot_id text,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS hubspot_write_queue_dedupe_viva
  ON public.hubspot_write_queue (dedupe_key)
  WHERE estado IN ('pendiente','error');

CREATE INDEX IF NOT EXISTS hubspot_write_queue_estado_idx
  ON public.hubspot_write_queue (estado, created_at);

GRANT SELECT ON public.hubspot_write_queue TO authenticated;
GRANT ALL ON public.hubspot_write_queue TO service_role;

ALTER TABLE public.hubspot_write_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hubspot_write_queue_admin_all ON public.hubspot_write_queue;
CREATE POLICY hubspot_write_queue_admin_all ON public.hubspot_write_queue
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_hubspot_write_queue()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_hubspot_write_queue ON public.hubspot_write_queue;
CREATE TRIGGER trg_touch_hubspot_write_queue
  BEFORE UPDATE ON public.hubspot_write_queue
  FOR EACH ROW EXECUTE FUNCTION public.touch_hubspot_write_queue();

-- Interruptor maestro: por defecto APAGADO.
CREATE OR REPLACE FUNCTION public.hubspot_escritura_activada()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT value FROM public.app_settings
                   WHERE key = 'hubspot_escritura_activada'), 'false'::jsonb) = 'true'::jsonb;
$$;
REVOKE ALL ON FUNCTION public.hubspot_escritura_activada() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hubspot_escritura_activada() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hubspot_write_queue_counts()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(estado, n), '{}'::jsonb)
  FROM (SELECT estado, count(*) AS n FROM public.hubspot_write_queue GROUP BY estado) s;
$$;
REVOKE ALL ON FUNCTION public.hubspot_write_queue_counts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hubspot_write_queue_counts() TO authenticated, service_role;

-- Encolado automático de tareas de edificio (no envía nada).
CREATE OR REPLACE FUNCTION public.enqueue_hubspot_task_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_key text := 'task:' || NEW.id::text || ':upsert';
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
     AND NEW.title IS NOT DISTINCT FROM OLD.title
     AND NEW.due_date IS NOT DISTINCT FROM OLD.due_date
     AND NEW.description IS NOT DISTINCT FROM OLD.description THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.hubspot_write_queue (objeto, accion, entidad_tipo, entidad_id, dedupe_key, payload)
  VALUES ('task', 'upsert', 'building_task', NEW.id, v_key,
          jsonb_build_object('task_id', NEW.id, 'building_id', NEW.building_id,
                             'user_id', NEW.user_id, 'status', NEW.status))
  ON CONFLICT (dedupe_key) WHERE estado IN ('pendiente','error')
  DO UPDATE SET payload = EXCLUDED.payload, estado = 'pendiente',
                last_error = NULL, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_hubspot_task_write ON public.building_tasks;
CREATE TRIGGER trg_enqueue_hubspot_task_write
  AFTER INSERT OR UPDATE ON public.building_tasks
  FOR EACH ROW EXECUTE FUNCTION public.enqueue_hubspot_task_write();

-- Aplicación en la app de un cierre venido de HubSpot (sólo servidor).
CREATE OR REPLACE FUNCTION public.hubspot_apply_task_status(p_task_id uuid, p_status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actual text;
BEGIN
  IF p_status NOT IN ('completed','skipped','blocked','in_progress') THEN
    RAISE EXCEPTION 'estado no admitido: %', p_status;
  END IF;
  SELECT status INTO v_actual FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF v_actual IS NULL THEN RETURN false; END IF;
  IF v_actual = p_status THEN RETURN false; END IF;
  IF v_actual IN ('completed','cancelled','superseded','no_procede') THEN RETURN false; END IF;
  UPDATE public.building_tasks
     SET status = p_status,
         completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
         updated_at = now()
   WHERE id = p_task_id;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.hubspot_apply_task_status(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hubspot_apply_task_status(uuid, text) TO service_role;