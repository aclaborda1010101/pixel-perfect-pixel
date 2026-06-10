
-- ============ enrichment_jobs ============
CREATE TABLE public.enrichment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings(id) ON DELETE CASCADE,
  nota_simple_id uuid REFERENCES public.notas_simples(id) ON DELETE SET NULL,
  titular_nombre text NOT NULL,
  titular_apellido1 text,
  titular_apellido2 text,
  titular_tipo text NOT NULL CHECK (titular_tipo IN ('persona','empresa')),
  titular_nif text,
  titular_pct numeric,
  fase text NOT NULL CHECK (fase IN ('datoscif','inglobaly','tecnofind','verificacion','hubspot')),
  estado text NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente','en_curso','esperando_navegador','requiere_revision','requiere_humano','ok','error','descartado')),
  datos jsonb NOT NULL DEFAULT '{}'::jsonb,
  intentos int NOT NULL DEFAULT 0,
  max_intentos int NOT NULL DEFAULT 3,
  next_attempt_at timestamptz DEFAULT now(),
  error text,
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_enrichment_jobs_queue ON public.enrichment_jobs (estado, fase, next_attempt_at);
CREATE INDEX idx_enrichment_jobs_building ON public.enrichment_jobs (building_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.enrichment_jobs TO authenticated;
GRANT ALL ON public.enrichment_jobs TO service_role;

ALTER TABLE public.enrichment_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_enrichment_jobs"
  ON public.enrichment_jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_enrichment_jobs"
  ON public.enrichment_jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_enrichment_jobs"
  ON public.enrichment_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "admin_delete_enrichment_jobs"
  ON public.enrichment_jobs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_enrichment_jobs_updated_at
  BEFORE UPDATE ON public.enrichment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ enrichment_config (singleton) ============
CREATE TABLE public.enrichment_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reglas jsonb NOT NULL DEFAULT '{}'::jsonb,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.enrichment_config TO authenticated;
GRANT ALL ON public.enrichment_config TO service_role;

ALTER TABLE public.enrichment_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_enrichment_config"
  ON public.enrichment_config FOR SELECT TO authenticated USING (true);
CREATE POLICY "admin_write_enrichment_config"
  ON public.enrichment_config FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_enrichment_config_updated_at
  BEFORE UPDATE ON public.enrichment_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.enrichment_config (reglas, parametros) VALUES (
  jsonb_build_object(
    'co_domicilio_sin_confirmar','T8',
    'apoderado_con_control','T3',
    'fallecido','T10',
    'default','T9'
  ),
  jsonb_build_object(
    'timeout_paso_ms', 15000,
    'timeout_job_ms', 90000,
    'max_intentos', 3,
    'backoff_seg', jsonb_build_array(60, 300, 1800),
    'inglobaly_busqueda', 'exact'
  )
);

-- ============ enrichment_verifications ============
CREATE TABLE public.enrichment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.enrichment_jobs(id) ON DELETE CASCADE,
  propuesta jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL DEFAULT 'pendiente'
    CHECK (decision IN ('pendiente','aprobada','rechazada')),
  aprobado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  aprobado_at timestamptz,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_enrichment_verifications_job ON public.enrichment_verifications (job_id);

GRANT SELECT, INSERT, UPDATE ON public.enrichment_verifications TO authenticated;
GRANT ALL ON public.enrichment_verifications TO service_role;

ALTER TABLE public.enrichment_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_read_enrichment_verifications"
  ON public.enrichment_verifications FOR SELECT TO authenticated USING (true);
CREATE POLICY "authenticated_write_enrichment_verifications"
  ON public.enrichment_verifications FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "authenticated_update_enrichment_verifications"
  ON public.enrichment_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE TRIGGER trg_enrichment_verifications_updated_at
  BEFORE UPDATE ON public.enrichment_verifications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
