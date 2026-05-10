
CREATE TABLE IF NOT EXISTS public.hubspot_communications (
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

CREATE INDEX IF NOT EXISTS idx_hubspot_communications_hs_timestamp ON public.hubspot_communications (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hubspot_communications_channel ON public.hubspot_communications (hs_communication_channel_type);
CREATE INDEX IF NOT EXISTS idx_hubspot_communications_hs_owner ON public.hubspot_communications (hs_owner_id);

ALTER TABLE public.hubspot_communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY hubspot_communications_select_all
  ON public.hubspot_communications FOR SELECT
  USING (true);

CREATE POLICY hubspot_communications_service_write
  ON public.hubspot_communications FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER set_updated_at_hubspot_communications
  BEFORE UPDATE ON public.hubspot_communications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
