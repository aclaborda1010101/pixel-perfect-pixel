CREATE TABLE IF NOT EXISTS public.deals_gemelos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings(id) ON DELETE CASCADE,
  hs_deal_nuestro text,
  hs_deal_gemelo text NOT NULL,
  dealname text,
  notas_recuperadas integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS deals_gemelos_uniq ON public.deals_gemelos (building_id, hs_deal_gemelo);
CREATE INDEX IF NOT EXISTS deals_gemelos_building_idx ON public.deals_gemelos (building_id);

GRANT SELECT ON public.deals_gemelos TO authenticated;
GRANT ALL ON public.deals_gemelos TO service_role;

ALTER TABLE public.deals_gemelos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deals_gemelos_read_auth" ON public.deals_gemelos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "deals_gemelos_service_write" ON public.deals_gemelos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_deals_gemelos_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_deals_gemelos_updated_at
  BEFORE UPDATE ON public.deals_gemelos
  FOR EACH ROW EXECUTE FUNCTION public.touch_deals_gemelos_updated_at();

CREATE OR REPLACE VIEW public.v_contraste_nota_simple AS
WITH mapa AS (
  SELECT b.id AS building_id,
         b.direccion,
         b.grupo_barrio,
         e.provider_id AS hs_deal_id
  FROM public.buildings b
  LEFT JOIN public.external_ids e
    ON e.entity_type = 'building' AND e.provider = 'hubspot' AND e.entity_id = b.id
),
hs AS (
  SELECT m.*,
         d.dealname,
         NULLIF(d.raw->'properties'->>'tenemos_la_nota_simple_', '') AS hs_nota
  FROM mapa m
  LEFT JOIN public.hubspot_deals d ON d.hs_id = m.hs_deal_id
),
tenemos AS (
  SELECT h.*,
         EXISTS (SELECT 1 FROM public.notas_simples n WHERE n.building_id = h.building_id) AS tenemos_nota
  FROM hs h
)
SELECT building_id,
       direccion,
       grupo_barrio,
       hs_deal_id,
       dealname,
       hs_nota,
       tenemos_nota,
       CASE
         WHEN hs_nota = 'Sí' AND NOT tenemos_nota THEN 'hubspot_si_no_tenemos'
         WHEN hs_nota = 'No' AND tenemos_nota THEN 'hubspot_no_si_tenemos'
         WHEN hs_nota IS NULL AND tenemos_nota THEN 'sin_dato_hubspot_tenemos'
         WHEN hs_nota IS NULL AND NOT tenemos_nota THEN 'sin_dato_hubspot_sin_nota'
         ELSE 'coherente'
       END AS discrepancia
FROM tenemos;

GRANT SELECT ON public.v_contraste_nota_simple TO authenticated;