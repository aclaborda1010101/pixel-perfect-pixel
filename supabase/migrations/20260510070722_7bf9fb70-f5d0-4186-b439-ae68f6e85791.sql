
ALTER TABLE public.calls
  ADD COLUMN IF NOT EXISTS outcome text,
  ADD COLUMN IF NOT EXISTS sentiment text,
  ADD COLUMN IF NOT EXISTS objeciones text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS tecnica_score numeric,
  ADD COLUMN IF NOT EXISTS preguntas_abiertas int,
  ADD COLUMN IF NOT EXISTS preguntas_cerradas int,
  ADD COLUMN IF NOT EXISTS ratio_comercial_cliente numeric,
  ADD COLUMN IF NOT EXISTS frases_clave_positivas text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS frases_clave_negativas text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS analisis_confianza numeric,
  ADD COLUMN IF NOT EXISTS analyzed_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_outcome_chk') THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_outcome_chk
      CHECK (outcome IS NULL OR outcome IN ('interesado','dudoso','no_interesado','no_contestado','agente_bloqueado','otro'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_sentiment_chk') THEN
    ALTER TABLE public.calls ADD CONSTRAINT calls_sentiment_chk
      CHECK (sentiment IS NULL OR sentiment IN ('positivo','neutro','negativo'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_calls_owner_fecha ON public.calls(owner_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_calls_outcome ON public.calls(outcome);
CREATE INDEX IF NOT EXISTS idx_calls_sentiment ON public.calls(sentiment);
CREATE INDEX IF NOT EXISTS idx_calls_analyzed_at ON public.calls(analyzed_at);

CREATE TABLE IF NOT EXISTS public.coach_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  week_start date NOT NULL,
  week_end date NOT NULL,
  fortalezas jsonb NOT NULL DEFAULT '[]'::jsonb,
  mejoras jsonb NOT NULL DEFAULT '[]'::jsonb,
  frases_ganadoras text[] NOT NULL DEFAULT '{}',
  plan_accion jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_calls int DEFAULT 0,
  metricas jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, week_start)
);

ALTER TABLE public.coach_reports ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coach_reports' AND policyname='preview_all_select') THEN
    CREATE POLICY preview_all_select ON public.coach_reports FOR SELECT USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coach_reports' AND policyname='preview_all_insert') THEN
    CREATE POLICY preview_all_insert ON public.coach_reports FOR INSERT WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coach_reports' AND policyname='preview_all_update') THEN
    CREATE POLICY preview_all_update ON public.coach_reports FOR UPDATE USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='coach_reports' AND policyname='preview_all_delete') THEN
    CREATE POLICY preview_all_delete ON public.coach_reports FOR DELETE USING (true);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_coach_reports_owner_week ON public.coach_reports(owner_id, week_start DESC);
