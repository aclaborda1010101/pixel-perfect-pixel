
-- Identidad del remitente en wa_messages y memoria cross-channel en wa_contacts.

ALTER TABLE public.wa_messages
  ADD COLUMN IF NOT EXISTS sender_type text,
  ADD COLUMN IF NOT EXISTS agent_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.wa_campaigns(id) ON DELETE SET NULL;

ALTER TABLE public.wa_messages
  DROP CONSTRAINT IF EXISTS wa_messages_sender_type_check;
ALTER TABLE public.wa_messages
  ADD CONSTRAINT wa_messages_sender_type_check
  CHECK (sender_type IS NULL OR sender_type IN ('contact','bot','human_agent','system'));

UPDATE public.wa_messages
SET sender_type = CASE
  WHEN direction = 'in' THEN 'contact'
  WHEN type = 'system' THEN 'system'
  WHEN ai_generated THEN 'bot'
  ELSE 'human_agent'
END
WHERE sender_type IS NULL;

ALTER TABLE public.wa_contacts
  ADD COLUMN IF NOT EXISTS last_human_agent_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_human_contact_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_bot_contact_at timestamptz;

-- Trigger: mantener last_human_*/last_bot_* al insertar mensajes salientes.
CREATE OR REPLACE FUNCTION public.wa_messages_touch_contact_origin()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.direction = 'out' AND NEW.sender_type = 'human_agent' THEN
    UPDATE public.wa_contacts
      SET last_human_agent_id = COALESCE(NEW.agent_user_id, last_human_agent_id),
          last_human_contact_at = NEW.created_at
      WHERE id = NEW.contact_id;
  ELSIF NEW.direction = 'out' AND NEW.sender_type = 'bot' THEN
    UPDATE public.wa_contacts
      SET last_bot_contact_at = NEW.created_at
      WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS wa_messages_touch_contact_origin_trg ON public.wa_messages;
CREATE TRIGGER wa_messages_touch_contact_origin_trg
AFTER INSERT ON public.wa_messages
FOR EACH ROW EXECUTE FUNCTION public.wa_messages_touch_contact_origin();

-- Backfill last_human_contact_at / last_bot_contact_at desde el histórico.
WITH last_human AS (
  SELECT contact_id, max(created_at) AS ts
  FROM public.wa_messages
  WHERE sender_type = 'human_agent'
  GROUP BY contact_id
), last_bot AS (
  SELECT contact_id, max(created_at) AS ts
  FROM public.wa_messages
  WHERE sender_type = 'bot'
  GROUP BY contact_id
)
UPDATE public.wa_contacts c
SET last_human_contact_at = COALESCE(c.last_human_contact_at, lh.ts),
    last_bot_contact_at   = COALESCE(c.last_bot_contact_at,   lb.ts)
FROM last_human lh
FULL OUTER JOIN last_bot lb ON lb.contact_id = lh.contact_id
WHERE c.id = COALESCE(lh.contact_id, lb.contact_id);
