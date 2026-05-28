
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE public.catastro_authority_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  refcatastral_14 text NOT NULL UNIQUE,
  refcatastral_20 text,
  direccion_oficial text,
  lat double precision,
  lon double precision,
  numero_plantas integer,
  plantas jsonb NOT NULL DEFAULT '[]'::jsonb,
  viviendas_total integer,
  locales_total integer,
  garajes_total integer,
  ano_construccion integer,
  superficie_parcela_m2 numeric,
  usos jsonb,
  confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.catastro_authority_cache TO authenticated;
GRANT ALL ON public.catastro_authority_cache TO service_role;

ALTER TABLE public.catastro_authority_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authority_cache_select_auth"
  ON public.catastro_authority_cache FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "authority_cache_write_auth"
  ON public.catastro_authority_cache FOR ALL
  TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX idx_catastro_authority_cache_ref20 ON public.catastro_authority_cache (refcatastral_20);

CREATE TRIGGER trg_catastro_authority_cache_updated_at
BEFORE UPDATE ON public.catastro_authority_cache
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
