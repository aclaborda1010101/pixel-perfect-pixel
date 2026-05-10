
CREATE TABLE IF NOT EXISTS public.hubspot_whatsapp (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_id text NOT NULL UNIQUE,
  hs_communication_channel_type text,
  hs_communication_body text,
  hs_communication_logged_from text,
  hs_timestamp timestamptz,
  hs_owner_id text,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  associated_contact_ids text[] NOT NULL DEFAULT '{}',
  associated_deal_ids text[] NOT NULL DEFAULT '{}',
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hubspot_whatsapp_hs_timestamp ON public.hubspot_whatsapp (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hubspot_whatsapp_hs_owner ON public.hubspot_whatsapp (hs_owner_id);

ALTER TABLE public.hubspot_whatsapp ENABLE ROW LEVEL SECURITY;

CREATE POLICY hubspot_whatsapp_select_all
  ON public.hubspot_whatsapp FOR SELECT
  USING (true);

CREATE POLICY hubspot_whatsapp_service_write
  ON public.hubspot_whatsapp FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER set_updated_at_hubspot_whatsapp
  BEFORE UPDATE ON public.hubspot_whatsapp
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
