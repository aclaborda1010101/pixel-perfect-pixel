CREATE TABLE public.notas_fuera_universo (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  nota_simple_id UUID REFERENCES public.notas_simples(id) ON DELETE CASCADE,
  hs_deal_id TEXT NOT NULL,
  dealname TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (nota_simple_id, hs_deal_id)
);
CREATE INDEX idx_notas_fuera_universo_deal ON public.notas_fuera_universo(hs_deal_id);
GRANT SELECT ON public.notas_fuera_universo TO authenticated;
GRANT ALL ON public.notas_fuera_universo TO service_role;
ALTER TABLE public.notas_fuera_universo ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Auth read notas_fuera_universo"
  ON public.notas_fuera_universo FOR SELECT TO authenticated USING (true);