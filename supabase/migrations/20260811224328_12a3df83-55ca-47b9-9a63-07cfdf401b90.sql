ALTER TYPE public.building_status ADD VALUE IF NOT EXISTS 'posible_interes';

ALTER TABLE public.buildings
  ADD COLUMN IF NOT EXISTS interlocutor_owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interlocutor_motivo text,
  ADD COLUMN IF NOT EXISTS interlocutor_marcado_por uuid,
  ADD COLUMN IF NOT EXISTS interlocutor_marcado_at timestamptz;

CREATE TABLE IF NOT EXISTS public.building_interlocutor_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  accion text NOT NULL CHECK (accion IN ('marcado','retirado')),
  motivo text,
  actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.building_interlocutor_history TO authenticated;
GRANT ALL ON public.building_interlocutor_history TO service_role;
ALTER TABLE public.building_interlocutor_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "interlocutor_history_read" ON public.building_interlocutor_history;
CREATE POLICY "interlocutor_history_read" ON public.building_interlocutor_history
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_interlocutor_history_building
  ON public.building_interlocutor_history(building_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.can_manage_building_interlocutor(_building_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR public.has_role(_user_id, 'sales_manager'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.building_assignments ba
      WHERE ba.building_id = _building_id
        AND ba.user_id = _user_id
        AND ba.status = 'active'
    )
  )
$$;

REVOKE ALL ON FUNCTION public.can_manage_building_interlocutor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_building_interlocutor(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.set_building_interlocutor(p_building_id uuid, p_owner_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'no_autenticado'; END IF;
  IF NOT public.can_manage_building_interlocutor(p_building_id, v_user) THEN
    RAISE EXCEPTION 'no_autorizado';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.building_owners bo WHERE bo.building_id = p_building_id AND bo.owner_id = p_owner_id) THEN
    RAISE EXCEPTION 'propietario_no_vinculado';
  END IF;

  UPDATE public.buildings
     SET interlocutor_owner_id = p_owner_id,
         interlocutor_motivo = NULLIF(btrim(coalesce(p_motivo,'')),''),
         interlocutor_marcado_por = v_user,
         interlocutor_marcado_at = now(),
         updated_at = now()
   WHERE id = p_building_id;

  INSERT INTO public.building_interlocutor_history (building_id, owner_id, accion, motivo, actor_id)
  VALUES (p_building_id, p_owner_id, 'marcado', NULLIF(btrim(coalesce(p_motivo,'')),''), v_user);

  RETURN jsonb_build_object('ok', true, 'building_id', p_building_id, 'owner_id', p_owner_id, 'actor_id', v_user);
END;
$$;

REVOKE ALL ON FUNCTION public.set_building_interlocutor(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_building_interlocutor(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.clear_building_interlocutor(p_building_id uuid, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid := auth.uid(); v_prev uuid;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'no_autenticado'; END IF;
  IF NOT public.can_manage_building_interlocutor(p_building_id, v_user) THEN
    RAISE EXCEPTION 'no_autorizado';
  END IF;

  SELECT interlocutor_owner_id INTO v_prev FROM public.buildings WHERE id = p_building_id;

  UPDATE public.buildings
     SET interlocutor_owner_id = NULL,
         interlocutor_motivo = NULL,
         interlocutor_marcado_por = NULL,
         interlocutor_marcado_at = NULL,
         updated_at = now()
   WHERE id = p_building_id;

  INSERT INTO public.building_interlocutor_history (building_id, owner_id, accion, motivo, actor_id)
  VALUES (p_building_id, v_prev, 'retirado', NULLIF(btrim(coalesce(p_motivo,'')),''), v_user);

  RETURN jsonb_build_object('ok', true, 'building_id', p_building_id, 'owner_id', v_prev, 'actor_id', v_user);
END;
$$;

REVOKE ALL ON FUNCTION public.clear_building_interlocutor(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_building_interlocutor(uuid, text) TO authenticated, service_role;