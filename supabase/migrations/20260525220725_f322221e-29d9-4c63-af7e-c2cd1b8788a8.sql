
ALTER TABLE public.building_analysis
  ADD COLUMN IF NOT EXISTS densidad_ventanas_fachada numeric,
  ADD COLUMN IF NOT EXISTS fachada_lineal_total_m numeric,
  ADD COLUMN IF NOT EXISTS ventanas_patios_estimadas integer,
  ADD COLUMN IF NOT EXISTS ventanas_patios_desglose jsonb,
  ADD COLUMN IF NOT EXISTS formula_ventanas_patio text,
  ADD COLUMN IF NOT EXISTS confidence_ventanas numeric,
  ADD COLUMN IF NOT EXISTS aviso_ventanas text;

ALTER TABLE public.scoring_v2_feedback
  ADD COLUMN IF NOT EXISTS user_id uuid,
  ADD COLUMN IF NOT EXISTS tipo text,
  ADD COLUMN IF NOT EXISTS valor text,
  ADD COLUMN IF NOT EXISTS comentario text,
  ADD COLUMN IF NOT EXISTS payload jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.scoring_v2_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_select_own_or_admin" ON public.scoring_v2_feedback;
CREATE POLICY "feedback_select_own_or_admin" ON public.scoring_v2_feedback
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR user_id IS NULL OR has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "feedback_insert_auth" ON public.scoring_v2_feedback;
CREATE POLICY "feedback_insert_auth" ON public.scoring_v2_feedback
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

DROP POLICY IF EXISTS "feedback_admin_all" ON public.scoring_v2_feedback;
CREATE POLICY "feedback_admin_all" ON public.scoring_v2_feedback
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS idx_scoring_v2_feedback_building ON public.scoring_v2_feedback(building_id);
