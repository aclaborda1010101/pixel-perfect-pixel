CREATE TABLE IF NOT EXISTS public._a1_dangling_review (
  hs_deal text PRIMARY KEY,
  dealname text,
  address text,
  candidato uuid REFERENCES public.buildings(id) ON DELETE SET NULL,
  motivo text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public._a1_dangling_review TO service_role;
ALTER TABLE public._a1_dangling_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY "_a1_dangling_review_admin_read" ON public._a1_dangling_review
  FOR SELECT USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "_a1_dangling_review_service_all" ON public._a1_dangling_review
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_a1_dangling_review_candidato ON public._a1_dangling_review(candidato);
