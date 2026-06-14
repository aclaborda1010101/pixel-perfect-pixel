
-- ============ ESCALERAS QUEUE ============
CREATE TABLE IF NOT EXISTS public.escaleras_validation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings(id) ON DELETE CASCADE,
  direccion text,
  rc14 text,
  n_escaleras_detectado integer,
  segundas_escaleras boolean,
  evidencia jsonb DEFAULT '{}'::jsonb,
  confianza numeric,
  motivo text,
  estado text NOT NULL DEFAULT 'pendiente',
  detectado_en timestamptz NOT NULL DEFAULT now(),
  validado_por uuid,
  validado_at timestamptz,
  validado_n_escaleras integer,
  validado_resultado boolean
);
CREATE INDEX IF NOT EXISTS idx_escaleras_vq_estado ON public.escaleras_validation_queue(estado);
CREATE INDEX IF NOT EXISTS idx_escaleras_vq_building ON public.escaleras_validation_queue(building_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.escaleras_validation_queue TO authenticated;
GRANT ALL ON public.escaleras_validation_queue TO service_role;
ALTER TABLE public.escaleras_validation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage escaleras queue"
  ON public.escaleras_validation_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "service role escaleras queue"
  ON public.escaleras_validation_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============ ESQUINA QUEUE ============
CREATE TABLE IF NOT EXISTS public.esquina_validation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings(id) ON DELETE CASCADE,
  direccion text,
  rc14 text,
  tipo_anterior text,
  tipo_nuevo text,
  is_corner_anterior boolean,
  is_corner_nuevo boolean,
  n_frentes integer,
  street_names text[],
  confianza numeric,
  nota text,
  estado text NOT NULL DEFAULT 'pendiente',
  detectado_en timestamptz NOT NULL DEFAULT now(),
  validado_por uuid,
  validado_at timestamptz,
  validado_tipo text,
  validado_resultado boolean
);
CREATE INDEX IF NOT EXISTS idx_esquina_vq_estado ON public.esquina_validation_queue(estado);
CREATE INDEX IF NOT EXISTS idx_esquina_vq_building ON public.esquina_validation_queue(building_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.esquina_validation_queue TO authenticated;
GRANT ALL ON public.esquina_validation_queue TO service_role;
ALTER TABLE public.esquina_validation_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage esquina queue"
  ON public.esquina_validation_queue FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "service role esquina queue"
  ON public.esquina_validation_queue FOR ALL TO service_role
  USING (true) WITH CHECK (true);
