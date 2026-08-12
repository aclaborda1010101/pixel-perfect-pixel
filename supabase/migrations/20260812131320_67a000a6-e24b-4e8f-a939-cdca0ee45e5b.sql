REVOKE ALL ON TABLE public._jesus_revision_20260812 FROM anon;
GRANT SELECT ON TABLE public._jesus_revision_20260812 TO authenticated;
GRANT ALL ON TABLE public._jesus_revision_20260812 TO service_role;
ALTER TABLE public._jesus_revision_20260812 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "_jesus_revision_20260812 admin read" ON public._jesus_revision_20260812;
CREATE POLICY "_jesus_revision_20260812 admin read" ON public._jesus_revision_20260812
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));