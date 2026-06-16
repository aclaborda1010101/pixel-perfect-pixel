-- Ampliación del sync HubSpot: añadir transcripción a calls y mirrors para meetings/emails

ALTER TABLE public.hubspot_calls
  ADD COLUMN IF NOT EXISTS hs_call_transcription text,
  ADD COLUMN IF NOT EXISTS hs_call_source text;

CREATE TABLE IF NOT EXISTS public.hubspot_meetings (
  hs_id text PRIMARY KEY,
  hs_meeting_title text,
  hs_meeting_body text,
  hs_meeting_start_time timestamptz,
  hs_meeting_end_time timestamptz,
  hs_meeting_outcome text,
  hs_meeting_location text,
  hs_timestamp timestamptz,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  hs_owner_id text,
  associated_contact_ids text[] DEFAULT '{}',
  associated_deal_ids text[] DEFAULT '{}',
  raw jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hubspot_meetings TO authenticated;
GRANT ALL ON public.hubspot_meetings TO service_role;
ALTER TABLE public.hubspot_meetings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_meetings_read_auth" ON public.hubspot_meetings FOR SELECT TO authenticated USING (true);
CREATE POLICY "hubspot_meetings_service_all" ON public.hubspot_meetings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_hubspot_meetings_contacts ON public.hubspot_meetings USING gin(associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hubspot_meetings_ts ON public.hubspot_meetings(hs_timestamp DESC);

CREATE TABLE IF NOT EXISTS public.hubspot_emails (
  hs_id text PRIMARY KEY,
  hs_email_subject text,
  hs_email_text text,
  hs_email_html text,
  hs_email_direction text,
  hs_email_status text,
  hs_email_from_email text,
  hs_email_to_email text,
  hs_timestamp timestamptz,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  hs_owner_id text,
  associated_contact_ids text[] DEFAULT '{}',
  associated_deal_ids text[] DEFAULT '{}',
  raw jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hubspot_emails TO authenticated;
GRANT ALL ON public.hubspot_emails TO service_role;
ALTER TABLE public.hubspot_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_emails_read_auth" ON public.hubspot_emails FOR SELECT TO authenticated USING (true);
CREATE POLICY "hubspot_emails_service_all" ON public.hubspot_emails FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_hubspot_emails_contacts ON public.hubspot_emails USING gin(associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hubspot_emails_ts ON public.hubspot_emails(hs_timestamp DESC);

CREATE TRIGGER set_hubspot_meetings_updated_at BEFORE UPDATE ON public.hubspot_meetings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_hubspot_emails_updated_at BEFORE UPDATE ON public.hubspot_emails
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();