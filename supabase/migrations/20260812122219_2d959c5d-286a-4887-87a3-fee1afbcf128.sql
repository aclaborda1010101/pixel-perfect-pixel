REVOKE ALL ON public._flags_20260811 FROM anon, authenticated;
GRANT ALL ON public._flags_20260811 TO service_role;
ALTER TABLE public._flags_20260811 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "_flags_20260811 admin only" ON public._flags_20260811;
CREATE POLICY "_flags_20260811 admin only" ON public._flags_20260811
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));