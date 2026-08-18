CREATE OR REPLACE FUNCTION public.guard_proposals_solo_aplicada_con_escritura()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $tg$
DECLARE
  v_jwt_role text := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '');
BEGIN
  IF NEW.estado = 'aplicada' AND (TG_OP = 'INSERT' OR OLD.estado IS DISTINCT FROM 'aplicada') THEN
    IF NEW.aplicada_at IS NULL THEN
      RAISE EXCEPTION 'Una corrección no puede quedar como aplicada sin fecha de aplicación real';
    END IF;
    IF NOT (
      current_user IN ('service_role','postgres','supabase_admin')
      OR v_jwt_role = 'service_role'
      OR coalesce(NEW.resuelto_por,'') LIKE 'sistema:%'
    ) THEN
      RAISE EXCEPTION 'Sólo el proceso que escribe en HubSpot puede marcar una corrección como aplicada';
    END IF;
  END IF;
  RETURN NEW;
END; $tg$;