-- 1) Respaldo completo de tareas
CREATE TABLE IF NOT EXISTS public.backup_20260812_building_tasks AS
  SELECT * FROM public.building_tasks;

GRANT SELECT ON public.backup_20260812_building_tasks TO authenticated;
GRANT ALL ON public.backup_20260812_building_tasks TO service_role;
ALTER TABLE public.backup_20260812_building_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backup tareas solo admin" ON public.backup_20260812_building_tasks;
CREATE POLICY "backup tareas solo admin"
  ON public.backup_20260812_building_tasks FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 2) Excepciones de contacto registradas
CREATE TABLE IF NOT EXISTS public.interlocutor_contact_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  interlocutor_owner_id uuid,
  motivo text NOT NULL,
  autorizado_por uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.interlocutor_contact_exceptions TO authenticated;
GRANT ALL ON public.interlocutor_contact_exceptions TO service_role;
ALTER TABLE public.interlocutor_contact_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "excepciones visibles a equipo" ON public.interlocutor_contact_exceptions;
CREATE POLICY "excepciones visibles a equipo"
  ON public.interlocutor_contact_exceptions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'sales_manager')
    OR autorizado_por = auth.uid()
  );

-- 3) ¿Está este propietario bloqueado por un interlocutor activo?
CREATE OR REPLACE FUNCTION public.owner_bloqueado_por_interlocutor(p_owner_id uuid, p_building_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT bool_or(b.interlocutor_owner_id IS NOT NULL AND b.interlocutor_owner_id <> p_owner_id)
    FROM public.buildings b
    WHERE (p_building_id IS NOT NULL AND b.id = p_building_id)
       OR (p_building_id IS NULL AND EXISTS (
             SELECT 1 FROM public.building_owners bo
             WHERE bo.building_id = b.id AND bo.owner_id = p_owner_id))
  ), false)
$$;

REVOKE ALL ON FUNCTION public.owner_bloqueado_por_interlocutor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_bloqueado_por_interlocutor(uuid, uuid) TO authenticated, service_role;

-- 4) Excepción puntual: solo admin y responsables de equipo, con motivo obligatorio
CREATE OR REPLACE FUNCTION public.registrar_excepcion_contacto(p_building_id uuid, p_owner_id uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_inter uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Debes iniciar sesion.');
  END IF;
  IF NOT (public.has_role(v_uid, 'admin') OR public.has_role(v_uid, 'sales_manager')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administracion o el responsable de equipo pueden autorizar este contacto.');
  END IF;
  IF p_motivo IS NULL OR length(btrim(p_motivo)) < 5 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Escribe el motivo de la excepcion.');
  END IF;

  SELECT interlocutor_owner_id INTO v_inter FROM public.buildings WHERE id = p_building_id;

  INSERT INTO public.interlocutor_contact_exceptions (building_id, owner_id, interlocutor_owner_id, motivo, autorizado_por)
  VALUES (p_building_id, p_owner_id, v_inter, btrim(p_motivo), v_uid)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_excepcion_contacto(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_excepcion_contacto(uuid, uuid, text) TO authenticated, service_role;

-- 5) Bloqueo real en servidor para el registro de llamadas
CREATE OR REPLACE FUNCTION public.tg_bloqueo_interlocutor_call_sessions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.owner_id IS NOT NULL
     AND public.has_role(auth.uid(), 'comercial_zona')
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'sales_manager')
     AND public.owner_bloqueado_por_interlocutor(NEW.owner_id, NEW.building_id) THEN
    RAISE EXCEPTION 'Este edificio tiene un interlocutor activo: no puedes contactar con otros propietarios.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueo_interlocutor_call_sessions ON public.call_sessions;
CREATE TRIGGER trg_bloqueo_interlocutor_call_sessions
  BEFORE INSERT ON public.call_sessions
  FOR EACH ROW EXECUTE FUNCTION public.tg_bloqueo_interlocutor_call_sessions();