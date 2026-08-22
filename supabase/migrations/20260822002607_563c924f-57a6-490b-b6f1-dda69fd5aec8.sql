-- 1) Normalizador de vías y números para comparar direcciones
CREATE OR REPLACE FUNCTION public.norm_via(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(translate(coalesce(p,''),
            'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
            'aaaaaeeeeiiiiooooouuuuncaaaaaeeeeiiiiooooouuuunc')),
          '(^|\s)(calle|c/|cl|c\.|avenida|avda|av|paseo|ps|po|plaza|pl|pza|glorieta|gta|ronda|rda|travesia|camino|carretera|ctra|via)(\s|\.)+', ' ', 'g'),
        '[^a-z0-9 ]', ' ', 'g'),
      '\s+', ' ', 'g')
  , '');
$$;

CREATE OR REPLACE FUNCTION public.norm_via_nombre(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT btrim(regexp_replace(public.norm_via(p), '[0-9].*$', ''));
$$;

CREATE OR REPLACE FUNCTION public.norm_via_numero(p text)
RETURNS integer LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT (regexp_match(public.norm_via(p), '(\d{1,4})'))[1]::int;
$$;

-- 2) Comprobación de direcciones contra Catastro
CREATE TABLE IF NOT EXISTS public.catastro_direccion_audit (
  building_id uuid PRIMARY KEY REFERENCES public.buildings(id) ON DELETE CASCADE,
  refcatastral_14 text,
  direccion_nuestra text,
  direccion_catastro text,
  via_catastro text,
  numero_catastro integer,
  coincide boolean,
  motivo text,
  linderos_sospechosos text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.catastro_direccion_audit TO authenticated;
GRANT ALL ON public.catastro_direccion_audit TO service_role;
ALTER TABLE public.catastro_direccion_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "catastro_direccion_audit_read" ON public.catastro_direccion_audit
  FOR SELECT TO authenticated USING (true);

-- 3) Rastro de traslados de ficha
CREATE TABLE IF NOT EXISTS public.building_relink_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entidad text NOT NULL,
  entidad_id text,
  building_origen uuid,
  building_destino uuid,
  direccion_origen text,
  direccion_destino text,
  motivo text NOT NULL,
  evidencia jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_relink_audit_origen ON public.building_relink_audit(building_origen);
CREATE INDEX IF NOT EXISTS idx_relink_audit_destino ON public.building_relink_audit(building_destino);
GRANT SELECT ON public.building_relink_audit TO authenticated;
GRANT ALL ON public.building_relink_audit TO service_role;
ALTER TABLE public.building_relink_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "building_relink_audit_read" ON public.building_relink_audit
  FOR SELECT TO authenticated USING (true);

-- 4) Duplicados de negocios en el CRM del cliente
CREATE TABLE IF NOT EXISTS public.hubspot_deal_duplicados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direccion_norm text NOT NULL,
  direccion_muestra text,
  hs_deal_ids text[] NOT NULL,
  n_deals integer NOT NULL,
  detalle jsonb NOT NULL DEFAULT '[]'::jsonb,
  detectado_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hs_deal_dup_dir ON public.hubspot_deal_duplicados(direccion_norm);
GRANT SELECT ON public.hubspot_deal_duplicados TO authenticated;
GRANT ALL ON public.hubspot_deal_duplicados TO service_role;
ALTER TABLE public.hubspot_deal_duplicados ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hubspot_deal_duplicados_read" ON public.hubspot_deal_duplicados
  FOR SELECT TO authenticated USING (true);

CREATE TRIGGER trg_catastro_direccion_audit_updated
  BEFORE UPDATE ON public.catastro_direccion_audit
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
