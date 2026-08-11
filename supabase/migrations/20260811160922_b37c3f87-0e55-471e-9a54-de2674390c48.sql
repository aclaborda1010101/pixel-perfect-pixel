-- 1) Toda política dirigida a PUBLIC (incluye anon) pasa a authenticated, sin tocar su lógica.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname IN ('public','storage') AND roles::text = '{public}'
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END $$;

-- Excepciones: buckets realmente públicos siguen siendo legibles sin sesión.
ALTER POLICY catastro_public_read ON storage.objects TO public;
ALTER POLICY imagery_public_read ON storage.objects TO public;

-- 2) Sin acceso anónimo al área de datos.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;

-- 3) RLS en las tablas que estaban sin protección.
DO $$
DECLARE
  t text;
  abiertas text[] := ARRAY['building_overrides','wa_consent_signals'];
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format($f$CREATE POLICY %I ON public.%I FOR ALL TO authenticated
                      USING (has_role(auth.uid(), 'admin'::app_role))
                      WITH CHECK (has_role(auth.uid(), 'admin'::app_role))$f$,
                   t || '_admin_all', t);
    IF t = ANY(abiertas) THEN
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
                     t || '_read_auth', t);
    END IF;
  END LOOP;
END $$;

-- 4) Lecturas que hoy ya se obtienen a través de vistas con permisos elevados.
DROP POLICY IF EXISTS sessions_select_retroactiva_public ON public.call_sessions;
CREATE POLICY call_sessions_read_auth ON public.call_sessions
  FOR SELECT TO authenticated USING (true);
CREATE POLICY guard_proposals_read_auth ON public.guard_proposals
  FOR SELECT TO authenticated USING (true);

-- 5) Vistas evaluadas con los permisos de quien consulta.
DO $$
DECLARE v text;
BEGIN
  FOR v IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'v'
      AND coalesce(c.reloptions::text,'') NOT LIKE '%security_invoker%'
  LOOP
    EXECUTE format('ALTER VIEW public.%I SET (security_invoker = on)', v);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
