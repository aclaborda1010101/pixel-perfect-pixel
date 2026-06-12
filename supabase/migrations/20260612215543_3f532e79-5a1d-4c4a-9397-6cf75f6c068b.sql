-- Persist PGOUM detection list for human validation + needs_review flag

CREATE TABLE IF NOT EXISTS public.proteccion_validation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  direccion text,
  rc14 text,
  estado text NOT NULL CHECK (estado IN ('hit_pgou','marcado_pero_miss','needs_review_sin_fuente')),
  capa text,
  nivel_proteccion text,
  n_catalogo text,
  nota text,
  detectado_en timestamptz NOT NULL DEFAULT now(),
  validado_por uuid,
  validado_at timestamptz,
  validado_resultado boolean,
  UNIQUE (building_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.proteccion_validation_queue TO authenticated;
GRANT ALL ON public.proteccion_validation_queue TO service_role;

ALTER TABLE public.proteccion_validation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth can read proteccion queue"
  ON public.proteccion_validation_queue FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth can update proteccion queue"
  ON public.proteccion_validation_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "service can insert proteccion queue"
  ON public.proteccion_validation_queue FOR INSERT TO authenticated WITH CHECK (true);