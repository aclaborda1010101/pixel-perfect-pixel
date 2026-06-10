
ALTER TABLE public.building_feedback ADD COLUMN IF NOT EXISTS metadatos jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS es_esquina boolean;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS ventanas_fachada integer;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS ventanas_patio integer;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS cluster_label text;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS protegido boolean;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS verificado_por text;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS verificado_at timestamptz;
ALTER TABLE public.qa_ground_truth ADD COLUMN IF NOT EXISTS fuente_verificacion text;
