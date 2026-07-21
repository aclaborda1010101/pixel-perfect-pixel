
-- 1) RPC: intenta emparejar un contacto HubSpot huérfano con un owner existente.
CREATE OR REPLACE FUNCTION public.find_owner_for_orphan_contact(
  p_email text, p_phone text, p_first text, p_last text
) RETURNS TABLE(owner_id uuid, method text, confidence numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid; v_cnt int;
  v_phone_norm text;
  v_full text;
  v_sim numeric;
  v_next_sim numeric;
BEGIN
  -- Email exacto y único
  IF p_email IS NOT NULL AND p_email <> '' THEN
    SELECT count(*), min(o.id) INTO v_cnt, v_id
    FROM public.owners o
    WHERE lower(o.email) = lower(p_email)
      AND o.merged_into IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e
        WHERE e.entity_type='owner' AND e.entity_id=o.id
          AND e.provider='hubspot' AND e.provider_object_type='contact'
      );
    IF v_cnt = 1 THEN
      RETURN QUERY SELECT v_id, 'email'::text, 1.0::numeric; RETURN;
    END IF;
  END IF;

  -- Teléfono: últimos 9 dígitos, único
  v_phone_norm := right(regexp_replace(coalesce(p_phone,''),'\D','','g'), 9);
  IF length(v_phone_norm) = 9 THEN
    SELECT count(*), min(o.id) INTO v_cnt, v_id
    FROM public.owners o
    WHERE o.merged_into IS NULL
      AND o.telefono IS NOT NULL
      AND right(regexp_replace(o.telefono,'\D','','g'), 9) = v_phone_norm
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e
        WHERE e.entity_type='owner' AND e.entity_id=o.id
          AND e.provider='hubspot' AND e.provider_object_type='contact'
      );
    IF v_cnt = 1 THEN
      RETURN QUERY SELECT v_id, 'phone'::text, 0.95::numeric; RETURN;
    END IF;
  END IF;

  -- Nombre: similaridad trigrama, top-1 con margen
  v_full := normalize_person_name(concat_ws(' ', p_first, p_last));
  IF v_full IS NOT NULL AND length(v_full) >= 5 THEN
    WITH cand AS (
      SELECT o.id, similarity(normalize_person_name(o.nombre), v_full) AS sim
      FROM public.owners o
      WHERE o.merged_into IS NULL
        AND o.nombre IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.external_ids e
          WHERE e.entity_type='owner' AND e.entity_id=o.id
            AND e.provider='hubspot' AND e.provider_object_type='contact'
        )
        AND normalize_person_name(o.nombre) % v_full
      ORDER BY similarity(normalize_person_name(o.nombre), v_full) DESC
      LIMIT 2
    )
    SELECT id, sim INTO v_id, v_sim FROM cand ORDER BY sim DESC LIMIT 1;
    SELECT sim INTO v_next_sim FROM cand ORDER BY sim DESC OFFSET 1 LIMIT 1;
    IF v_id IS NOT NULL AND v_sim >= 0.75
       AND (v_next_sim IS NULL OR (v_sim - v_next_sim) >= 0.15) THEN
      RETURN QUERY SELECT v_id, 'name'::text, v_sim; RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT NULL::uuid, 'none'::text, 0::numeric;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_owner_for_orphan_contact(text,text,text,text) TO authenticated, service_role;

-- 2) Cola de revisión (contactos HubSpot sin match claro tras auto-linker).
CREATE TABLE IF NOT EXISTS public.hubspot_link_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hs_contact_id text NOT NULL UNIQUE,
  firstname text,
  lastname text,
  email text,
  phone text,
  refs_count int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending | resolved | ignored
  reason text,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.hubspot_link_review TO authenticated;
GRANT ALL ON public.hubspot_link_review TO service_role;
ALTER TABLE public.hubspot_link_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY "read link review" ON public.hubspot_link_review
  FOR SELECT TO authenticated USING (true);
CREATE INDEX IF NOT EXISTS idx_hubspot_link_review_status ON public.hubspot_link_review(status, updated_at DESC);

-- 3) Limpieza: filas legacy de sync_state que confunden ("notes/calls/tasks" del engagements viejo).
--    El sync real vive en calls_inc / notes_inc / tasks_inc / meetings_inc.
UPDATE public.hubspot_sync_state
SET last_error = 'DEPRECATED: reemplazado por *_inc (hubspot_sync_incremental)'
WHERE entity IN ('calls','notes','tasks') AND (last_error IS NULL OR last_error NOT LIKE 'DEPRECATED%');

-- 4) Cron: link_orphan_contacts cada 10 min (tras sync incremental).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'link_orphan_contacts_10m') THEN
    PERFORM cron.schedule(
      'link_orphan_contacts_10m',
      '*/10 * * * *',
      $cron$
        SELECT net.http_post(
          url := 'https://vsbrupwznqaaoiflvliu.supabase.co/functions/v1/link_orphan_contacts',
          headers := jsonb_build_object(
            'Content-Type','application/json',
            'Authorization','Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzYnJ1cHd6bnFhYW9pZmx2bGl1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMDY4NTQsImV4cCI6MjA5Mjg4Mjg1NH0.FoDIOJ2BVIenXF7VVAnsM4jlSAQuUg8chVlCUFmpoms'
          ),
          body := jsonb_build_object('since_days', 14, 'max_contacts', 200)
        );
      $cron$
    );
  END IF;
END $$;
