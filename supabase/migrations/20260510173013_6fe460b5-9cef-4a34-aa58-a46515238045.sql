
ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS hs_id text,
  ADD COLUMN IF NOT EXISTS direccion text,
  ADD COLUMN IF NOT EXISTS metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS building_id uuid,
  ADD COLUMN IF NOT EXISTS hubspot_owner_id text;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_hs_id_uniq
  ON public.whatsapp_messages(hs_id) WHERE hs_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS whatsapp_messages_owner_idx
  ON public.whatsapp_messages(owner_id);
