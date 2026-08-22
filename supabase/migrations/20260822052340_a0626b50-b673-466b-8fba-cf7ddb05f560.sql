CREATE TABLE IF NOT EXISTS public.catastro_ref_correcciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  direccion text,
  ref_anterior text,
  ref_nueva text NOT NULL,
  fuente text NOT NULL DEFAULT 'nota_simple',
  aplicada boolean NOT NULL DEFAULT false,
  motivo text,
  colision_building_id uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  evidencia jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.catastro_ref_correcciones TO authenticated;
GRANT ALL ON public.catastro_ref_correcciones TO service_role;

ALTER TABLE public.catastro_ref_correcciones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ref_correcciones_lectura_autenticados"
  ON public.catastro_ref_correcciones FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_catastro_ref_correcciones_building
  ON public.catastro_ref_correcciones(building_id);

CREATE TRIGGER trg_catastro_ref_correcciones_updated_at
  BEFORE UPDATE ON public.catastro_ref_correcciones
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.catastro_direccion_audit
  ADD COLUMN IF NOT EXISTS estado_revision text;