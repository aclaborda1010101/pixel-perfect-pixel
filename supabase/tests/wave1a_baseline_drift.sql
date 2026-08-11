-- =====================================================================
-- WAVE 1A · DERIVA DE BASELINE (objetos creados FUERA de supabase/migrations)
-- =====================================================================
-- Estos objetos existen en la base gestionada pero no los crea ninguna
-- migración versionada. Son IDEMPOTENTES y CONDICIONALES: cada bloque sólo
-- actúa si la tabla destino ya existe. El generador del snapshot los aplica
-- ANTES DE CADA migración del corte para que la deriva esté disponible en el
-- momento exacto en que la cadena la necesita (una tabla creada por la
-- migración N puede necesitar la deriva en la migración N+1).
-- NUNCA debe ejecutarse contra una base real.
-- =====================================================================
SET client_min_messages = warning;

DO $driftguard$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%'
     AND current_database() NOT LIKE 'smp03\_test\_%'
     AND current_database() NOT LIKE 'v5p03\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: deriva de baseline solo en base desechable, base actual = %', current_database();
  END IF;
END $driftguard$;

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


-- DERIVA: public.building_overrides (creada fuera de supabase/migrations;
-- la usa la definición real de v_building_score).
CREATE TABLE IF NOT EXISTS public.building_overrides(
  id uuid primary key default gen_random_uuid(),
  building_id uuid not null,
  dimension text not null,
  valor_num numeric,
  valor_bool boolean,
  valor_text text,
  fuente text default 'building_feedback'::text,
  nota text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  UNIQUE (building_id, dimension));

-- ---------------------------------------------------------------------
-- DERIVA: public.v_building_score
-- ---------------------------------------------------------------------
-- La definición REAL de esta vista (con score_raw / b_score_total) se creó
-- fuera de supabase/migrations. La migración 20260805051330 la parchea por
-- texto y falla si no encuentra la expresión, así que la deriva debe
-- instalar la definición real PREVIA al parche. Se aplica UNA SOLA VEZ
-- (marca en public._wave1a_drift_marks) y sólo mientras la vista sigue
-- siendo la versionada, para no deshacer el parche después.
-- El cuerpo es el pg_get_viewdef real de la base gestionada con el parche
-- de 20260805051330 revertido: aplicar esa migración lo devuelve, carácter
-- a carácter, a la definición real vigente.
CREATE TABLE IF NOT EXISTS public._wave1a_drift_marks(mark text primary key, applied_at timestamptz default now());

CREATE OR REPLACE FUNCTION public._wave1a_replace_view(p_view text, p_def text) RETURNS void
LANGUAGE plpgsql AS $rv$
DECLARE
  v_deps text[] := '{}';
  v_defs text[] := '{}';
  r record;
BEGIN
  -- Vistas dependientes (transitivas), en orden de creación, para poder
  -- recrearlas tras el DROP ... CASCADE. Nada se pierde.
  FOR r IN
    WITH RECURSIVE d(oid) AS (
      SELECT c.oid FROM pg_class c WHERE c.oid = p_view::regclass
      UNION
      SELECT rw.ev_class FROM pg_depend dep
        JOIN pg_rewrite rw ON rw.oid = dep.objid
        JOIN d ON d.oid = dep.refobjid
       WHERE dep.classid = 'pg_rewrite'::regclass AND rw.ev_class <> d.oid
    )
    SELECT c.oid, (n.nspname||'.'||quote_ident(c.relname)) AS nombre,
           pg_get_viewdef(c.oid, true) AS def
      FROM d JOIN pg_class c ON c.oid = d.oid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relkind IN ('v','m') AND c.oid <> p_view::regclass
     ORDER BY c.oid
  LOOP
    v_deps := v_deps || r.nombre; v_defs := v_defs || r.def;
  END LOOP;

  EXECUTE format('DROP VIEW %s CASCADE', p_view);
  EXECUTE format('CREATE VIEW %s AS %s', p_view, p_def);
  FOR i IN 1 .. coalesce(array_length(v_deps,1),0) LOOP
    EXECUTE format('CREATE OR REPLACE VIEW %s AS %s', v_deps[i], v_defs[i]);
  END LOOP;
END $rv$;

