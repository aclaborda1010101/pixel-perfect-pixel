-- ============================================================
-- F.GRAPH.1: índices y vistas SQL para el grafo de relaciones
-- ============================================================

-- nota_simple_titulares
CREATE INDEX IF NOT EXISTS idx_nst_nota_simple_id ON public.nota_simple_titulares(nota_simple_id);
CREATE INDEX IF NOT EXISTS idx_nst_owner_id ON public.nota_simple_titulares(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nst_company_id ON public.nota_simple_titulares(company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nst_rol ON public.nota_simple_titulares(rol);

-- building_owners
CREATE INDEX IF NOT EXISTS idx_bo_building_id ON public.building_owners(building_id);
CREATE INDEX IF NOT EXISTS idx_bo_owner_id ON public.building_owners(owner_id);
CREATE INDEX IF NOT EXISTS idx_bo_subrole ON public.building_owners(subrole);
CREATE INDEX IF NOT EXISTS idx_bo_es_influencer ON public.building_owners(es_influencer) WHERE es_influencer = true;

-- building_companies
CREATE INDEX IF NOT EXISTS idx_bc_building_id ON public.building_companies(building_id);
CREATE INDEX IF NOT EXISTS idx_bc_company_id ON public.building_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_bc_role ON public.building_companies(role);

-- owner_companies
CREATE INDEX IF NOT EXISTS idx_oc_owner_id ON public.owner_companies(owner_id);
CREATE INDEX IF NOT EXISTS idx_oc_company_id ON public.owner_companies(company_id);
CREATE INDEX IF NOT EXISTS idx_oc_role ON public.owner_companies(role);

-- owner_relations
CREATE INDEX IF NOT EXISTS idx_or_a ON public.owner_relations(owner_a_id);
CREATE INDEX IF NOT EXISTS idx_or_b ON public.owner_relations(owner_b_id);
CREATE INDEX IF NOT EXISTS idx_or_type ON public.owner_relations(relation_type);

-- external_ids
CREATE INDEX IF NOT EXISTS idx_eid_entity ON public.external_ids(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_eid_provider ON public.external_ids(provider, provider_id);

-- notas_simples
CREATE INDEX IF NOT EXISTS idx_ns_building_id ON public.notas_simples(building_id) WHERE building_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ns_owner_id ON public.notas_simples(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ns_status ON public.notas_simples(status);

-- calls
CREATE INDEX IF NOT EXISTS idx_calls_owner_id ON public.calls(owner_id) WHERE owner_id IS NOT NULL;

-- next_actions
CREATE INDEX IF NOT EXISTS idx_na_owner_id ON public.next_actions(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_na_asset_id ON public.next_actions(asset_id) WHERE asset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_na_scope ON public.next_actions(scope_type, scope_id);
CREATE INDEX IF NOT EXISTS idx_na_estado ON public.next_actions(estado);

-- ============================================================
-- VISTAS DEL GRAFO
-- ============================================================

DROP VIEW IF EXISTS public.v_owner_graph CASCADE;
CREATE VIEW public.v_owner_graph AS
SELECT
  o.id AS owner_id,
  o.nombre,
  o.rol,
  o.subrole,
  o.email,
  o.telefono,
  COALESCE(b.buildings_count, 0) AS buildings_count,
  COALESCE(c.companies_count, 0) AS companies_count,
  COALESCE(n.notas_count, 0) AS notas_count,
  COALESCE(r.relations_count, 0) AS relations_count,
  COALESCE(ca.calls_count, 0) AS calls_count
FROM public.owners o
LEFT JOIN (
  SELECT owner_id, count(*)::int AS buildings_count
  FROM public.building_owners GROUP BY owner_id
) b ON b.owner_id = o.id
LEFT JOIN (
  SELECT owner_id, count(*)::int AS companies_count
  FROM public.owner_companies GROUP BY owner_id
) c ON c.owner_id = o.id
LEFT JOIN (
  SELECT owner_id, count(*)::int AS notas_count
  FROM public.nota_simple_titulares WHERE owner_id IS NOT NULL GROUP BY owner_id
) n ON n.owner_id = o.id
LEFT JOIN (
  SELECT owner_a_id AS owner_id, count(*)::int AS relations_count
  FROM public.owner_relations GROUP BY owner_a_id
) r ON r.owner_id = o.id
LEFT JOIN (
  SELECT owner_id, count(*)::int AS calls_count
  FROM public.calls WHERE owner_id IS NOT NULL GROUP BY owner_id
) ca ON ca.owner_id = o.id;

DROP VIEW IF EXISTS public.v_building_graph CASCADE;
CREATE VIEW public.v_building_graph AS
SELECT
  b.id AS building_id,
  b.direccion,
  b.ciudad,
  b.estado,
  b.numero_propietarios,
  COALESCE(o.owners_count, 0) AS owners_count,
  COALESCE(co.companies_count, 0) AS companies_count,
  COALESCE(n.notas_count, 0) AS notas_count,
  COALESCE(i.influencers_count, 0) AS influencers_count
FROM public.buildings b
LEFT JOIN (
  SELECT building_id, count(*)::int AS owners_count
  FROM public.building_owners GROUP BY building_id
) o ON o.building_id = b.id
LEFT JOIN (
  SELECT building_id, count(*)::int AS companies_count
  FROM public.building_companies GROUP BY building_id
) co ON co.building_id = b.id
LEFT JOIN (
  SELECT building_id, count(*)::int AS notas_count
  FROM public.notas_simples WHERE building_id IS NOT NULL GROUP BY building_id
) n ON n.building_id = b.id
LEFT JOIN (
  SELECT building_id, count(*)::int AS influencers_count
  FROM public.building_owners WHERE es_influencer = true GROUP BY building_id
) i ON i.building_id = b.id;

DROP VIEW IF EXISTS public.v_company_graph CASCADE;
CREATE VIEW public.v_company_graph AS
SELECT
  c.id AS company_id,
  c.nombre,
  c.cif,
  c.buyer_persona,
  COALESCE(oc.owners_count, 0) AS owners_count,
  COALESCE(bc.buildings_count, 0) AS buildings_count,
  COALESCE(n.notas_count, 0) AS notas_count
FROM public.companies c
LEFT JOIN (
  SELECT company_id, count(*)::int AS owners_count
  FROM public.owner_companies GROUP BY company_id
) oc ON oc.company_id = c.id
LEFT JOIN (
  SELECT company_id, count(*)::int AS buildings_count
  FROM public.building_companies GROUP BY company_id
) bc ON bc.company_id = c.id
LEFT JOIN (
  SELECT company_id, count(*)::int AS notas_count
  FROM public.nota_simple_titulares WHERE company_id IS NOT NULL GROUP BY company_id
) n ON n.company_id = c.id;

-- Permissions
GRANT SELECT ON public.v_owner_graph TO anon, authenticated;
GRANT SELECT ON public.v_building_graph TO anon, authenticated;
GRANT SELECT ON public.v_company_graph TO anon, authenticated;

ANALYZE public.nota_simple_titulares;
ANALYZE public.building_owners;
ANALYZE public.building_companies;
ANALYZE public.owner_companies;
ANALYZE public.owner_relations;