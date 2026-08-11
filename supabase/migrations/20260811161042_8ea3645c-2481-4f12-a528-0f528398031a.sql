-- Miembro del equipo = usuario con rol asignado. SECURITY DEFINER para no depender de RLS.
CREATE OR REPLACE FUNCTION public.is_internal_member()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid())
$$;

REVOKE ALL ON FUNCTION public.is_internal_member() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_internal_member() TO authenticated, service_role;

-- Las políticas 'preview_all_*' pasan de 'true' a 'miembro del equipo'.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename, policyname, cmd
    FROM pg_policies
    WHERE schemaname = 'public' AND policyname LIKE 'preview_all_%'
  LOOP
    IF r.cmd = 'INSERT' THEN
      EXECUTE format('ALTER POLICY %I ON public.%I WITH CHECK (public.is_internal_member())',
                     r.policyname, r.tablename);
    ELSIF r.cmd IN ('UPDATE','ALL') THEN
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_internal_member()) WITH CHECK (public.is_internal_member())',
                     r.policyname, r.tablename);
    ELSE
      EXECUTE format('ALTER POLICY %I ON public.%I USING (public.is_internal_member())',
                     r.policyname, r.tablename);
    END IF;
  END LOOP;
END $$;

-- Perfiles: cada uno el suyo; administración y gestión comercial, todos.
DROP POLICY IF EXISTS profiles_select_authenticated ON public.profiles;
CREATE POLICY profiles_select_self_or_staff ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_gestor_access(auth.uid())
  );
