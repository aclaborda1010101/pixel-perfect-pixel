-- Habilitar trigram para búsquedas ILIKE rápidas
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- =========================================================
-- OWNERS (10.076 filas) — filtros: rol, subrole, buyer_persona, fechas
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_owners_rol            ON public.owners (rol);
CREATE INDEX IF NOT EXISTS idx_owners_subrole        ON public.owners (subrole);
CREATE INDEX IF NOT EXISTS idx_owners_buyer_persona  ON public.owners (buyer_persona);
CREATE INDEX IF NOT EXISTS idx_owners_updated_at     ON public.owners (updated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_owners_created_at     ON public.owners (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_owners_last_synced_at ON public.owners (last_synced_at DESC NULLS LAST);
-- Búsqueda fulltext (ILIKE) trigram
CREATE INDEX IF NOT EXISTS idx_owners_nombre_trgm    ON public.owners USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_owners_email_trgm     ON public.owners USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_owners_telefono_trgm  ON public.owners USING gin (telefono gin_trgm_ops);
-- Filtros JSONB usados por /inversores (tipo_de_inversor, distrito_zona)
CREATE INDEX IF NOT EXISTS idx_owners_metadatos_gin  ON public.owners USING gin (metadatos);

-- =========================================================
-- BUILDINGS (7.695)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_buildings_estado          ON public.buildings (estado);
CREATE INDEX IF NOT EXISTS idx_buildings_updated_at      ON public.buildings (updated_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_buildings_created_at      ON public.buildings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_buildings_last_synced_at  ON public.buildings (last_synced_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_buildings_direccion_trgm  ON public.buildings USING gin (direccion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buildings_ciudad_trgm     ON public.buildings USING gin (ciudad gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buildings_cp_trgm         ON public.buildings USING gin (codigo_postal gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_buildings_catastro_trgm   ON public.buildings USING gin (catastro_ref gin_trgm_ops);

-- =========================================================
-- ASSETS
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_assets_estado            ON public.assets (estado);
CREATE INDEX IF NOT EXISTS idx_assets_tipo              ON public.assets (tipo);
CREATE INDEX IF NOT EXISTS idx_assets_valoracion        ON public.assets (valoracion_estimada DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_assets_created_at        ON public.assets (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assets_building_id       ON public.assets (building_id);
CREATE INDEX IF NOT EXISTS idx_assets_owner_id          ON public.assets (owner_id);
CREATE INDEX IF NOT EXISTS idx_assets_ubicacion_trgm    ON public.assets USING gin (ubicacion gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_assets_ciudad_trgm       ON public.assets USING gin (ciudad gin_trgm_ops);

-- =========================================================
-- CALLS (3.879) — filtros: sentiment, outcome, fecha, owner, analizada
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_calls_sentiment        ON public.calls (sentiment);
CREATE INDEX IF NOT EXISTS idx_calls_outcome          ON public.calls (outcome);
CREATE INDEX IF NOT EXISTS idx_calls_fecha            ON public.calls (fecha DESC);
CREATE INDEX IF NOT EXISTS idx_calls_owner_id         ON public.calls (owner_id);
CREATE INDEX IF NOT EXISTS idx_calls_created_at       ON public.calls (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_analyzed_at      ON public.calls (analyzed_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_calls_comercial_hs_id  ON public.calls (comercial_hs_id);
-- Resumen vacío / nulo (KPI dashboard "pendingAnalysis")
CREATE INDEX IF NOT EXISTS idx_calls_resumen_null     ON public.calls (id) WHERE resumen IS NULL;
CREATE INDEX IF NOT EXISTS idx_calls_resumen_trgm     ON public.calls USING gin (resumen gin_trgm_ops);

-- =========================================================
-- COMPANIES (2.198)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_companies_buyer_persona ON public.companies (buyer_persona);
CREATE INDEX IF NOT EXISTS idx_companies_last_synced   ON public.companies (last_synced_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_companies_created_at    ON public.companies (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_companies_nombre_trgm   ON public.companies USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_email_trgm    ON public.companies USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_companies_cif_trgm      ON public.companies USING gin (cif gin_trgm_ops);

-- =========================================================
-- NEXT_ACTIONS (526)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_next_actions_estado       ON public.next_actions (estado);
CREATE INDEX IF NOT EXISTS idx_next_actions_origen       ON public.next_actions (origen);
CREATE INDEX IF NOT EXISTS idx_next_actions_owner_id     ON public.next_actions (owner_id);
CREATE INDEX IF NOT EXISTS idx_next_actions_vencimiento  ON public.next_actions (vencimiento);
CREATE INDEX IF NOT EXISTS idx_next_actions_created_at   ON public.next_actions (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_next_actions_titulo_trgm  ON public.next_actions USING gin (titulo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_next_actions_detalle_trgm ON public.next_actions USING gin (detalle gin_trgm_ops);

-- =========================================================
-- WHATSAPP_MESSAGES
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_wa_status          ON public.whatsapp_messages (status);
CREATE INDEX IF NOT EXISTS idx_wa_direccion       ON public.whatsapp_messages (direccion);
CREATE INDEX IF NOT EXISTS idx_wa_owner_id        ON public.whatsapp_messages (owner_id);
CREATE INDEX IF NOT EXISTS idx_wa_building_id     ON public.whatsapp_messages (building_id);
CREATE INDEX IF NOT EXISTS idx_wa_created_at      ON public.whatsapp_messages (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_programado_para ON public.whatsapp_messages (programado_para);

-- =========================================================
-- NOTAS_SIMPLES (1.561)
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_notas_simples_status      ON public.notas_simples (status);
CREATE INDEX IF NOT EXISTS idx_notas_simples_riesgo      ON public.notas_simples (riesgo);
CREATE INDEX IF NOT EXISTS idx_notas_simples_created_at  ON public.notas_simples (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notas_simples_building_id ON public.notas_simples (building_id);
CREATE INDEX IF NOT EXISTS idx_notas_simples_owner_id    ON public.notas_simples (owner_id);

-- =========================================================
-- HUBSPOT MIRROR TABLES
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_hs_calls_hs_timestamp    ON public.hubspot_calls (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hs_calls_hs_lastmod      ON public.hubspot_calls (hs_lastmodifieddate DESC);
CREATE INDEX IF NOT EXISTS idx_hs_calls_hs_owner_id     ON public.hubspot_calls (hs_owner_id);

CREATE INDEX IF NOT EXISTS idx_hs_notes_hs_timestamp    ON public.hubspot_notes (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hs_notes_hs_lastmod      ON public.hubspot_notes (hs_lastmodifieddate DESC);

CREATE INDEX IF NOT EXISTS idx_hs_tasks_hs_timestamp    ON public.hubspot_tasks (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hs_tasks_hs_lastmod      ON public.hubspot_tasks (hs_lastmodifieddate DESC);
CREATE INDEX IF NOT EXISTS idx_hs_tasks_status          ON public.hubspot_tasks (hs_task_status);

CREATE INDEX IF NOT EXISTS idx_hs_comms_hs_timestamp    ON public.hubspot_communications (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hs_comms_hs_lastmod      ON public.hubspot_communications (hs_lastmodifieddate DESC);
CREATE INDEX IF NOT EXISTS idx_hs_comms_channel         ON public.hubspot_communications (hs_communication_channel_type);

CREATE INDEX IF NOT EXISTS idx_hs_wa_hs_timestamp       ON public.hubspot_whatsapp (hs_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_hs_wa_hs_lastmod         ON public.hubspot_whatsapp (hs_lastmodifieddate DESC);

CREATE INDEX IF NOT EXISTS idx_hs_owners_archived       ON public.hubspot_owners (archived);
CREATE INDEX IF NOT EXISTS idx_hs_owners_synced_at      ON public.hubspot_owners (synced_at DESC);

-- =========================================================
-- MATCH_CANDIDATES & KNOWLEDGE_CHUNKS
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_match_estado        ON public.match_candidates (estado);
CREATE INDEX IF NOT EXISTS idx_match_asset_id      ON public.match_candidates (asset_id);
CREATE INDEX IF NOT EXISTS idx_match_investor_id   ON public.match_candidates (investor_id);
CREATE INDEX IF NOT EXISTS idx_match_score         ON public.match_candidates (score DESC);

CREATE INDEX IF NOT EXISTS idx_kc_scope_type       ON public.knowledge_chunks (scope_type);
CREATE INDEX IF NOT EXISTS idx_kc_scope_id         ON public.knowledge_chunks (scope_id);
CREATE INDEX IF NOT EXISTS idx_kc_origen           ON public.knowledge_chunks (origen);

-- =========================================================
-- ANALYZE para que el planner use los nuevos índices ya
-- =========================================================
ANALYZE public.owners;
ANALYZE public.buildings;
ANALYZE public.assets;
ANALYZE public.calls;
ANALYZE public.companies;
ANALYZE public.next_actions;
ANALYZE public.whatsapp_messages;
ANALYZE public.notas_simples;
ANALYZE public.hubspot_calls;
ANALYZE public.hubspot_notes;
ANALYZE public.hubspot_tasks;
ANALYZE public.hubspot_communications;
ANALYZE public.hubspot_whatsapp;
ANALYZE public.hubspot_owners;
ANALYZE public.match_candidates;
ANALYZE public.knowledge_chunks;