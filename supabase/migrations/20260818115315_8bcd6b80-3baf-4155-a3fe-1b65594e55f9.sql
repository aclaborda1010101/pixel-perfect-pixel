-- Dos interruptores separados: tareas (ON) y campos de contacto (OFF).
INSERT INTO public.app_settings(key, value)
VALUES ('hubspot_escritura_tareas_activada', 'true'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = 'true'::jsonb;

INSERT INTO public.app_settings(key, value)
VALUES ('hubspot_escritura_contactos_activada', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- El interruptor histórico queda como estaba (apagado) y ya no gobierna las tareas.
INSERT INTO public.app_settings(key, value)
VALUES ('hubspot_escritura_activada', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.hubspot_escritura_activada_objeto(p_objeto text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN p_objeto = 'task' THEN
      COALESCE((SELECT value FROM public.app_settings
                WHERE key = 'hubspot_escritura_tareas_activada'), 'false'::jsonb) = 'true'::jsonb
    WHEN p_objeto = 'contact' THEN
      COALESCE((SELECT value FROM public.app_settings
                WHERE key = 'hubspot_escritura_contactos_activada'), 'false'::jsonb) = 'true'::jsonb
    ELSE false
  END;
$$;
REVOKE ALL ON FUNCTION public.hubspot_escritura_activada_objeto(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hubspot_escritura_activada_objeto(text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hubspot_interruptores()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'tareas', public.hubspot_escritura_activada_objeto('task'),
    'contactos', public.hubspot_escritura_activada_objeto('contact')
  );
$$;
REVOKE ALL ON FUNCTION public.hubspot_interruptores() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hubspot_interruptores() TO authenticated, service_role;