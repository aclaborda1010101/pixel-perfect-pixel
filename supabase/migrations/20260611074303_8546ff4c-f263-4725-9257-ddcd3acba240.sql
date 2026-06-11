
CREATE TABLE public.facade_window_ground_truth (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  direccion text NOT NULL,
  human_count integer NOT NULL,
  model_count integer,
  delta integer GENERATED ALWAYS AS (human_count - COALESCE(model_count, human_count)) STORED,
  annotated_image_path text,
  rule_learned text,
  notes text,
  source text NOT NULL DEFAULT 'human_truth',
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.facade_window_ground_truth TO authenticated;
GRANT ALL ON public.facade_window_ground_truth TO service_role;
ALTER TABLE public.facade_window_ground_truth ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can view ground truth" ON public.facade_window_ground_truth FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert ground truth" ON public.facade_window_ground_truth FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update ground truth" ON public.facade_window_ground_truth FOR UPDATE TO authenticated USING (true);
CREATE INDEX facade_gt_building_idx ON public.facade_window_ground_truth(building_id);
