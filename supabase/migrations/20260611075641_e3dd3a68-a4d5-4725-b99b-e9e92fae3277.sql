CREATE TABLE public.escaleras_control_set (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_name text NOT NULL,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  gt integer NOT NULL,
  seed text NOT NULL,
  rank integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_name, building_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escaleras_control_set TO authenticated;
GRANT ALL ON public.escaleras_control_set TO service_role;
ALTER TABLE public.escaleras_control_set ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read control set" ON public.escaleras_control_set FOR SELECT TO authenticated USING (true);
CREATE POLICY "service write control set" ON public.escaleras_control_set FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.escaleras_eval_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  set_name text NOT NULL,
  version text NOT NULL,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  gt integer NOT NULL,
  pred_n integer,
  pred_segundas boolean,
  needs_review boolean NOT NULL DEFAULT false,
  confidence numeric,
  evidencia jsonb,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (set_name, version, building_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.escaleras_eval_results TO authenticated;
GRANT ALL ON public.escaleras_eval_results TO service_role;
ALTER TABLE public.escaleras_eval_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth read eval results" ON public.escaleras_eval_results FOR SELECT TO authenticated USING (true);
CREATE POLICY "service write eval results" ON public.escaleras_eval_results FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX idx_eval_results_set_version ON public.escaleras_eval_results(set_name, version);