DO $vbs$
DECLARE v text;
BEGIN
  IF to_regclass('public.v_building_score') IS NULL THEN RETURN; END IF;
  -- Sin marca de "una sola vez": si una migración versionada vuelve a
  -- plantar la definición legacy, la deriva REAL se reafirma, que es
  -- exactamente lo que ocurre en la base gestionada.
  v := pg_get_viewdef('public.v_building_score'::regclass, true);
  -- 'b_score_total' sólo aparece en la definición REAL (antes o después
  -- del parche de 20260805051330). Si está, no se toca; si no está, la
  -- vista es la legacy versionada y hay que reafirmar la deriva real.
  IF position('b_score_total' in v) > 0 THEN RETURN; END IF;
  -- Se difiere mientras la definición real dependa de funciones que la
  -- cadena aún no ha creado: se reintenta antes de la siguiente migración.
  -- No es un error tragado: si nunca llega a instalarse, la migración
  -- 20260805051330 falla y el generador termina NO_VERIFICADO.
  BEGIN
  PERFORM public._wave1a_replace_view('public.v_building_score', $vbsdef$
 WITH own_counts AS (
         SELECT bo.building_id,
            count(DISTINCT COALESCE(NULLIF(normalize_person_name(o.nombre), ''::text), NULLIF(upper(o.metadatos ->> 'nif'::text), ''::text), NULLIF(upper(o.metadatos ->> 'dni'::text), ''::text), NULLIF(lower(o.email), ''::text), o.id::text)) AS n
           FROM building_owners bo
             JOIN owners o ON o.id = bo.owner_id
          WHERE COALESCE(bo.rol_notas, ''::text) !~~* '%representante%'::text AND COALESCE(bo.rol_notas, ''::text) !~~* '%apoderado%'::text
          GROUP BY bo.building_id
        ), comp_counts AS (
         SELECT bc.building_id,
            count(DISTINCT bc.company_id) AS n
           FROM building_companies bc
          WHERE COALESCE(bc.role::text, ''::text) = ANY (ARRAY['titular'::text, 'usufructuario'::text, 'arrendador'::text, 'otro'::text])
          GROUP BY bc.building_id
        ), ov AS (
         SELECT building_overrides.building_id,
            building_overrides.valor_num::integer AS n
           FROM building_overrides
          WHERE building_overrides.dimension = 'propietarios'::text AND building_overrides.valor_num IS NOT NULL
        ), agg AS (
         SELECT b.id,
            b.direccion,
            b.ciudad,
            b.division_horizontal,
            b.metadatos AS md,
            b.numero_propietarios,
            b.score_activo AS b_score_activo,
            b.score_propietarios AS b_score_propietarios,
            b.score_total AS b_score_total,
            NULLIF(b.metadatos ->> 'metros_cuadrados__exactos_'::text, ''::text)::numeric AS m2_exactos,
            NULLIF(b.metadatos ->> 'metros_cuadrados__rango_'::text, ''::text) AS m2_rango,
            COALESCE(NULLIF(b.metadatos ->> 'viviendas__unidades___clonada_'::text, ''::text)::integer, NULLIF(b.metadatos ->> 'viviendas__unidades_'::text, ''::text)::integer, NULLIF(b.metadatos ->> 'num_viviendas'::text, ''::text)::integer) AS viviendas_unidades,
            COALESCE(ov.n::bigint, COALESCE(oc.n, 0::bigint) + COALESCE(cc.n, 0::bigint))::integer AS owners_count
           FROM buildings b
             LEFT JOIN own_counts oc ON oc.building_id = b.id
             LEFT JOIN comp_counts cc ON cc.building_id = b.id
             LEFT JOIN ov ON ov.building_id = b.id
        ), scored AS (
         SELECT agg.id,
            agg.direccion,
            agg.ciudad,
            agg.division_horizontal,
            agg.md,
            agg.numero_propietarios,
            agg.b_score_activo,
            agg.b_score_propietarios,
            agg.b_score_total,
            agg.m2_exactos,
            agg.m2_rango,
            agg.viviendas_unidades,
            agg.owners_count,
            agg.m2_exactos AS m2_total,
            agg.viviendas_unidades AS num_viviendas,
            NULLIF(agg.md ->> 'metros_cuadrados_comercio'::text, ''::text)::numeric AS m2_comercio_x,
            COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_oficina'::text, ''::text), NULLIF(agg.md ->> 'metros_cuadrado_oficina'::text, ''::text))::numeric AS m2_oficina_x,
            NULLIF(agg.md ->> 'metros_cuadrados_almacen'::text, ''::text)::numeric AS m2_almacen_x,
            NULLIF(agg.md ->> 'metros_cuadrados_industrial'::text, ''::text)::numeric AS m2_industrial_x,
                CASE
                    WHEN agg.m2_exactos IS NOT NULL AND (agg.m2_exactos - COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_comercio'::text, ''::text)::numeric, 0::numeric) - COALESCE(COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_oficina'::text, ''::text), NULLIF(agg.md ->> 'metros_cuadrado_oficina'::text, ''::text))::numeric, 0::numeric) - COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_almacen'::text, ''::text)::numeric, 0::numeric) - COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_industrial'::text, ''::text)::numeric, 0::numeric)) > 0::numeric THEN agg.m2_exactos - COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_comercio'::text, ''::text)::numeric, 0::numeric) - COALESCE(COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_oficina'::text, ''::text), NULLIF(agg.md ->> 'metros_cuadrado_oficina'::text, ''::text))::numeric, 0::numeric) - COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_almacen'::text, ''::text)::numeric, 0::numeric) - COALESCE(NULLIF(agg.md ->> 'metros_cuadrados_industrial'::text, ''::text)::numeric, 0::numeric)
                    ELSE agg.m2_exactos
                END AS m2_vivienda_calc,
            LEAST(1.0, COALESCE(agg.viviendas_unidades, 0)::numeric / 40.0) AS s_viviendas,
            LEAST(1.0, COALESCE(agg.m2_exactos, 0::numeric) / 4000.0) AS s_m2,
                CASE
                    WHEN agg.division_horizontal IS FALSE THEN 1.0
                    ELSE 0::numeric
                END AS s_no_dh,
                CASE
                    WHEN agg.owners_count >= 10 THEN 1.00
                    WHEN agg.owners_count >= 7 THEN 0.90
                    WHEN agg.owners_count >= 5 THEN 0.75
                    WHEN agg.owners_count = 4 THEN 0.55
                    WHEN agg.owners_count >= 2 THEN 0.30
                    ELSE 0::numeric
                END AS s_owners
           FROM agg
        ), scored2 AS (
         SELECT scored.id,
            scored.direccion,
            scored.ciudad,
            scored.division_horizontal,
            scored.md,
            scored.numero_propietarios,
            scored.b_score_activo,
            scored.b_score_propietarios,
            scored.b_score_total,
            scored.m2_exactos,
            scored.m2_rango,
            scored.viviendas_unidades,
            scored.owners_count,
            scored.m2_total,
            scored.num_viviendas,
            scored.m2_comercio_x,
            scored.m2_oficina_x,
            scored.m2_almacen_x,
            scored.m2_industrial_x,
            scored.m2_vivienda_calc,
            scored.s_viviendas,
            scored.s_m2,
            scored.s_no_dh,
            scored.s_owners,
                CASE
                    WHEN scored.viviendas_unidades > 0 AND scored.m2_vivienda_calc IS NOT NULL THEN GREATEST(0::numeric, 1.0 - LEAST(1.0, scored.m2_vivienda_calc / NULLIF(scored.viviendas_unidades, 0)::numeric / 150.0))
                    ELSE 0::numeric
                END AS s_ratio,
                CASE
                    WHEN scored.viviendas_unidades > 0 AND scored.m2_vivienda_calc IS NOT NULL THEN round(scored.m2_vivienda_calc / NULLIF(scored.viviendas_unidades, 0)::numeric, 1)
                    ELSE NULL::numeric
                END AS ratio_m2_viv
           FROM scored
        ), ai AS (
         SELECT s.id,
            s.direccion,
            s.ciudad,
            s.division_horizontal,
            s.md,
            s.numero_propietarios,
            s.b_score_activo,
            s.b_score_propietarios,
            s.b_score_total,
            s.m2_exactos,
            s.m2_rango,
            s.viviendas_unidades,
            s.owners_count,
            s.m2_total,
            s.num_viviendas,
            s.m2_comercio_x,
            s.m2_oficina_x,
            s.m2_almacen_x,
            s.m2_industrial_x,
            s.m2_vivienda_calc,
            s.s_viviendas,
            s.s_m2,
            s.s_no_dh,
            s.s_owners,
            s.s_ratio,
            s.ratio_m2_viv,
            ba.id IS NOT NULL AS has_ai_analysis,
            ba.ventanas_fachada_total,
            ba.esquina,
            ba.segundas_escaleras,
            ba.protegido_historicamente,
            ba.plantas_levantables,
            ba.patios_detectados,
            ba.confidence,
                CASE
                    WHEN ba.metricas_extra ? 'intencion_venta'::text THEN NULLIF(ba.metricas_extra ->> 'intencion_venta'::text, ''::text)::boolean
                    ELSE NULL::boolean
                END AS intencion_venta
           FROM scored2 s
             LEFT JOIN building_analysis ba ON ba.building_id = s.id
        ), calc AS (
         SELECT ai.id,
            ai.direccion,
            ai.ciudad,
            ai.division_horizontal,
            ai.md,
            ai.numero_propietarios,
            ai.b_score_activo,
            ai.b_score_propietarios,
            ai.b_score_total,
            ai.m2_exactos,
            ai.m2_rango,
            ai.viviendas_unidades,
            ai.owners_count,
            ai.m2_total,
            ai.num_viviendas,
            ai.m2_comercio_x,
            ai.m2_oficina_x,
            ai.m2_almacen_x,
            ai.m2_industrial_x,
            ai.m2_vivienda_calc,
            ai.s_viviendas,
            ai.s_m2,
            ai.s_no_dh,
            ai.s_owners,
            ai.s_ratio,
            ai.ratio_m2_viv,
            ai.has_ai_analysis,
            ai.ventanas_fachada_total,
            ai.esquina,
            ai.segundas_escaleras,
            ai.protegido_historicamente,
            ai.plantas_levantables,
            ai.patios_detectados,
            ai.confidence,
            ai.intencion_venta,
            round((0.25 * ai.s_m2 + 0.15 * ai.s_viviendas + 0.20 * ai.s_ratio + 0.20 * ai.s_owners + 0.10 * ai.s_no_dh + 0.10 *
                CASE
                    WHEN ai.has_ai_analysis THEN COALESCE(ai.confidence, 0.5)
                    ELSE 0::numeric
                END) * 100::numeric, 1) AS score_raw
           FROM ai
        )
 SELECT id,
    direccion,
    ciudad,
    division_horizontal,
    md,
    numero_propietarios,
    m2_exactos,
    m2_rango,
    viviendas_unidades,
    owners_count,
    m2_total,
    num_viviendas,
    s_viviendas,
    s_m2,
    s_ratio,
    s_owners,
    s_no_dh,
    m2_comercio_x,
    m2_oficina_x,
    m2_almacen_x,
    m2_industrial_x,
    has_ai_analysis,
    ventanas_fachada_total,
    esquina,
    segundas_escaleras,
    protegido_historicamente,
    plantas_levantables,
    patios_detectados,
    confidence,
    intencion_venta,
    score_raw,
    COALESCE(b_score_total, score_raw) AS score,
    jsonb_build_array(jsonb_build_object('key', 'm2', 'label', 'Tamaño', 'pct', round(s_m2 * 100::numeric, 0), 'weight', 25), jsonb_build_object('key', 'viv', 'label', 'Nº viviendas', 'pct', round(s_viviendas * 100::numeric, 0), 'weight', 15), jsonb_build_object('key', 'ratio', 'label', 'Ratio m²/viv', 'pct', round(s_ratio * 100::numeric, 0), 'weight', 20), jsonb_build_object('key', 'owners', 'label', 'Propietarios', 'pct', round(s_owners * 100::numeric, 0), 'weight', 20), jsonb_build_object('key', 'no_dh', 'label', 'Sin DH', 'pct', round(s_no_dh * 100::numeric, 0), 'weight', 10), jsonb_build_object('key', 'ai', 'label', 'Confianza IA', 'pct', round(COALESCE(confidence, 0.5) * 100::numeric, 0), 'weight', 10)) AS score_breakdown,
    b_score_activo AS score_activo,
    b_score_propietarios AS score_propietarios,
    b_score_total AS score_total,
    m2_vivienda_calc,
    ratio_m2_viv
   FROM calc c
$vbsdef$);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'deriva v_building_score diferida: %', SQLERRM;
    RETURN;
  END;
  -- Verificación dura: la deriva sólo vale si la vista instalada rinde la
  -- expresión exacta que la migración 20260805051330 parchea por texto.
  v := pg_get_viewdef('public.v_building_score'::regclass, true);
  IF position('COALESCE(b_score_total, score_raw) AS score' in v) = 0 THEN
    RAISE EXCEPTION 'deriva v_building_score: la definición instalada no rinde la expresión esperada. Cola: %', right(v, 400);
  END IF;
  INSERT INTO public._wave1a_drift_marks(mark) VALUES ('v_building_score_pre_1a2')
    ON CONFLICT (mark) DO NOTHING;
END $vbs$;
