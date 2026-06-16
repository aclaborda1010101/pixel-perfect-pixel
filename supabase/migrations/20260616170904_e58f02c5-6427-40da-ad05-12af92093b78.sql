
-- Helper: has_whatsapp_access (admin or whatsapp role)
CREATE OR REPLACE FUNCTION public.has_whatsapp_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin'::public.app_role, 'whatsapp'::public.app_role)
  )
$$;

CREATE TABLE public.wa_instances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_name text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'disconnected',
  qr_base64 text,
  phone_number text,
  owner_jid text,
  last_seen_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_instances TO authenticated;
GRANT ALL ON public.wa_instances TO service_role;
ALTER TABLE public.wa_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_instances all access" ON public.wa_instances FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TABLE public.wa_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL UNIQUE,
  jid text,
  name text,
  lead_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'nuevo',
  sentiment text,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_message_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_contacts TO authenticated;
GRANT ALL ON public.wa_contacts TO service_role;
ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_contacts all access" ON public.wa_contacts FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TABLE public.wa_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'open',
  summary text,
  qualification jsonb NOT NULL DEFAULT '{}'::jsonb,
  ai_enabled boolean NOT NULL DEFAULT true,
  unread_count integer NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  campaign_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_conversations_contact_idx ON public.wa_conversations(contact_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_conversations TO authenticated;
GRANT ALL ON public.wa_conversations TO service_role;
ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_conversations all access" ON public.wa_conversations FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TABLE public.wa_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.wa_contacts(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('in','out')),
  type text NOT NULL DEFAULT 'text',
  content text,
  media_url text,
  evolution_message_id text,
  ai_generated boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'sent',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_messages_conv_idx ON public.wa_messages(conversation_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_messages TO authenticated;
GRANT ALL ON public.wa_messages TO service_role;
ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_messages all access" ON public.wa_messages FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TABLE public.wa_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  template text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  target_count integer NOT NULL DEFAULT 0,
  sent_count integer NOT NULL DEFAULT 0,
  replied_count integer NOT NULL DEFAULT 0,
  qualified_count integer NOT NULL DEFAULT 0,
  scheduled_at timestamptz,
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_campaigns TO authenticated;
GRANT ALL ON public.wa_campaigns TO service_role;
ALTER TABLE public.wa_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_campaigns all access" ON public.wa_campaigns FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TABLE public.wa_campaign_targets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.wa_campaigns(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.wa_contacts(id) ON DELETE SET NULL,
  phone text NOT NULL,
  name text,
  status text NOT NULL DEFAULT 'pending',
  sent_at timestamptz,
  replied_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_campaign_targets_camp_idx ON public.wa_campaign_targets(campaign_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_campaign_targets TO authenticated;
GRANT ALL ON public.wa_campaign_targets TO service_role;
ALTER TABLE public.wa_campaign_targets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_campaign_targets all access" ON public.wa_campaign_targets FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TABLE public.wa_bot_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona text NOT NULL DEFAULT 'Eres Lucía, asesora inmobiliaria de Afflux. Hablas natural, cercana, sin sonar a bot. Frases cortas, alguna pausa con puntos suspensivos, emoji ocasional muy puntual. Nunca te identificas como IA.',
  tone text NOT NULL DEFAULT 'cercano',
  goals jsonb NOT NULL DEFAULT '["cualificar interes","obtener presupuesto","obtener zona preferida","obtener tipologia","cerrar visita o llamada"]'::jsonb,
  extract_fields jsonb NOT NULL DEFAULT '["presupuesto","zona","tipologia","plazo","motivacion","decisor"]'::jsonb,
  forbidden jsonb NOT NULL DEFAULT '["soy un bot","inteligencia artificial","modelo de lenguaje"]'::jsonb,
  reply_delay_min integer NOT NULL DEFAULT 4,
  reply_delay_max integer NOT NULL DEFAULT 22,
  active_hours jsonb NOT NULL DEFAULT '{"from":"09:00","to":"21:00","tz":"Europe/Madrid"}'::jsonb,
  off_hours_message text DEFAULT 'Te respondo mañana sin falta 🙌',
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_bot_config TO authenticated;
GRANT ALL ON public.wa_bot_config TO service_role;
ALTER TABLE public.wa_bot_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_bot_config all access" ON public.wa_bot_config FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

INSERT INTO public.wa_bot_config DEFAULT VALUES;

CREATE TABLE public.wa_ai_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.wa_conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',
  run_after timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_ai_jobs_pending_idx ON public.wa_ai_jobs(status, run_after);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wa_ai_jobs TO authenticated;
GRANT ALL ON public.wa_ai_jobs TO service_role;
ALTER TABLE public.wa_ai_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_ai_jobs all access" ON public.wa_ai_jobs FOR ALL TO authenticated
  USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));

CREATE TRIGGER wa_instances_set_updated_at BEFORE UPDATE ON public.wa_instances
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_contacts_set_updated_at BEFORE UPDATE ON public.wa_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_conversations_set_updated_at BEFORE UPDATE ON public.wa_conversations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_campaigns_set_updated_at BEFORE UPDATE ON public.wa_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_bot_config_set_updated_at BEFORE UPDATE ON public.wa_bot_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER wa_ai_jobs_set_updated_at BEFORE UPDATE ON public.wa_ai_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_conversations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.wa_instances;
