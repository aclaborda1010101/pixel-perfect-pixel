
-- Índices para acelerar la ficha de edificio y el listado de Edificios.

-- Filtro por comercial en el catálogo (~1140 filas hoy, escala si crece).
CREATE INDEX IF NOT EXISTS idx_buildings_comercial ON public.buildings (comercial);

-- Ficha: consulta de análisis y de company/owner por edificio.
CREATE INDEX IF NOT EXISTS idx_building_analysis_building_id ON public.building_analysis (building_id);
CREATE INDEX IF NOT EXISTS idx_building_companies_building_id ON public.building_companies (building_id);
CREATE INDEX IF NOT EXISTS idx_catastro_authority_rc14 ON public.catastro_authority_cache (refcatastral_14);

-- Historial de llamadas por propietario (usado por briefs y KPIs).
CREATE INDEX IF NOT EXISTS idx_calls_owner_fecha ON public.calls (owner_id, fecha DESC);

-- Overlap arrays de HubSpot (mejora los .overlaps() de notas/whatsapp).
CREATE INDEX IF NOT EXISTS idx_hs_notes_assoc_contacts ON public.hubspot_notes USING GIN (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_whatsapp_assoc_contacts ON public.hubspot_whatsapp USING GIN (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_tasks_assoc_contacts ON public.hubspot_tasks USING GIN (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_calls_assoc_contacts ON public.hubspot_calls USING GIN (associated_contact_ids);
CREATE INDEX IF NOT EXISTS idx_hs_calls_assoc_deals ON public.hubspot_calls USING GIN (associated_deal_ids);
