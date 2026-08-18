CREATE OR REPLACE FUNCTION public.enqueue_hubspot_contact_write(p_owner_id uuid, p_building_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_key text;
BEGIN
  IF p_owner_id IS NULL THEN RETURN; END IF;
  v_key := 'contact:' || p_owner_id::text || ':update';
  INSERT INTO public.hubspot_write_queue (objeto, accion, entidad_tipo, entidad_id, dedupe_key, payload)
  VALUES ('contact', 'update', 'owner', p_owner_id, v_key,
          jsonb_build_object('owner_id', p_owner_id, 'building_id', p_building_id))
  ON CONFLICT (dedupe_key) WHERE estado IN ('pendiente','error')
  DO UPDATE SET payload = EXCLUDED.payload, estado = 'pendiente',
                last_error = NULL, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_enqueue_hubspot_contact_building()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF NEW.estado IS NOT DISTINCT FROM OLD.estado
     AND NEW.interlocutor_owner_id IS NOT DISTINCT FROM OLD.interlocutor_owner_id THEN
    RETURN NEW;
  END IF;
  IF NEW.interlocutor_owner_id IS NOT NULL THEN
    PERFORM public.enqueue_hubspot_contact_write(NEW.interlocutor_owner_id, NEW.id);
  END IF;
  IF OLD.interlocutor_owner_id IS NOT NULL
     AND OLD.interlocutor_owner_id IS DISTINCT FROM NEW.interlocutor_owner_id THEN
    PERFORM public.enqueue_hubspot_contact_write(OLD.interlocutor_owner_id, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_hubspot_contact_building ON public.buildings;
CREATE TRIGGER trg_enqueue_hubspot_contact_building
  AFTER UPDATE ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_hubspot_contact_building();

CREATE OR REPLACE FUNCTION public.trg_enqueue_hubspot_contact_owner()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.cuota IS NOT DISTINCT FROM OLD.cuota
     AND NEW.es_influencer IS NOT DISTINCT FROM OLD.es_influencer THEN
    RETURN NEW;
  END IF;
  PERFORM public.enqueue_hubspot_contact_write(NEW.owner_id, NEW.building_id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enqueue_hubspot_contact_owner ON public.building_owners;
CREATE TRIGGER trg_enqueue_hubspot_contact_owner
  AFTER UPDATE ON public.building_owners
  FOR EACH ROW EXECUTE FUNCTION public.trg_enqueue_hubspot_contact_owner();

REVOKE ALL ON FUNCTION public.enqueue_hubspot_contact_write(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.enqueue_hubspot_contact_write(uuid, uuid) TO service_role;