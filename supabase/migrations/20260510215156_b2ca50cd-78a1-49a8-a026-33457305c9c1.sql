-- Enums
DO $$ BEGIN
  CREATE TYPE public.building_company_role AS ENUM ('titular','usufructuario','banco_acreedor','arrendador','otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.owner_relation_type AS ENUM ('heredero_de','conyuge_de','representante_de','apoderado_de','padre_de','socio_de');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.owner_company_role AS ENUM ('socio','administrador','apoderado','empleado','titular_via_sociedad');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.nota_titular_rol AS ENUM ('pleno','usufructo','nuda_propiedad','otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- building_companies
CREATE TABLE IF NOT EXISTS public.building_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role public.building_company_role NOT NULL DEFAULT 'otro',
  percentage numeric,
  fecha_inicio date,
  fecha_fin date,
  source text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (building_id, company_id, role)
);
CREATE INDEX IF NOT EXISTS idx_bc_building ON public.building_companies(building_id);
CREATE INDEX IF NOT EXISTS idx_bc_company  ON public.building_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_bc_role     ON public.building_companies(role);
CREATE TRIGGER trg_bc_updated_at BEFORE UPDATE ON public.building_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.building_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY preview_all_select ON public.building_companies FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.building_companies FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.building_companies FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.building_companies FOR DELETE USING (true);

-- owner_relations
CREATE TABLE IF NOT EXISTS public.owner_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_a_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  owner_b_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  relation_type public.owner_relation_type NOT NULL,
  percentage numeric,
  notes text,
  source text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_relations_distinct CHECK (owner_a_id <> owner_b_id),
  UNIQUE (owner_a_id, owner_b_id, relation_type)
);
CREATE INDEX IF NOT EXISTS idx_or_a    ON public.owner_relations(owner_a_id);
CREATE INDEX IF NOT EXISTS idx_or_b    ON public.owner_relations(owner_b_id);
CREATE INDEX IF NOT EXISTS idx_or_type ON public.owner_relations(relation_type);
CREATE TRIGGER trg_or_updated_at BEFORE UPDATE ON public.owner_relations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.owner_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY preview_all_select ON public.owner_relations FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.owner_relations FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.owner_relations FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.owner_relations FOR DELETE USING (true);

-- owner_companies
CREATE TABLE IF NOT EXISTS public.owner_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  role public.owner_company_role NOT NULL,
  percentage numeric,
  source text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, company_id, role)
);
CREATE INDEX IF NOT EXISTS idx_oc_owner   ON public.owner_companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_oc_company ON public.owner_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_oc_role    ON public.owner_companies(role);
CREATE TRIGGER trg_oc_updated_at BEFORE UPDATE ON public.owner_companies
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.owner_companies ENABLE ROW LEVEL SECURITY;
CREATE POLICY preview_all_select ON public.owner_companies FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.owner_companies FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.owner_companies FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.owner_companies FOR DELETE USING (true);

-- nota_simple_titulares
CREATE TABLE IF NOT EXISTS public.nota_simple_titulares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_simple_id uuid NOT NULL REFERENCES public.notas_simples(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  nombre_extraido text,
  cif_dni text,
  porcentaje numeric,
  rol public.nota_titular_rol NOT NULL DEFAULT 'pleno',
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nst_nota    ON public.nota_simple_titulares(nota_simple_id);
CREATE INDEX IF NOT EXISTS idx_nst_owner   ON public.nota_simple_titulares(owner_id);
CREATE INDEX IF NOT EXISTS idx_nst_company ON public.nota_simple_titulares(company_id);
CREATE INDEX IF NOT EXISTS idx_nst_cif     ON public.nota_simple_titulares(cif_dni);
CREATE TRIGGER trg_nst_updated_at BEFORE UPDATE ON public.nota_simple_titulares
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
ALTER TABLE public.nota_simple_titulares ENABLE ROW LEVEL SECURITY;
CREATE POLICY preview_all_select ON public.nota_simple_titulares FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.nota_simple_titulares FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.nota_simple_titulares FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.nota_simple_titulares FOR DELETE USING (true);