
-- QA ground truth fixtures from human team classification
CREATE TABLE public.qa_ground_truth (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lista text NOT NULL CHECK (lista IN ('buenos','malos','dos_escaleras')),
  direccion_raw text NOT NULL,
  direccion_norm text NOT NULL,
  deal_id text,
  zona text,
  ano integer,
  m2_tot integer,
  m2_viv integer,
  pct_viv numeric,
  dh boolean,
  escaleras integer,
  n_viv integer,
  m2_per_viv integer,
  propietarios integer,
  tipo text,
  motivo text,
  building_id uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  matched_by text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (lista, direccion_norm)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.qa_ground_truth TO authenticated;
GRANT ALL ON public.qa_ground_truth TO service_role;

ALTER TABLE public.qa_ground_truth ENABLE ROW LEVEL SECURITY;

CREATE POLICY "qa_gt_select_auth" ON public.qa_ground_truth FOR SELECT TO authenticated USING (true);
CREATE POLICY "qa_gt_write_auth" ON public.qa_ground_truth FOR ALL TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE TRIGGER trg_qa_gt_updated BEFORE UPDATE ON public.qa_ground_truth
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_qa_gt_building ON public.qa_ground_truth(building_id);
CREATE INDEX idx_qa_gt_deal ON public.qa_ground_truth(deal_id);
CREATE INDEX idx_qa_gt_dir_norm ON public.qa_ground_truth(direccion_norm);
