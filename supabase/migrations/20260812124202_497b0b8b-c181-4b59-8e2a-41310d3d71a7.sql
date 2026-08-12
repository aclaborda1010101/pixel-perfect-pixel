CREATE TABLE IF NOT EXISTS public.backup_reparse168_titulares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titular_id uuid NOT NULL,
  nota_simple_id uuid NOT NULL,
  building_id uuid,
  owner_id uuid,
  company_id uuid,
  nombre_extraido text,
  cif_dni text,
  porcentaje numeric,
  rol text,
  rol_literal text,
  evidencia jsonb,
  metadatos jsonb,
  motivo text NOT NULL DEFAULT 'reparse_168',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.backup_reparse168_titulares TO authenticated;
GRANT ALL ON public.backup_reparse168_titulares TO service_role;

ALTER TABLE public.backup_reparse168_titulares ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "backup_reparse168_admin_select" ON public.backup_reparse168_titulares;
CREATE POLICY "backup_reparse168_admin_select"
  ON public.backup_reparse168_titulares
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_backup_reparse168_nota ON public.backup_reparse168_titulares (nota_simple_id);