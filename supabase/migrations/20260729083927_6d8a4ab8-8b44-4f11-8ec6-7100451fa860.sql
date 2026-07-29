CREATE TABLE IF NOT EXISTS public.hubspot_deals (
  hs_id text PRIMARY KEY,
  dealname text,
  dealstage text,
  pipeline text,
  hs_owner_id text,
  amount numeric,
  closedate timestamptz,
  hs_createdate timestamptz,
  hs_lastmodifieddate timestamptz,
  cobertura_del_edificio text,
  n_total_de_copropietarios text,
  associated_contact_ids text[] DEFAULT '{}'::text[],
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.hubspot_deals TO authenticated;
GRANT ALL ON public.hubspot_deals TO service_role;

ALTER TABLE public.hubspot_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hubspot_deals_read_auth" ON public.hubspot_deals
  FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS hubspot_deals_lastmod_idx ON public.hubspot_deals (hs_lastmodifieddate DESC);
CREATE INDEX IF NOT EXISTS hubspot_deals_owner_idx ON public.hubspot_deals (hs_owner_id);
CREATE INDEX IF NOT EXISTS hubspot_deals_contacts_gin ON public.hubspot_deals USING GIN (associated_contact_ids);

CREATE OR REPLACE FUNCTION public.touch_hubspot_deals_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_hubspot_deals_updated_at ON public.hubspot_deals;
CREATE TRIGGER trg_hubspot_deals_updated_at BEFORE UPDATE ON public.hubspot_deals
  FOR EACH ROW EXECUTE FUNCTION public.touch_hubspot_deals_updated_at();