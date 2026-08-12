CREATE OR REPLACE FUNCTION public.tg_bloqueo_interlocutor_owner_contacto()
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
     AND public.owner_bloqueado_por_interlocutor(NEW.owner_id, NULL) THEN
    RAISE EXCEPTION 'Este edificio tiene un interlocutor activo: no puedes contactar con otros propietarios.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bloqueo_interlocutor_whatsapp_messages ON public.whatsapp_messages;
CREATE TRIGGER trg_bloqueo_interlocutor_whatsapp_messages
  BEFORE INSERT ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_bloqueo_interlocutor_owner_contacto();

DROP TRIGGER IF EXISTS trg_bloqueo_interlocutor_cadence_steps ON public.cadence_steps;
CREATE TRIGGER trg_bloqueo_interlocutor_cadence_steps
  BEFORE INSERT ON public.cadence_steps
  FOR EACH ROW EXECUTE FUNCTION public.tg_bloqueo_interlocutor_owner_contacto();