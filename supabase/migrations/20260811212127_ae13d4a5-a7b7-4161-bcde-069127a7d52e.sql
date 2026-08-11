ALTER TABLE public.wa_consent_signals
  ADD COLUMN IF NOT EXISTS task_id uuid,
  ADD COLUMN IF NOT EXISTS registrado_por uuid,
  ADD COLUMN IF NOT EXISTS fuente text;

CREATE INDEX IF NOT EXISTS wa_consent_signals_owner_veredicto_idx
  ON public.wa_consent_signals (owner_id, veredicto);

INSERT INTO public.app_settings (key, value)
VALUES (
  'plantilla_whatsapp_t23',
  jsonb_build_object(
    'texto',
    'Hola {nombre}, soy {comercial} de Afflux Property. Como hemos hablado ahora por teléfono, te escribo por aquí para enviarte la información de tu edificio de {direccion}. Para cualquier cosa me tienes en este número. Un saludo.'
  )
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('wa_modo_prueba', jsonb_build_object('activo', true))
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value)
VALUES ('wa_numero_prueba', jsonb_build_object('numero', ''))
ON CONFLICT (key) DO NOTHING;