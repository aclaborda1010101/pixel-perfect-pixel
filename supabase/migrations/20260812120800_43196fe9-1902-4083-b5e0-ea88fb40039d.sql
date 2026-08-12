ALTER TABLE public._sumcheck_20260812 ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public._sumcheck_20260812 FROM anon;
GRANT SELECT ON public._sumcheck_20260812 TO authenticated;
GRANT ALL ON public._sumcheck_20260812 TO service_role;

DROP POLICY IF EXISTS "internal_members_select_sumcheck" ON public._sumcheck_20260812;
CREATE POLICY "internal_members_select_sumcheck"
ON public._sumcheck_20260812
FOR SELECT
TO authenticated
USING (public.is_internal_member());