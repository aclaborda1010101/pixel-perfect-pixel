
-- Add assignment and discard state on wa_conversations
ALTER TABLE public.wa_conversations
  ADD COLUMN IF NOT EXISTS assigned_email text,
  ADD COLUMN IF NOT EXISTS assigned_name text,
  ADD COLUMN IF NOT EXISTS assignment_source text, -- 'manual' | 'auto'
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS discarded_at timestamptz,
  ADD COLUMN IF NOT EXISTS discarded_by uuid,
  ADD COLUMN IF NOT EXISTS discard_reason text;

-- Broader read access for the Oportunidades page (admin, whatsapp, comercial_zona, captacion)
CREATE OR REPLACE FUNCTION public.has_oportunidades_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::public.app_role, 'whatsapp'::public.app_role,
                   'comercial_zona'::public.app_role, 'captacion'::public.app_role)
  )
$$;

DROP POLICY IF EXISTS "wa_conversations oportunidades read" ON public.wa_conversations;
CREATE POLICY "wa_conversations oportunidades read"
  ON public.wa_conversations FOR SELECT TO authenticated
  USING (public.has_oportunidades_access(auth.uid()));

DROP POLICY IF EXISTS "wa_contacts oportunidades read" ON public.wa_contacts;
CREATE POLICY "wa_contacts oportunidades read"
  ON public.wa_contacts FOR SELECT TO authenticated
  USING (public.has_oportunidades_access(auth.uid()));

DROP POLICY IF EXISTS "wa_messages oportunidades read" ON public.wa_messages;
CREATE POLICY "wa_messages oportunidades read"
  ON public.wa_messages FOR SELECT TO authenticated
  USING (public.has_oportunidades_access(auth.uid()));

-- Allow updating assignment/discard fields (admin + comercial_zona + whatsapp)
DROP POLICY IF EXISTS "wa_conversations oportunidades update" ON public.wa_conversations;
CREATE POLICY "wa_conversations oportunidades update"
  ON public.wa_conversations FOR UPDATE TO authenticated
  USING (public.has_oportunidades_access(auth.uid()))
  WITH CHECK (public.has_oportunidades_access(auth.uid()));
