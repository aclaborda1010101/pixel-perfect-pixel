-- =====================================================================
-- WAVE 1A · BASELINE LOCAL PARA BASE DESECHABLE (nunca producción)
-- =====================================================================
-- supabase/migrations/ NO es autosuficiente: asume (a) la plataforma
-- gestionada (roles anon/authenticated/service_role, esquemas auth y
-- storage, extensiones, publicación supabase_realtime) y (b) objetos
-- creados fuera del historial versionado (deriva de baseline). Este
-- fichero reproduce ese estado previo en una base LOCAL desechable para
-- poder reproducir la cadena EXACTA 1A.2 -> 1A.3.
--
-- Es idempotente: el runner lo aplica antes de la cadena y lo reaplica
-- una sola vez si una migración histórica falla por deriva.
-- NUNCA debe ejecutarse contra una base real.
-- =====================================================================
DO $$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: baseline local solo en base desechable wave1a_test_*, base actual = %', current_database();
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

-- =============== DERIVA DE BASELINE (objetos creados fuera de supabase/migrations)
CREATE TABLE IF NOT EXISTS public._fn_backups(
  id uuid primary key default gen_random_uuid(),
  fn_name text, definition text, note text, created_at timestamptz default now());
DO $$ BEGIN IF to_regclass('public.buildings') IS NOT NULL THEN
  ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS comercial text;
  ALTER TABLE public.buildings ADD COLUMN IF NOT EXISTS hs_deal_id text;
END IF; END $$;
DO $$ BEGIN IF to_regclass('public.owners') IS NOT NULL THEN
  ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS fecha_nacimiento date;
  ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS estado_vital text;
  ALTER TABLE public.owners ADD COLUMN IF NOT EXISTS edad_anios integer;
END IF; END $$;
DO $$ BEGIN
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS instance_id uuid;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS aud text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS role text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS confirmation_token text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS recovery_token text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change_token_new text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_change text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_app_meta_data jsonb DEFAULT '{}'::jsonb;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_super_admin boolean;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS phone text;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_sso_user boolean DEFAULT false;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS is_anonymous boolean DEFAULT false;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
  ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
END $$;
-- pg_cron y pg_net son extensiones de la PLATAFORMA gestionada que no
-- existen en un clúster efímero local. Se reproducen como stubs inertes
-- (nunca programan ni llaman a nada) para poder aplicar la cadena EXACTA.
CREATE SCHEMA IF NOT EXISTS cron;
CREATE SCHEMA IF NOT EXISTS net;
CREATE TABLE IF NOT EXISTS cron.job(
  jobid bigserial primary key, schedule text, command text,
  jobname text, active boolean default true);
CREATE OR REPLACE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE OR REPLACE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql AS 'SELECT true';
CREATE OR REPLACE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';
CREATE OR REPLACE FUNCTION cron.schedule(schedule text, command text) RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';
CREATE OR REPLACE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';
CREATE OR REPLACE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}'::jsonb, headers jsonb DEFAULT '{}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
  RETURNS bigint LANGUAGE sql AS 'SELECT 0::bigint';
DO $$
DECLARE cols text; vals text;
BEGIN
  IF to_regclass('public.buildings') IS NULL THEN RETURN; END IF;
  cols := 'id, direccion'; vals := quote_literal('0485d8cf-c1a2-4412-b38f-e37fb18961a2') || '::uuid, ' || quote_literal('BASELINE LOCAL PLACEHOLDER');
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='buildings' AND column_name='ciudad') THEN
    cols := cols || ', ciudad'; vals := vals || ', ' || quote_literal('Madrid');
  END IF;
  EXECUTE format('INSERT INTO public.buildings (%s) VALUES (%s) ON CONFLICT (id) DO NOTHING', cols, vals);
END $$;

CREATE TABLE IF NOT EXISTS public.wa_consent_signals(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  hs_call_id text not null,
  veredicto text not null,
  cita_textual text,
  telefono text,
  confianza numeric,
  fecha_llamada timestamptz,
  detectado_at timestamptz default now(),
  escrito_en_hubspot boolean default false,
  review_status text,
  review_reason text,
  review_updated_at timestamptz);
