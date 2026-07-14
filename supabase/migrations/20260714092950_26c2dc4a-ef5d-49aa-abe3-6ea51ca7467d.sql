-- 1) Cache table
CREATE TABLE IF NOT EXISTS public.owner_call_prep_cache (
  owner_id uuid PRIMARY KEY REFERENCES public.owners(id) ON DELETE CASCADE,
  kpis_json jsonb,
  brief_json jsonb,
  kpis_generated_at timestamptz,
  brief_generated_at timestamptz,
  kpis_last_activity_at timestamptz,
  brief_last_activity_at timestamptz,
  kpis_model text,
  brief_model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_call_prep_cache TO authenticated;
GRANT ALL ON public.owner_call_prep_cache TO service_role;

ALTER TABLE public.owner_call_prep_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth read prep cache" ON public.owner_call_prep_cache;
CREATE POLICY "auth read prep cache" ON public.owner_call_prep_cache
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "auth write prep cache" ON public.owner_call_prep_cache;
CREATE POLICY "auth write prep cache" ON public.owner_call_prep_cache
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "auth update prep cache" ON public.owner_call_prep_cache;
CREATE POLICY "auth update prep cache" ON public.owner_call_prep_cache
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth delete prep cache" ON public.owner_call_prep_cache;
CREATE POLICY "auth delete prep cache" ON public.owner_call_prep_cache
  FOR DELETE TO authenticated USING (true);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._touch_owner_call_prep_cache()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_owner_call_prep_cache ON public.owner_call_prep_cache;
CREATE TRIGGER trg_touch_owner_call_prep_cache
BEFORE UPDATE ON public.owner_call_prep_cache
FOR EACH ROW EXECUTE FUNCTION public._touch_owner_call_prep_cache();

-- 2) Last activity function
CREATE OR REPLACE FUNCTION public.owner_last_activity_at(_owner_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH hs AS (
    SELECT array_agg(provider_id) AS ids
    FROM public.external_ids
    WHERE entity_type = 'owner' AND entity_id = _owner_id AND provider = 'hubspot'
  ),
  vals AS (
    SELECT MAX(fecha) AS t FROM public.calls WHERE owner_id = _owner_id
    UNION ALL
    SELECT MAX(GREATEST(coalesce(hs_timestamp,'-infinity'::timestamptz), coalesce(hs_lastmodifieddate,'-infinity'::timestamptz)))
    FROM public.hubspot_calls hc, hs
    WHERE hs.ids IS NOT NULL AND hc.associated_contact_ids && hs.ids
    UNION ALL
    SELECT MAX(GREATEST(coalesce(hs_timestamp,'-infinity'::timestamptz), coalesce(hs_lastmodifieddate,'-infinity'::timestamptz)))
    FROM public.hubspot_notes hn, hs
    WHERE hs.ids IS NOT NULL AND hn.associated_contact_ids && hs.ids
    UNION ALL
    SELECT MAX(GREATEST(coalesce(hs_timestamp,'-infinity'::timestamptz), coalesce(hs_lastmodifieddate,'-infinity'::timestamptz)))
    FROM public.hubspot_whatsapp hw, hs
    WHERE hs.ids IS NOT NULL AND hw.associated_contact_ids && hs.ids
    UNION ALL
    SELECT GREATEST(o.updated_at, o.created_at) FROM public.owners o WHERE o.id = _owner_id
  )
  SELECT MAX(t) FROM vals;
$$;

GRANT EXECUTE ON FUNCTION public.owner_last_activity_at(uuid) TO authenticated, service_role, anon;
