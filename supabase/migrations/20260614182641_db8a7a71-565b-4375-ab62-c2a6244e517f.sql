
CREATE TABLE IF NOT EXISTS public.call_playbook (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  perfil_tipologia text NOT NULL,
  tactica_tipo text NOT NULL,
  tactica_texto text NOT NULL,
  ejemplo_literal text,
  n_usos integer NOT NULL DEFAULT 0,
  n_exito integer NOT NULL DEFAULT 0,
  tasa_exito numeric NOT NULL DEFAULT 0,
  evidencia jsonb NOT NULL DEFAULT '[]'::jsonb,
  ultima_actualizacion timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (perfil_tipologia, tactica_tipo, tactica_texto)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.call_playbook TO authenticated;
GRANT ALL ON public.call_playbook TO service_role;
GRANT SELECT ON public.call_playbook TO anon;

ALTER TABLE public.call_playbook ENABLE ROW LEVEL SECURITY;

CREATE POLICY "playbook_read_all" ON public.call_playbook
  FOR SELECT USING (true);
CREATE POLICY "playbook_admin_write" ON public.call_playbook
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS idx_playbook_perfil ON public.call_playbook(perfil_tipologia, tasa_exito DESC);
CREATE INDEX IF NOT EXISTS idx_playbook_tipo ON public.call_playbook(tactica_tipo);
