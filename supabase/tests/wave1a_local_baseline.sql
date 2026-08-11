-- =====================================================================
-- WAVE 1A · BASELINE LOCAL PARA BASE DESECHABLE (nunca producción)
-- =====================================================================
-- supabase/migrations/ NO es autosuficiente: asume (a) la plataforma
-- gestionada: roles anon/authenticated/service_role, esquemas auth y
-- storage, extensiones y publicación supabase_realtime. NADA MÁS.
--
-- P0.6: se ha ELIMINADO por completo la antigua deriva de baseline
-- (wave1a_baseline_drift.sql). Aquí no se declaran columnas, tablas,
-- vistas, stubs de cron/net ni filas placeholder: eso era un shim y
-- falseaba la cadena. Este prólogo NO se usa para declarar aplicabilidad
-- de la cadena 1A.2 -> 1A.3.
-- NUNCA debe ejecutarse contra una base real.
-- =====================================================================
DO $$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%'
     AND current_database() NOT LIKE 'smp03\_test\_%'
     AND current_database() NOT LIKE 'v5p03\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: baseline local solo en base desechable wave1a_test_*/smp03_test_*/v5p03_test_*, base actual = %', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS auth.users(
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now());
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $f$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_setting('request.jwt.claim.role', true) $f$;
CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $f$ SELECT current_setting('request.jwt.claim.email', true) $f$;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $f$;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets(id text primary key, name text, public boolean default false, created_at timestamptz default now());
CREATE TABLE IF NOT EXISTS storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- publicación de realtime (la crea la plataforma, no las migraciones)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname='supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS auth.identities(
  id uuid primary key default gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id text,
  provider text,
  identity_data jsonb DEFAULT '{}'::jsonb,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now());
