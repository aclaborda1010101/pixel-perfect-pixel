
CREATE TABLE IF NOT EXISTS public.building_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  autor_id uuid,
  autor_email text,
  canal text NOT NULL CHECK (canal IN ('voz','texto')),
  texto text,
  audio_url text,
  dimension text,
  estado text NOT NULL DEFAULT 'nueva' CHECK (estado IN ('nueva','analizada','aplicada','descartada','requiere_codigo')),
  analisis_ia jsonb,
  override_aplicado jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS building_feedback_building_idx ON public.building_feedback(building_id, created_at DESC);
CREATE INDEX IF NOT EXISTS building_feedback_estado_idx ON public.building_feedback(estado);

GRANT SELECT, INSERT, UPDATE ON public.building_feedback TO authenticated;
GRANT ALL ON public.building_feedback TO service_role;

ALTER TABLE public.building_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth read feedback" ON public.building_feedback FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth insert feedback" ON public.building_feedback FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "auth update feedback" ON public.building_feedback FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.building_feedback_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER building_feedback_touch_trg
BEFORE UPDATE ON public.building_feedback
FOR EACH ROW EXECUTE FUNCTION public.building_feedback_touch();

CREATE OR REPLACE FUNCTION public.building_feedback_to_qa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'aplicada' AND (OLD.estado IS DISTINCT FROM 'aplicada') THEN
    BEGIN
      INSERT INTO public.scoring_v2_feedback (building_id, dimension, expected, actual, source, notes, created_at)
      VALUES (
        NEW.building_id,
        COALESCE(NEW.dimension,'otro'),
        COALESCE(NEW.override_aplicado, NEW.analisis_ia),
        NULL,
        'team_feedback',
        NEW.texto,
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      -- Si la tabla destino tiene otra forma, ignoramos para no bloquear el override
      NULL;
    END;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER building_feedback_to_qa_trg
AFTER UPDATE ON public.building_feedback
FOR EACH ROW EXECUTE FUNCTION public.building_feedback_to_qa();
