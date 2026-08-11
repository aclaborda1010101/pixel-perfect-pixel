-- =====================================================================
-- WAVE 1A.3 P0.4 · SNAPSHOT VERSIONADO DEL ESQUEMA PRE-1A.2
-- =====================================================================
-- GENERADO, NO ESCRITO A MANO. Reproducir con wave1a3_make_snapshot.sh.
-- Procedencia y checksum en los ficheros hermanos .provenance y .sha256.
-- Las extensiones REALES viven en el fichero hermano .extensions y las
-- instala el superusuario del clúster antes de aplicar la cadena.
-- NUNCA debe ejecutarse contra una base real.
-- =====================================================================
DO $snapguard$
BEGIN
  IF current_database() NOT LIKE 'wave1a\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: snapshot pre-1A.2 solo en base desechable wave1a_test_*, base actual = %', current_database();
  END IF;
END $snapguard$;
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.9
-- Dumped by pg_dump version 17.9

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: pg_cron; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION pg_cron; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: pg_net; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION pg_net; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--



--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: app_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.app_role AS ENUM (
    'admin',
    'manager',
    'agent',
    'viewer',
    'captacion',
    'comercial_zona',
    'prevalificacion',
    'whatsapp',
    'sales_manager'
);


--
-- Name: asset_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_status AS ENUM (
    'prospecto',
    'en_estudio',
    'listo_para_matching',
    'en_negociacion',
    'cerrado',
    'descartado'
);


--
-- Name: asset_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.asset_type AS ENUM (
    'vivienda',
    'local',
    'edificio',
    'suelo',
    'oficina',
    'industrial',
    'otro'
);


--
-- Name: assignment_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.assignment_status AS ENUM (
    'active',
    'paused',
    'discarded'
);


--
-- Name: building_company_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.building_company_role AS ENUM (
    'titular',
    'usufructuario',
    'banco_acreedor',
    'arrendador',
    'otro'
);


--
-- Name: building_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.building_status AS ENUM (
    'identificado',
    'contactado',
    'en_estudio',
    'descartado'
);


--
-- Name: buyer_persona; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.buyer_persona AS ENUM (
    'cansado',
    'desplazado',
    'controla',
    'ego',
    'no_traspasa',
    'vive_edificio',
    'no_primero',
    'sin_clasificar'
);


--
-- Name: cadence_step_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.cadence_step_kind AS ENUM (
    'llamada',
    'whatsapp',
    'email',
    'visita'
);


--
-- Name: call_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.call_direction AS ENUM (
    'entrante',
    'saliente'
);


--
-- Name: compliance_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.compliance_status AS ENUM (
    'pendiente',
    'aprobado',
    'rechazado'
);


--
-- Name: iee_estado; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.iee_estado AS ENUM (
    'desconocido',
    'no_procede',
    'pendiente',
    'favorable',
    'caducada',
    'desfavorable_leve',
    'desfavorable_grave'
);


--
-- Name: match_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.match_status AS ENUM (
    'propuesto',
    'aprobado',
    'rechazado',
    'contactado'
);


--
-- Name: next_action_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.next_action_status AS ENUM (
    'pendiente',
    'completada',
    'cancelada'
);


--
-- Name: nota_titular_rol; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.nota_titular_rol AS ENUM (
    'pleno',
    'usufructo',
    'nuda_propiedad',
    'otro',
    'ganancial'
);


--
-- Name: owner_company_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.owner_company_role AS ENUM (
    'socio',
    'administrador',
    'apoderado',
    'empleado',
    'titular_via_sociedad'
);


--
-- Name: owner_relation_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.owner_relation_type AS ENUM (
    'heredero_de',
    'conyuge_de',
    'representante_de',
    'apoderado_de',
    'padre_de',
    'socio_de'
);


--
-- Name: owner_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.owner_role AS ENUM (
    'particular',
    'heredero',
    'inversor_pasivo',
    'operador_profesional',
    'institucional',
    'desconocido'
);


--
-- Name: owner_subrole; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.owner_subrole AS ENUM (
    'ninguno',
    'heredero_operador',
    'heredero_residente',
    'heredero_ausente',
    'heredero_conflictivo',
    'arrendador',
    'usufructuario',
    'nudo_propietario',
    'apoderado'
);


--
-- Name: whatsapp_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.whatsapp_status AS ENUM (
    'borrador',
    'mock_enviado',
    'fallido'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.email', true) $$;


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true),'')::jsonb,'{}'::jsonb) $$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$ SELECT current_setting('request.jwt.claim.role', true) $$;


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;


--
-- Name: _merge_owner_pair(uuid, uuid, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._merge_owner_pair(p_canonical uuid, p_loser uuid, p_reason text DEFAULT 'fuzzy_match'::text, p_details jsonb DEFAULT '{}'::jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_name_norm text;
  v_nif text;
BEGIN
  IF p_canonical = p_loser THEN RETURN; END IF;

  -- external_ids: mover si no colisiona con unique
  UPDATE public.external_ids e
    SET entity_id = p_canonical
    WHERE e.entity_type='owner' AND e.entity_id = p_loser
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e2
        WHERE e2.entity_type='owner' AND e2.entity_id = p_canonical
          AND e2.provider = e.provider
          AND e2.provider_object_type = e.provider_object_type
          AND e2.provider_id = e.provider_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e3
        WHERE e3.entity_type='owner' AND e3.entity_id = p_canonical
          AND e3.provider = e.provider
          AND e3.provider_object_type = e.provider_object_type
      );
  DELETE FROM public.external_ids WHERE entity_type='owner' AND entity_id = p_loser;

  UPDATE public.calls               SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.notes               SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.notas_simples       SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.nota_simple_titulares SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.call_sessions       SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.cadence_steps       SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.whatsapp_messages   SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.assets              SET owner_id = p_canonical WHERE owner_id = p_loser;
  UPDATE public.next_actions        SET owner_id = p_canonical WHERE owner_id = p_loser;

  DELETE FROM public.owner_companies a
    WHERE a.owner_id = p_loser
      AND EXISTS (SELECT 1 FROM public.owner_companies b
                   WHERE b.owner_id = p_canonical AND b.company_id=a.company_id AND b.role=a.role);
  UPDATE public.owner_companies SET owner_id = p_canonical WHERE owner_id = p_loser;

  UPDATE public.owner_relations SET owner_a_id = p_canonical WHERE owner_a_id = p_loser AND owner_b_id <> p_canonical;
  UPDATE public.owner_relations SET owner_b_id = p_canonical WHERE owner_b_id = p_loser AND owner_a_id <> p_canonical;
  DELETE FROM public.owner_relations WHERE owner_a_id = p_loser OR owner_b_id = p_loser;

  -- building_owners: fusión por edificio (mantiene la fila canónica, funde metadatos)
  UPDATE public.building_owners bc
     SET cuota = GREATEST(COALESCE(bc.cuota,0), COALESCE(bl.cuota,0)),
         es_influencer = bc.es_influencer OR bl.es_influencer,
         influencer_score = GREATEST(COALESCE(bc.influencer_score,0), COALESCE(bl.influencer_score,0)),
         rol_notas = COALESCE(bc.rol_notas, bl.rol_notas),
         metadatos = COALESCE(bc.metadatos,'{}'::jsonb) || COALESCE(bl.metadatos,'{}'::jsonb)
    FROM public.building_owners bl
   WHERE bl.owner_id = p_loser
     AND bc.owner_id = p_canonical
     AND bc.building_id = bl.building_id;
  DELETE FROM public.building_owners
   WHERE owner_id = p_loser
     AND building_id IN (SELECT building_id FROM public.building_owners WHERE owner_id = p_canonical);
  UPDATE public.building_owners SET owner_id = p_canonical WHERE owner_id = p_loser;

  SELECT public.normalize_person_name(nombre),
         COALESCE(NULLIF(upper(metadatos->>'nif'),''), NULLIF(upper(metadatos->>'dni'),''))
    INTO v_name_norm, v_nif
    FROM public.owners WHERE id = p_loser;

  INSERT INTO public.owner_merge_audit (canonical_owner_id, merged_owner_id, name_norm, nif, reason, details)
  VALUES (p_canonical, p_loser, v_name_norm, v_nif, p_reason, COALESCE(p_details,'{}'::jsonb));

  UPDATE public.owners
     SET merged_into = p_canonical,
         metadatos = COALESCE(metadatos,'{}'::jsonb) || jsonb_build_object('merged_into', p_canonical, 'merged_at', now())
   WHERE id = p_loser;
END $$;


--
-- Name: _owner_names_typo_match(text, text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._owner_names_typo_match(a_nn text, b_nn text, p_token_threshold real DEFAULT 0.7) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public', 'extensions'
    AS $$
DECLARE
  a text[]; b text[];
  a_only text[]; b_only text[];
  t1 text; t2 text; lev int; max_len int;
BEGIN
  IF a_nn IS NULL OR b_nn IS NULL OR a_nn = '' OR b_nn = '' THEN RETURN false; END IF;
  a := string_to_array(a_nn, ' ');
  b := string_to_array(b_nn, ' ');
  IF array_length(a,1) <> array_length(b,1) OR array_length(a,1) < 2 THEN RETURN false; END IF;
  SELECT array_agg(t) INTO a_only FROM (SELECT unnest(a) t EXCEPT SELECT unnest(b)) s;
  SELECT array_agg(t) INTO b_only FROM (SELECT unnest(b) t EXCEPT SELECT unnest(a)) s;
  IF a_only IS NULL AND b_only IS NULL THEN RETURN true; END IF;
  IF array_length(a_only,1) <> 1 OR array_length(b_only,1) <> 1 THEN RETURN false; END IF;
  t1 := a_only[1]; t2 := b_only[1];
  -- Acepta si trigram-sim alto O si distancia Levenshtein ≤ 2 sobre tokens de longitud >=5
  IF similarity(t1, t2) >= p_token_threshold THEN RETURN true; END IF;
  max_len := GREATEST(length(t1), length(t2));
  IF max_len < 5 THEN RETURN false; END IF;
  lev := extensions.levenshtein(t1, t2);
  -- 2 letras cambiadas en un token de 8-9 chars => probable errata (Cabornero/Carbonero)
  RETURN lev <= 2 AND lev::real / max_len::real <= 0.30;
END $$;


--
-- Name: _safe_int_from_dir(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._safe_int_from_dir(p text) RETURNS integer
    LANGUAGE plpgsql IMMUTABLE
    SET search_path TO 'public'
    AS $$
DECLARE m text;
BEGIN
  m := (regexp_match(COALESCE(p,''), '\m(\d{1,4})\M'))[1];
  IF m IS NULL THEN RETURN NULL; END IF;
  RETURN m::integer;
EXCEPTION WHEN OTHERS THEN RETURN NULL;
END $$;


--
-- Name: _touch_owner_call_prep_cache(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._touch_owner_call_prep_cache() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


--
-- Name: _wave1a_replace_view(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public._wave1a_replace_view(p_view text, p_def text) RETURNS void
    LANGUAGE plpgsql
    AS $$
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
END $$;


--
-- Name: audit_building_owner_cuotas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_building_owner_cuotas() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v jsonb;
BEGIN
  WITH elig AS (SELECT building_id, owner_id, pct_pleno FROM public.v_rights_cuota_eligible),
  otros AS (
    SELECT DISTINCT building_id, owner_id FROM public.building_property_rights
    WHERE status='active' AND owner_id IS NOT NULL AND right_type <> 'pleno_dominio'
  ),
  calc AS (
    SELECT bo.building_id, bo.owner_id, bo.cuota, e.pct_pleno,
      CASE
        WHEN bo.cuota IS NULL THEN 'sin_auditar'
        WHEN e.pct_pleno IS NOT NULL AND abs(bo.cuota - e.pct_pleno) <= 0.5 THEN 'vigente'
        WHEN e.pct_pleno IS NOT NULL THEN 'superseded'
        WHEN o.owner_id IS NOT NULL THEN 'review'
        ELSE 'review'
      END AS est,
      CASE
        WHEN bo.cuota IS NULL THEN NULL
        WHEN e.pct_pleno IS NOT NULL AND abs(bo.cuota - e.pct_pleno) <= 0.5 THEN 'coincide con pleno dominio verificado en nota simple'
        WHEN e.pct_pleno IS NOT NULL THEN 'la nota simple declara ' || e.pct_pleno::text || '% en pleno dominio; cuota operativa conservada pero no usable'
        WHEN o.owner_id IS NOT NULL THEN 'el titular solo tiene derechos no plenos (usufructo/nuda/ganancial/otro)'
        ELSE 'sin derecho vigente de pleno dominio con identidad inequívoca y capa completa'
      END AS motivo
    FROM public.building_owners bo
    LEFT JOIN elig e ON e.building_id = bo.building_id AND e.owner_id = bo.owner_id
    LEFT JOIN otros o ON o.building_id = bo.building_id AND o.owner_id = bo.owner_id
  )
  UPDATE public.building_owners bo
     SET cuota_estado = c.est,
         cuota_estado_motivo = c.motivo,
         cuota_auditada_at = now(),
         metadatos = coalesce(bo.metadatos,'{}'::jsonb) || jsonb_build_object(
           'cuota_auditoria', jsonb_build_object(
             'cuota_operativa', bo.cuota, 'pct_registral_pleno', c.pct_pleno,
             'estado', c.est, 'motivo', c.motivo, 'at', now()))
    FROM calc c
   WHERE c.building_id = bo.building_id AND c.owner_id = bo.owner_id;

  SELECT jsonb_object_agg(cuota_estado, n) INTO v
  FROM (SELECT cuota_estado, count(*) n FROM public.building_owners GROUP BY 1) s;
  RETURN coalesce(v,'{}'::jsonb);
END $$;


--
-- Name: build_score_summary(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.build_score_summary(p_building_id uuid) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_activo numeric; v_prop numeric; v_total numeric; br jsonb;
  m2 numeric; viv numeric; m2_com numeric; m2_ofi numeric;
  bits text[] := ARRAY[]::text[];
  parts text[] := ARRAY[]::text[];
  fecha text; frag text;
BEGIN
  SELECT score_activo, score_propietarios, score_total, coalesce(score_propietarios_breakdown,'{}'::jsonb)
    INTO v_activo, v_prop, v_total, br
    FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT vs.m2_total, vs.num_viviendas, vs.m2_comercio_x, vs.m2_oficina_x
    INTO m2, viv, m2_com, m2_ofi
    FROM public.v_building_score vs WHERE vs.id = p_building_id;

  IF m2 IS NOT NULL THEN bits := array_append(bits, round(m2)::int::text || ' m²'); END IF;
  IF viv IS NOT NULL THEN bits := array_append(bits, round(viv)::int::text || ' viv'); END IF;
  IF m2 IS NOT NULL AND viv IS NOT NULL AND viv > 0 THEN
    bits := array_append(bits, round(m2/viv)::int::text || ' m²/viv');
  END IF;
  IF m2 IS NOT NULL AND m2 > 0 THEN
    bits := array_append(bits, round(100*(coalesce(m2_com,0)+coalesce(m2_ofi,0))/m2)::int::text || '% terciario');
  END IF;

  IF v_activo IS NOT NULL THEN
    parts := array_append(parts, format('Activo %s%s', round(v_activo)::int::text,
      CASE WHEN array_length(bits,1)>0 THEN ' ('||array_to_string(bits,', ')||')' ELSE '' END));
  END IF;

  IF v_prop IS NOT NULL THEN
    bits := ARRAY[]::text[];
    IF (br->>'n_owners') IS NOT NULL THEN bits := array_append(bits, (br->>'n_owners')::text || ' propietarios'); END IF;
    fecha := NULL;
    IF (br->>'last_call_at') IS NOT NULL THEN fecha := to_char((br->>'last_call_at')::timestamptz,'DD/MM'); END IF;
    IF coalesce((br->>'mayoria_vendedora')::boolean,false) THEN
      bits := array_append(bits, 'mayoría con intención de venta declarada'||coalesce(' —cita '||fecha,''));
    END IF;
    IF coalesce((br->>'oferta_previa_edificio')::boolean,false) THEN
      bits := array_append(bits, 'oferta previa discutida');
    END IF;
    IF coalesce((br->>'impulsor_edificio')::boolean,false) OR coalesce((br->>'n_impulsor')::int,0) > 0 THEN
      bits := array_append(bits, 'impulsor identificado');
    END IF;
    IF coalesce((br->>'n_positivos')::int,0) > 0 THEN
      bits := array_append(bits, (br->>'n_positivos')::text || ' con predisposición explícita a vender');
    END IF;
    IF coalesce((br->>'n_bloqueados')::int,0) > 0 THEN
      bits := array_append(bits, CASE WHEN (br->>'n_bloqueados')::int=1 THEN '1 bloqueador identificado'
                                      ELSE (br->>'n_bloqueados')::text||' bloqueadores' END);
    END IF;
    IF (br->>'n_contactados') IS NOT NULL AND (br->>'n_owners') IS NOT NULL THEN
      bits := array_append(bits, (br->>'n_contactados')::text || '/' || (br->>'n_owners')::text || ' contactados');
    END IF;
    parts := array_append(parts, format('Propietarios %s%s', round(v_prop)::int::text,
      CASE WHEN array_length(bits,1)>0 THEN ' ('||array_to_string(bits,'; ')||')' ELSE '' END));
  END IF;

  frag := array_to_string(parts, ' × ');
  IF v_total IS NOT NULL THEN
    frag := frag || format(' → Total %s (media ponderada 60%% activo · 40%% propietarios).', round(v_total)::int::text);
  END IF;
  RETURN frag;
END $$;


--
-- Name: building_feedback_to_qa(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_feedback_to_qa() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.estado = 'aplicada' AND (OLD.estado IS DISTINCT FROM 'aplicada') THEN
    BEGIN
      INSERT INTO public.scoring_v2_feedback (building_id, dimension, expected, actual, source, notes, created_at)
      VALUES (
        NEW.building_id,
        COALESCE(NEW.dimension,'otro'),
        COALESCE(NEW.override_aplicado, NEW.analisis_ia),
        NULL,
        'team_feedback',
        NEW.texto,
        now()
      );
    EXCEPTION WHEN OTHERS THEN
      -- Si la tabla destino tiene otra forma, ignoramos para no bloquear el override
      NULL;
    END;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: building_feedback_touch(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.building_feedback_touch() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;


--
-- Name: calls_stats(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.calls_stats() RETURNS TABLE(total bigint, analizables bigint, sin_transcripcion bigint, avg_duracion numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE transcripcion IS NOT NULL AND btrim(transcripcion) <> '')::bigint AS analizables,
    COUNT(*) FILTER (WHERE transcripcion IS NULL OR btrim(transcripcion) = '')::bigint AS sin_transcripcion,
    COALESCE(AVG(duracion_seg), 0)::numeric AS avg_duracion
  FROM public.calls;
$$;


--
-- Name: clean_owner_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.clean_owner_name(p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        coalesce(p_name, ''),
        -- quita cualquier "(...fallecid... / difunt... / e.p.d. / q.e.p.d ...)" con o sin paréntesis
        '\s*[\(\[]?\s*(probable\s+)?(fallecid[oa]s?|difunt[oa]s?|e\.?\s*p\.?\s*d\.?|q\.?\s*e\.?\s*p\.?\s*d\.?)\s*[\)\]]?\s*',
        ' ',
        'gi'
      ),
      '\s{2,}', ' ', 'g'
    ),
    ''
  );
$$;


--
-- Name: compute_cluster_score(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_cluster_score(p_building_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  b record; ba public.building_analysis%ROWTYPE; md jsonb;
  v_barrio_norm text; v_calle_norm text; v_calle_subzona text; v_calle_override text;
  v_calle_num integer;
  v_cluster text; v_cluster_secundario text;
  v_grupo text; v_es_prime_especial boolean := false;
  v_m2 numeric; v_m2_raw numeric; v_m2_fuente text;
  v_viv integer; v_viv_md integer; v_viv_auth integer; v_owners integer; v_owners_raw integer; v_ratio numeric;
  v_mg integer; v_score numeric:=0; v_breakdown jsonb:='[]'::jsonb; v_avisos jsonb:='[]'::jsonb;
  v_motivo text:=''; v_calle_tipo text; v_pen numeric:=0; v_bonus numeric:=0;
  v_terciario_m2 numeric; v_terciario_pct numeric;
  v_m2_viv_md numeric;
  v_dnprc_terc numeric; v_dnprc_viv numeric; v_dnprc_total numeric;
  v_pct_from_md numeric; v_pct_from_dnprc numeric;
  v_n_escaleras integer; v_n_subparc integer; v_n_escaleras_final integer;
  v_protegido boolean; v_aviso_cambio_uso boolean:=false;
  v_2esc_confirmada boolean:=false; v_2esc_posible boolean:=false;
  v_sl_count integer;
  s_tamano numeric:=0; w_tamano numeric:=0; rango_tamano text;
  s_ratio numeric:=0; w_ratio numeric:=0; rango_ratio text;
  s_viv numeric:=0; w_viv numeric:=0; s_own numeric:=0; w_own numeric:=0;
  s_mg numeric:=0; w_mg numeric:=0; s_local numeric:=0; w_local numeric:=0;
  s_esquina numeric:=0; w_esquina numeric:=0;
  v_es_estrella boolean := false;
  v_alarma_prot_2esc boolean := false;
  v_alarma_terciario boolean := false;
  v_n_alarmas integer := 0;
  v_iee_delta numeric:=0; v_iee_aviso jsonb; v_iee_label text; v_iee_estado text;
  v_mg_known boolean := false; v_owners_known boolean := false;
  v_confianza numeric := 1.0; v_faltantes text[] := '{}';
  v_estrella_terc boolean := false;
  v_estrella_esc boolean := false;
  v_estrella_reason text;
BEGIN
  SELECT * INTO b FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  md := COALESCE(b.metadatos,'{}'::jsonb);
  SELECT * INTO ba FROM public.building_analysis WHERE building_id = p_building_id;

  v_barrio_norm := normalize_barrio(md->>'barrios_completos__clonada_');
  v_calle_norm := normalize_barrio(b.direccion);
  v_calle_num := public._safe_int_from_dir(b.direccion);

  SELECT sub_zona, cluster_override INTO v_calle_subzona, v_calle_override
  FROM public.madrid_calles_subzona
  WHERE v_calle_norm LIKE '%' || calle_norm || '%'
    AND (numero_desde IS NULL OR numero_hasta IS NULL OR (v_calle_num IS NOT NULL AND v_calle_num BETWEEN numero_desde AND numero_hasta))
  ORDER BY CASE WHEN numero_desde IS NOT NULL THEN 0 ELSE 1 END, especificidad DESC, length(calle_norm) DESC LIMIT 1;

  IF v_calle_override IS NOT NULL THEN
    v_cluster := v_calle_override;
    v_motivo := 'subzona ' || v_calle_subzona || ' → ' || v_cluster;
  ELSE
    SELECT cluster, cluster_secundario INTO v_cluster, v_cluster_secundario
    FROM public.madrid_barrio_clusters WHERE barrio_norm = v_barrio_norm;
    IF v_cluster IS NULL THEN
      v_cluster := 'baja_prioridad'; v_motivo := 'barrio no clasificado → baja_prioridad';
      v_faltantes := array_append(v_faltantes, 'zona');
    ELSE
      v_motivo := 'barrio ' || coalesce(md->>'barrios_completos__clonada_','?') || ' → ' || v_cluster;
    END IF;
  END IF;

  v_es_prime_especial := v_barrio_norm IN (
    normalize_barrio('Justicia'), normalize_barrio('Jerónimos'),
    normalize_barrio('Recoletos'), normalize_barrio('Goya'),
    normalize_barrio('Lista'), normalize_barrio('Castellana'),
    normalize_barrio('Almagro'), normalize_barrio('Trafalgar'),
    normalize_barrio('El Viso')
  );
  v_grupo := CASE WHEN v_es_prime_especial THEN 'prime' ELSE 'resto' END;

  v_m2_raw := NULLIF(md->>'metros_cuadrados__exactos_','')::numeric;

  v_viv_md := COALESCE(NULLIF(md->>'viviendas__unidades___clonada_','')::integer,
              NULLIF(md->>'viviendas__unidades_','')::integer,
              NULLIF(md->>'num_viviendas','')::integer);
  SELECT viviendas_total INTO v_viv_auth FROM public.catastro_authority_cache
   WHERE refcatastral_14 = substring(b.refcatastral, 1, 14);
  IF v_viv_md IS NULL AND v_viv_auth IS NOT NULL THEN
    v_viv := v_viv_auth;
    v_avisos := v_avisos || jsonb_build_object('key','viviendas_autoridad','label','Viviendas desde Catastro','severity','info','tipo','info',
      'detail','Sin viviendas en metadata. Autoridad Catastro: ' || v_viv_auth::text || '.');
  ELSIF v_viv_md IS NOT NULL AND v_viv_auth IS NOT NULL
        AND v_m2_raw IS NOT NULL AND v_viv_md > 0 AND (v_m2_raw / v_viv_md) > 500 AND v_viv_auth <> v_viv_md THEN
    v_avisos := v_avisos || jsonb_build_object('key','viviendas_corregidas','label','Viviendas corregidas (autoridad)','severity','medium','tipo','info',
      'detail','HubSpot: ' || v_viv_md::text || ' viv, ratio >' || round(v_m2_raw / v_viv_md,0)::text || '. Sustituido por Catastro: ' || v_viv_auth::text || '.');
    v_viv := v_viv_auth;
  ELSE v_viv := v_viv_md;
  END IF;

  v_m2 := v_m2_raw; v_m2_fuente := 'metadata';
  IF v_m2 IS NOT NULL AND v_viv IS NOT NULL AND v_viv >= 4 AND v_m2 < v_viv * 25 THEN
    v_avisos := v_avisos || jsonb_build_object('key','m2_corruptos','label','m² aparentemente corruptos','severity','medium','tipo','info',
      'detail','Sustituido por ' || (v_viv*80)::text || ' m² estimados.');
    v_m2 := v_viv * 80; v_m2_fuente := 'estimado_viv';
  ELSIF v_m2 IS NULL AND v_viv IS NOT NULL THEN
    v_m2 := v_viv * 80; v_m2_fuente := 'estimado_viv';
    v_avisos := v_avisos || jsonb_build_object('key','m2_estimados','label','m² estimados','severity','info','tipo','info','detail','Sin m². Estimación ' || v_m2::text || ' m².');
  END IF;
  IF v_m2_fuente <> 'metadata' THEN v_faltantes := array_append(v_faltantes, 'm2_estimado'); END IF;
  IF v_m2 IS NULL THEN v_faltantes := array_append(v_faltantes, 'm2'); END IF;

  v_owners_raw := (SELECT count(*)::integer FROM building_owners bo WHERE bo.building_id = p_building_id);
  v_owners := public.count_distinct_owners(p_building_id);
  v_owners_known := COALESCE(v_owners_raw,0) > 0;
  v_sl_count := (SELECT count(DISTINCT company_id)::integer FROM building_companies WHERE building_id = p_building_id);
  v_ratio := CASE WHEN v_viv>0 AND v_m2 IS NOT NULL THEN v_m2/v_viv ELSE NULL END;
  v_mg := COALESCE(ba.mala_gestion_score, 0);
  v_mg_known := ba.mala_gestion_score IS NOT NULL;
  v_protegido := COALESCE(ba.protegido_historicamente, false);

  SELECT n_subparcelas_residenciales INTO v_n_subparc FROM public.catastro_authority_cache
   WHERE refcatastral_14 = substring(b.refcatastral, 1, 14);

  v_n_escaleras := GREATEST(
    COALESCE(ba.n_escaleras_visor, 0),
    COALESCE(ba.n_escaleras_en_piso01, 0),
    COALESCE(ba.n_escaleras_en_planta_baja, 0),
    CASE WHEN COALESCE(ba.segundas_escaleras,false) THEN 2 ELSE 0 END,
    COALESCE(NULLIF(md->>'num_escaleras','')::integer, 0),
    COALESCE(v_n_subparc, 0), 1);
  v_n_escaleras_final := v_n_escaleras;

  v_m2_viv_md := NULLIF(md->>'metros_cuadrados_viviendas','')::numeric;
  v_terciario_m2 := COALESCE(NULLIF(md->>'metros_cuadrado_oficina','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_oficina','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_comercio','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_ocio_hostel','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_industrial','')::numeric,0)
                  + COALESCE(NULLIF(md->>'metros_cuadrados_almacen','')::numeric,0);

  IF v_terciario_m2 > 0 AND v_m2_viv_md IS NOT NULL AND (v_terciario_m2 + v_m2_viv_md) > 0 THEN
    v_pct_from_md := v_terciario_m2 / (v_terciario_m2 + v_m2_viv_md);
  ELSIF v_terciario_m2 > 0 AND COALESCE(v_m2,0) > 0 THEN
    v_pct_from_md := v_terciario_m2 / v_m2;
  ELSE
    v_pct_from_md := NULL;
  END IF;

  IF v_pct_from_md IS NULL THEN
    SELECT
      COALESCE(SUM(CASE WHEN upper(sp->>'uso') IN ('COMERCIO','OFICINA','OCIO HOSTEL.','HOTELERO','INDUSTRIAL','ALMACEN') THEN (sp->>'superficie_m2')::numeric ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN upper(sp->>'uso') = 'VIVIENDA' THEN (sp->>'superficie_m2')::numeric ELSE 0 END),0),
      COALESCE(SUM(CASE WHEN upper(sp->>'uso') NOT IN ('APARCAMIENTO','ELEMENTOS COMUNES') THEN (sp->>'superficie_m2')::numeric ELSE 0 END),0)
    INTO v_dnprc_terc, v_dnprc_viv, v_dnprc_total
    FROM public.catastro_data cd, LATERAL jsonb_array_elements(COALESCE(cd.dnprc_json->'subparcelas','[]'::jsonb)) sp
    WHERE cd.building_id = p_building_id;
    IF v_dnprc_total > 0 THEN
      v_pct_from_dnprc := v_dnprc_terc / v_dnprc_total;
    END IF;
  END IF;

  v_terciario_pct := COALESCE(v_pct_from_md, v_pct_from_dnprc, 0);
  IF v_terciario_pct < 0.34 AND COALESCE(ba.n_locales_planta_baja,0) >= 1 THEN
    v_terciario_pct := GREATEST(v_terciario_pct, 0.34);
  END IF;

  IF v_cluster = 'ultra_prime' AND COALESCE(v_m2,0) < 1000 THEN
    v_avisos := v_avisos || jsonb_build_object('key','ultra_prime_no_aplica','label','Ultra Prime degradado','severity','medium','tipo','info',
      'detail','Reclasificado prime_value_add por tamaño insuficiente.');
    v_cluster := 'prime_value_add'; v_motivo := v_motivo || ' · degradado';
  END IF;

  v_2esc_confirmada := COALESCE(ba.second_staircase_confirmed, false);
  v_2esc_posible := (NOT v_2esc_confirmada)
    AND ( COALESCE(ba.n_escaleras_visor,0) >= 2 OR COALESCE(ba.segundas_escaleras,false)
       OR COALESCE(ba.n_escaleras_en_piso01,0) >= 2
       OR GREATEST(COALESCE(ba.n_escaleras_en_planta_baja,0), COALESCE(NULLIF(md->>'num_escaleras','')::integer,0), COALESCE(v_n_subparc,0)) >= 2 );

  -- ALARMA 1: PROTEGIDO + 2 ESCALERAS
  IF v_protegido AND (v_2esc_confirmada OR v_n_escaleras_final >= 2) THEN
    v_alarma_prot_2esc := true;
    v_aviso_cambio_uso := true;
    v_avisos := v_avisos || jsonb_build_object('key','alarma_protegido_2esc','label','🚨 PROTEGIDO + 2 ESCALERAS','severity','high','tipo','alarma',
      'detail','Protegido + ' || CASE WHEN v_2esc_confirmada THEN '2ª escalera CONFIRMADA' ELSE '≥2 escaleras detectadas' END || '. Apto cambio de uso a hospedaje (PGOU Madrid).');
    v_n_alarmas := v_n_alarmas + 1;
  ELSIF v_protegido AND v_2esc_posible THEN
    v_avisos := v_avisos || jsonb_build_object('key','cambio_uso_sugerido_revisar','label','Posible cambio de uso — CONFIRMAR 2ª escalera','severity','high','tipo','info',
      'detail','El análisis sugiere ≥2 escaleras (Visor: ' || COALESCE(ba.n_escaleras_visor::text,'-') || '). NO puntúa hasta confirmación humana.');
    v_faltantes := array_append(v_faltantes, 'segunda_escalera_sin_confirmar');
  END IF;

  -- ALARMA 2: TERCIARIO ≥66%
  IF COALESCE(v_terciario_pct,0) >= 0.66 THEN
    v_alarma_terciario := true;
    v_avisos := v_avisos || jsonb_build_object('key','alarma_terciario_alto','label','🚨 TERCIARIO ≥66%','severity','high','tipo','alarma',
      'detail','Terciario ' || round(v_terciario_pct*100,0)::text || '% del edificio.');
    v_n_alarmas := v_n_alarmas + 1;
  END IF;

  -- ⭐ ESTRELLA: se marca si CUALQUIERA de: terciario ≥66% O 2ª escalera confirmada O ≥2 escaleras detectadas.
  v_estrella_terc := COALESCE(v_terciario_pct,0) >= 0.66;
  v_estrella_esc  := v_2esc_confirmada OR v_n_escaleras_final >= 2;
  IF v_estrella_terc OR v_estrella_esc THEN
    v_es_estrella := true;
    IF v_estrella_terc AND v_estrella_esc THEN
      v_estrella_reason := 'Terciario ≥66% + ' || CASE WHEN v_2esc_confirmada THEN '2ª escalera confirmada' ELSE '≥2 escaleras' END;
    ELSIF v_estrella_terc THEN
      v_estrella_reason := 'Terciario ' || round(v_terciario_pct*100,0)::text || '%';
    ELSE
      v_estrella_reason := CASE WHEN v_2esc_confirmada THEN '2ª escalera confirmada' ELSE '≥2 escaleras' END;
    END IF;
    v_avisos := v_avisos || jsonb_build_object('key','estrella','label','⭐ OPCIÓN ESTRELLA','severity','high','tipo','alarma',
      'detail', v_estrella_reason || ' → máxima prioridad.');
    IF v_alarma_prot_2esc AND v_cluster <> 'ultra_prime' THEN
      v_cluster := 'ultra_prime'; v_motivo := v_motivo || ' · upgrade ultra_prime';
    END IF;
  END IF;

  IF v_cluster = 'ultra_prime' THEN
    s_tamano := CASE WHEN v_m2 BETWEEN 1500 AND 4000 THEN 1.0 WHEN v_m2 BETWEEN 1000 AND 1500 OR v_m2 BETWEEN 4000 AND 5000 THEN 0.5 ELSE 0 END; rango_tamano := '1500-4000';
    s_ratio := CASE WHEN v_ratio BETWEEN 90 AND 160 THEN 1.0 WHEN v_ratio BETWEEN 50 AND 90 THEN 0.5 WHEN v_ratio < 50 THEN 0.2 ELSE 0.3 END; rango_ratio := '90-160';
  ELSIF v_cluster = 'prime_value_add' THEN
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 WHEN v_m2 BETWEEN 500 AND 800 OR v_m2 BETWEEN 1800 AND 2500 THEN 0.5 ELSE 0 END; rango_tamano := '800-1800';
    s_ratio := CASE WHEN v_ratio BETWEEN 60 AND 110 THEN 1.0 WHEN v_ratio BETWEEN 40 AND 60 OR v_ratio BETWEEN 110 AND 140 THEN 0.5 ELSE 0.2 END; rango_ratio := '60-110';
  ELSIF v_cluster = 'flex_living_core' THEN
    s_ratio := CASE WHEN v_ratio BETWEEN 35 AND 70 THEN 1.0 WHEN v_ratio BETWEEN 70 AND 100 THEN 0.5 WHEN v_ratio < 35 THEN 0.4 ELSE 0.2 END; rango_ratio := '35-70';
    s_tamano := CASE WHEN v_m2 BETWEEN 800 AND 1800 THEN 1.0 ELSE 0.5 END; rango_tamano := '800-1800';
  ELSIF v_cluster IN ('outer_distressed','outer_distressed_selectivo') THEN
    s_tamano := CASE WHEN v_m2 BETWEEN 300 AND 1000 THEN 1.0 WHEN v_m2 BETWEEN 200 AND 300 OR v_m2 BETWEEN 1000 AND 1500 THEN 0.5 ELSE 0.2 END; rango_tamano := '300-1000';
    s_ratio := CASE WHEN v_ratio BETWEEN 40 AND 80 THEN 1.0 WHEN v_ratio BETWEEN 30 AND 40 OR v_ratio BETWEEN 80 AND 110 THEN 0.5 ELSE 0.2 END; rango_ratio := '40-80';
  ELSE
    s_tamano := CASE WHEN v_m2 IS NOT NULL THEN 0.5 ELSE 0 END;
    s_ratio := 0.4; rango_tamano := 'n/a'; rango_ratio := 'n/a';
  END IF;

  IF v_es_prime_especial THEN
    w_own:=30; w_viv:=24; w_mg:=20; w_esquina:=14; w_ratio:=12; w_tamano:=0; w_local:=0;
  ELSE
    w_viv:=30; w_own:=24; w_esquina:=18; w_ratio:=16; w_mg:=12; w_tamano:=0; w_local:=0;
  END IF;

  s_viv := LEAST(1.0, COALESCE(v_viv,0)::numeric / 25.0);

  IF COALESCE(ba.esquina,false) = true AND COALESCE(ba.esquina_needs_review,false) = false THEN
    s_esquina := 1.0;
  ELSE
    s_esquina := 0;
    IF COALESCE(ba.esquina,false) = true AND COALESCE(ba.esquina_needs_review,false) = true THEN
      v_faltantes := array_append(v_faltantes, 'esquina_sin_confirmar');
    END IF;
  END IF;

  IF NOT v_owners_known THEN
    v_faltantes := array_append(v_faltantes, 'propietarios');
  END IF;
  IF v_owners <= 1 THEN s_own := 0;
  ELSIF v_owners <= 4 THEN s_own := 0.4;
  ELSIF v_owners <= 9 THEN s_own := 0.8;
  ELSIF v_owners <= 19 THEN s_own := 1.0;
  ELSE s_own := 1.0; v_bonus := v_bonus + 5;
  END IF;

  s_mg := COALESCE(v_mg,0)::numeric / 10.0;
  IF NOT v_mg_known THEN v_faltantes := array_append(v_faltantes, 'mala_gestion'); END IF;

  IF ba.local_pb_m2 IS NOT NULL OR ba.local_pb_fachada_m IS NOT NULL THEN
    s_local := LEAST(1.0,
        CASE WHEN COALESCE(ba.local_pb_fachada_m,0) > 6 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_m2,0) >= 80 THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_esquina,false) THEN 0.25 ELSE 0 END
      + CASE WHEN COALESCE(ba.local_pb_viviendas_potenciales,0) >= 2 THEN 0.25 ELSE 0 END);
  END IF;
  SELECT tipo INTO v_calle_tipo FROM public.madrid_calles_comerciales WHERE normalize_barrio(b.direccion) LIKE '%' || calle_norm || '%' LIMIT 1;
  IF v_calle_tipo IS NOT NULL THEN s_local := LEAST(1.0, s_local + 0.3); END IF;

  IF v_aviso_cambio_uso THEN v_bonus := v_bonus + 12;
  ELSIF v_protegido THEN v_pen := v_pen + 5; END IF;
  IF COALESCE(ba.edificio_reformado,false) THEN v_pen := v_pen + 25; END IF;
  IF COALESCE(ba.gestion_profesional,false) THEN v_pen := v_pen + 15; END IF;
  IF COALESCE(v_terciario_pct,0) >= 0.66 THEN v_bonus := v_bonus + 8; END IF;

  SELECT delta, aviso, label, estado INTO v_iee_delta, v_iee_aviso, v_iee_label, v_iee_estado
    FROM public.iee_score_components(p_building_id);
  IF v_iee_aviso IS NOT NULL THEN v_avisos := v_avisos || v_iee_aviso; END IF;

  v_score := round(
      s_tamano*w_tamano + s_ratio*w_ratio + s_viv*w_viv + s_own*w_own
    + s_mg*w_mg + s_esquina*w_esquina + s_local*w_local
    + v_bonus + v_iee_delta - v_pen, 1);
  v_score := GREATEST(0, LEAST(100, v_score));

  v_confianza := GREATEST(0.2, round(1.0 - 0.18 * COALESCE(array_length(v_faltantes,1),0), 2));

  v_breakdown := jsonb_build_array(
    jsonb_build_object('key','viviendas','label','Nº viviendas','valor_raw', v_viv, 'peso', w_viv, 'contribucion', round(s_viv*w_viv,1)),
    jsonb_build_object('key','propietarios','label','Nº propietarios','valor_raw', v_owners, 'peso', w_own, 'contribucion', round(s_own*w_own,1)),
    jsonb_build_object('key','mala_gestion','label','Mala gestión','valor_raw', CASE WHEN v_mg_known THEN v_mg ELSE NULL END, 'peso', w_mg, 'contribucion', round(s_mg*w_mg,1)),
    jsonb_build_object('key','esquina','label','Esquina','valor_raw', COALESCE(ba.esquina,false), 'peso', w_esquina, 'contribucion', round(s_esquina*w_esquina,1)),
    jsonb_build_object('key','ratio','label','Ratio m²/viv (' || rango_ratio || ')','valor_raw', round(coalesce(v_ratio,0),1), 'peso', w_ratio, 'contribucion', round(s_ratio*w_ratio,1)),
    jsonb_build_object('key','tamano','label','Tamaño (' || rango_tamano || ')','valor_raw', v_m2, 'peso', w_tamano, 'contribucion', round(s_tamano*w_tamano,1), 'fuente', v_m2_fuente),
    jsonb_build_object('key','terciario','label','% terciario','valor_raw', round(coalesce(v_terciario_pct,0)*100,0), 'peso', 0, 'contribucion', 0,
      'fuente', CASE WHEN v_pct_from_md IS NOT NULL THEN 'metadata' WHEN v_pct_from_dnprc IS NOT NULL THEN 'dnprc' ELSE 'ninguna' END));
  IF v_iee_estado IS NOT NULL AND v_iee_estado <> 'desconocido' THEN
    v_breakdown := v_breakdown || jsonb_build_object('key','iee','label', coalesce(v_iee_label,'IEE'),'valor_raw', v_iee_estado,'peso', 0,'contribucion', round(v_iee_delta,1));
  END IF;
  IF v_bonus > 0 THEN v_breakdown := v_breakdown || jsonb_build_object('key','bonus','label','Bonus','valor_raw',null,'peso',v_bonus,'contribucion',v_bonus); END IF;
  IF v_pen > 0 THEN v_breakdown := v_breakdown || jsonb_build_object('key','penalizacion','label','Penalizaciones','valor_raw',null,'peso',-1,'contribucion',-v_pen); END IF;
  v_breakdown := v_breakdown || jsonb_build_object('key','_confianza','label','Confianza','valor_raw', v_confianza, 'peso', 0, 'contribucion', 0,
    'datos_incompletos', to_jsonb(v_faltantes), 'grupo', v_grupo, 'es_estrella', v_es_estrella, 'n_alarmas', v_n_alarmas);

  UPDATE public.buildings
  SET cluster_asignado = v_cluster, cluster_score = v_score, cluster_breakdown = v_breakdown,
      cluster_motivo = v_motivo, avisos_inteligentes = v_avisos, numero_propietarios = v_owners,
      score = v_score, score_breakdown = v_breakdown, score_updated_at = now(),
      grupo_barrio = v_grupo, pct_terciario = round(coalesce(v_terciario_pct,0),4), es_estrella = v_es_estrella
  WHERE id = p_building_id;

  RETURN v_score;
END;
$$;


--
-- Name: compute_owner_score(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_owner_score(p_building_id uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_score numeric := 45;
  v_signals jsonb := '[]'::jsonb;
  v_owner record;
  v_n_owners int := 0;
  v_n_contacted int := 0;
  v_n_positive int := 0;
  v_n_blocked int := 0;
  v_n_impulsor int := 0;
  v_delta numeric;
  v_txt_owner text;
  v_txt_bld text := '';
  v_txt_bld_sessions text := '';
  v_txt_bld_hs text := '';
  v_txt_bld_kpis text := '';
  v_oferta boolean := false;
  v_mayoria boolean := false;
  v_impulsor_bld boolean := false;
  v_owner_positive boolean;
  v_owner_blocked boolean;
  v_owner_impulsor boolean;
  v_cvg numeric;
  v_last_call_at timestamptz;
  v_last_call_hs text;
  v_deal_id text;
  v_hs_ids text[];
  v_has_positive_signals boolean;
  v_owner_kpi_positive boolean;
  v_owner_kpi_blocked boolean;
  v_owner_kpi_oferta boolean;
  v_suc record;
  POS_RX text := '((quier[oaenás]{1,4}|quer(emos|éis|ían?|íamos))\s+vender|dispuest[oa]s?\s+a\s+vender|acepta\s+vender|necesita\s+vender|urge\s+vender|salir\s+del?\s+edificio|predisposici[oó]n.{0,20}(alta|positiv|si)|intenci[oó]n\s+de\s+vender|motivaci[oó]n.{0,20}(alta|urgen)|abiert[oa]s?\s+a\s+opciones)';
  NEG_RX text := '(no\s+quier[eo]n?\s+vender|se\s+niega|nunca\s+(voy\s+a\s+)?vender|no\s+piensa\s+vender|cerrad[oa]\s+a\s+vender)';
  IMP_RX text := '(impulsor|lidera|liderazgo|puente\s+clave|asumido\s+el\s+liderazgo|gestion(a|ando)\s+el\s+tema)';
  MAY_RX text := '(mayor[ií]a.{0,40}vender|mayor[ií]a\s+(aplastante|de propietarios)|dispuest[oa]s?\s+a\s+vender|todos?\s+quer(emos|éis|ían?)\s+vender|todos?\s+quier[eo]n?\s+vender)';
  OFR_RX text := '(oferta.{0,60}(previa|discutid|comentad|sobre la mesa|encima de la mesa|mano|hech|recibid)|otr[ao]s?\s+empresa.{0,30}(ha\s+)?oferta|le\s+han?\s+ofertad|\d{1,3}[\.,]?\d?\s?m[€e]\b|\d{1,3}[\.,]?\d?\s?millon)';
BEGIN
  SELECT hs_deal_id INTO v_deal_id FROM public.buildings WHERE id = p_building_id;

  SELECT array_agg(DISTINCT ei.provider_id) FILTER (WHERE ei.provider_id IS NOT NULL)
    INTO v_hs_ids
    FROM public.building_owners bo
    JOIN public.owners o ON o.id = bo.owner_id
    LEFT JOIN public.external_ids ei
      ON ei.entity_type = 'owner' AND ei.entity_id = o.id
     AND ei.provider = 'hubspot' AND ei.provider_object_type = 'contact'
   WHERE bo.building_id = p_building_id AND o.merged_into IS NULL;

  SELECT string_agg(lower(coalesce(cs.voss_post->>'resumen_ejecutivo','') || ' ' ||
                         coalesce((SELECT string_agg(x->>'dato',' ')
                                     FROM jsonb_array_elements(cs.voss_post->'inteligencia_extraida') x),'')),
                    ' | ')
    INTO v_txt_bld_sessions
    FROM public.call_sessions cs
   WHERE (cs.building_id = p_building_id
          OR cs.owner_id IN (SELECT owner_id FROM public.building_owners WHERE building_id = p_building_id))
     AND cs.voss_post IS NOT NULL;

  SELECT string_agg(lower(coalesce(hc.hs_call_summary,'')), ' | ')
    INTO v_txt_bld_hs
    FROM public.hubspot_calls hc
   WHERE hc.hs_call_summary IS NOT NULL
     AND (
       (v_deal_id IS NOT NULL AND v_deal_id = ANY(hc.associated_deal_ids))
       OR (v_hs_ids IS NOT NULL AND hc.associated_contact_ids && v_hs_ids)
     );

  SELECT string_agg(lower(coalesce(k->>'evidencia','')), ' | ')
    INTO v_txt_bld_kpis
    FROM public.owner_call_prep_cache c
    JOIN public.building_owners bo ON bo.owner_id = c.owner_id
    LEFT JOIN LATERAL jsonb_array_elements(c.kpis_json->'kpis') k ON true
   WHERE bo.building_id = p_building_id
     AND (k->>'estado') = 'tenemos';

  v_txt_bld := coalesce(v_txt_bld_sessions,'') || ' || ' ||
               coalesce(v_txt_bld_hs,'') || ' || ' ||
               coalesce(v_txt_bld_kpis,'');

  SELECT max(iniciada_at), max(hubspot_call_id)
    INTO v_last_call_at, v_last_call_hs
    FROM public.call_sessions
   WHERE (building_id = p_building_id
          OR owner_id IN (SELECT owner_id FROM public.building_owners WHERE building_id = p_building_id))
     AND voss_post IS NOT NULL;

  v_oferta := v_txt_bld ~ OFR_RX;
  v_mayoria := v_txt_bld ~ MAY_RX;
  v_impulsor_bld := v_txt_bld ~ IMP_RX;
  v_has_positive_signals := v_mayoria OR v_oferta OR v_impulsor_bld;

  FOR v_owner IN
    SELECT bo.owner_id
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id
     WHERE bo.building_id = p_building_id AND o.merged_into IS NULL
  LOOP
    v_n_owners := v_n_owners + 1;

    SELECT lower(coalesce(string_agg(
              coalesce(cs.voss_post->>'resumen_ejecutivo','') || ' ' ||
              coalesce((SELECT string_agg(x->>'dato',' ') FROM jsonb_array_elements(cs.voss_post->'inteligencia_extraida') x),''),
            ' '), '') || ' ' ||
           coalesce((SELECT lower(kpis_json::text) FROM public.owner_call_prep_cache WHERE owner_id = v_owner.owner_id LIMIT 1),''))
      INTO v_txt_owner
      FROM public.call_sessions cs
     WHERE cs.owner_id = v_owner.owner_id AND cs.voss_post IS NOT NULL;
    v_txt_owner := coalesce(v_txt_owner,'');

    IF EXISTS (SELECT 1 FROM public.owner_call_prep_cache WHERE owner_id = v_owner.owner_id)
       OR EXISTS (SELECT 1 FROM public.call_sessions WHERE owner_id = v_owner.owner_id AND voss_post IS NOT NULL) THEN
      v_n_contacted := v_n_contacted + 1;
    END IF;

    SELECT
      bool_or((k->>'clave') IN ('predisposicion','motivacion_urgencia','necesidad_liquidez')
              AND (k->>'estado')='tenemos'
              AND lower(coalesce(k->>'evidencia','')) ~ POS_RX
              AND lower(coalesce(k->>'evidencia','')) !~ ('^'||NEG_RX)),
      bool_or((k->>'clave') IN ('predisposicion','quien_bloquea')
              AND (k->>'estado')='tenemos'
              AND lower(coalesce(k->>'evidencia','')) ~ NEG_RX),
      bool_or((k->>'clave')='oferta_previa' AND (k->>'estado')='tenemos'
              AND length(coalesce(k->>'evidencia',''))>3)
    INTO v_owner_kpi_positive, v_owner_kpi_blocked, v_owner_kpi_oferta
    FROM public.owner_call_prep_cache c
    LEFT JOIN LATERAL jsonb_array_elements(c.kpis_json->'kpis') k ON true
    WHERE c.owner_id = v_owner.owner_id;

    v_owner_positive := coalesce(v_owner_kpi_positive,false) OR v_txt_owner ~ POS_RX;
    v_owner_blocked  := coalesce(v_owner_kpi_blocked,false) OR v_txt_owner ~ NEG_RX;
    v_owner_impulsor := v_txt_owner ~ IMP_RX;

    IF coalesce(v_owner_kpi_oferta,false) THEN v_oferta := true; END IF;

    IF v_owner_positive THEN
      v_n_positive := v_n_positive + 1;
      v_score := v_score + 8;
      v_signals := v_signals || jsonb_build_object('owner_id',v_owner.owner_id,'signal','predisposicion_positiva','delta',8);
      IF v_owner_blocked THEN
        v_n_blocked := v_n_blocked + 1;
      END IF;
    ELSIF v_owner_blocked AND NOT v_owner_impulsor THEN
      v_n_blocked := v_n_blocked + 1;
    END IF;

    IF v_owner_impulsor THEN v_n_impulsor := v_n_impulsor + 1; END IF;
  END LOOP;

  IF v_n_owners = 0 THEN
    RETURN jsonb_build_object('score',50,
      'breakdown',jsonb_build_object('n_owners',0,'signals','[]'::jsonb,'notes','Sin propietarios registrados'));
  END IF;

  IF v_n_owners >= 20 THEN v_delta := 12;
  ELSIF v_n_owners >= 10 THEN v_delta := 8;
  ELSIF v_n_owners >= 4 THEN v_delta := 6;
  ELSIF v_n_owners >= 2 THEN v_delta := 2;
  ELSE v_delta := -4; END IF;
  v_score := v_score + v_delta;
  v_signals := v_signals || jsonb_build_object('signal','n_propietarios','delta',v_delta,'evidence',v_n_owners);

  IF v_n_impulsor > 0 OR v_impulsor_bld THEN
    v_score := v_score + 8;
    v_signals := v_signals || jsonb_build_object('signal','impulsor_identificado','delta',8,'evidence',greatest(v_n_impulsor,1));
  END IF;

  v_has_positive_signals := v_has_positive_signals OR v_n_positive > 0;

  IF v_mayoria OR v_n_positive >= greatest(2, ceil(v_n_contacted::numeric/2)) THEN
    v_score := v_score + 12;
    v_signals := v_signals || jsonb_build_object('signal','mayoria_vendedora','delta',12,'evidence',v_n_positive);
    v_mayoria := true;
  END IF;

  IF v_oferta THEN
    v_score := v_score + 10;
    v_signals := v_signals || jsonb_build_object('signal','oferta_previa_discutida','delta',10);
  END IF;

  IF v_n_blocked > 0 THEN
    IF v_has_positive_signals THEN
      v_score := v_score - 3;
      v_signals := v_signals || jsonb_build_object('signal','bloqueador_identificado','delta',-3,'evidence',v_n_blocked,
        'nota','bloqueador aislado con mayoría/oferta/impulsor: palanca de negociación, no rebaja');
    ELSIF v_n_positive = 0 AND v_n_contacted > 0 AND v_n_blocked = v_n_contacted THEN
      v_score := least(v_score, 25);
      v_signals := v_signals || jsonb_build_object('signal','todos_cerrados','delta','cap<=25','evidence',v_n_blocked);
    ELSIF v_n_blocked >= greatest(3, ceil(v_n_contacted::numeric/2)) THEN
      v_score := v_score - 20;
      v_signals := v_signals || jsonb_build_object('signal','mayoria_bloqueada','delta',-20,'evidence',v_n_blocked);
    ELSE
      v_delta := greatest(-3 * v_n_blocked, -9);
      v_score := v_score + v_delta;
      v_signals := v_signals || jsonb_build_object('signal','bloqueador_identificado','delta',v_delta,'evidence',v_n_blocked);
    END IF;
  END IF;

  v_cvg := v_n_contacted::numeric / v_n_owners;
  v_delta := -round(4 * (1 - v_cvg));
  IF v_delta < 0 THEN
    v_score := v_score + v_delta;
    v_signals := v_signals || jsonb_build_object('signal','cobertura_baja','delta',v_delta,
      'evidence', jsonb_build_object('contactados', v_n_contacted, 'total', v_n_owners),
      'nota','sub-señal informativa · trabajo pendiente, no calidad del activo');
  END IF;

  -- === NUEVO: señales de sucesión/envejecimiento ===
  SELECT * INTO v_suc FROM public.v_building_sucesion WHERE building_id = p_building_id;
  IF v_suc.building_id IS NOT NULL THEN
    IF v_suc.estado_sucesion = 'herencia_abierta' THEN
      -- fuerte: herederos = no eligieron estar ahí = vía de entrada
      v_delta := CASE
        WHEN v_suc.n_fallecidos >= v_suc.n_propietarios THEN 18   -- todos fallecidos
        WHEN v_suc.n_fallecidos::numeric / v_suc.n_propietarios >= 0.5 THEN 14
        ELSE 10
      END;
      v_score := v_score + v_delta;
      v_signals := v_signals || jsonb_build_object(
        'signal','herencia_abierta','delta',v_delta,
        'evidence', jsonb_build_object('n_fallecidos',v_suc.n_fallecidos,'n_propietarios',v_suc.n_propietarios),
        'nota','herederos localizables · nunca penaliza si aún no hay contacto');
    ELSIF v_suc.estado_sucesion = 'sospecha' THEN
      v_score := v_score + 5;
      v_signals := v_signals || jsonb_build_object(
        'signal','sospecha_fallecimiento','delta',5,
        'evidence', jsonb_build_object('n_probables',v_suc.n_probables),
        'nota','marcado como probable fallecido · verificar y localizar herederos');
    ELSIF v_suc.estado_sucesion = 'envejecimiento_alto' THEN
      v_score := v_score + 5;
      v_signals := v_signals || jsonb_build_object(
        'signal','envejecimiento_alto','delta',5,
        'evidence', jsonb_build_object('n_mayores_85',v_suc.n_mayores_85,'n_mayores_90',v_suc.n_mayores_90,'edad_media',v_suc.edad_media),
        'nota','concentración de mayores de 85 · herencias previsibles a medio plazo');
    END IF;
  END IF;

  v_score := greatest(0, least(100, v_score));

  RETURN jsonb_build_object(
    'score', round(v_score, 1),
    'breakdown', jsonb_build_object(
      'n_owners', v_n_owners,
      'n_contactados', v_n_contacted,
      'n_positivos', v_n_positive,
      'n_bloqueados', v_n_blocked,
      'n_impulsor', v_n_impulsor,
      'oferta_previa_edificio', v_oferta,
      'mayoria_vendedora', v_mayoria,
      'impulsor_edificio', v_impulsor_bld,
      'last_call_at', v_last_call_at,
      'last_call_hs_id', v_last_call_hs,
      'cobertura_pct', round(100 * v_cvg, 0),
      'sucesion', CASE WHEN v_suc.building_id IS NULL THEN NULL ELSE jsonb_build_object(
        'estado', v_suc.estado_sucesion,
        'n_fallecidos', v_suc.n_fallecidos,
        'n_probables', v_suc.n_probables,
        'n_mayores_85', v_suc.n_mayores_85,
        'n_mayores_90', v_suc.n_mayores_90,
        'edad_media', v_suc.edad_media,
        'pct_con_fecha', v_suc.pct_con_fecha
      ) END,
      'signals', v_signals,
      'formula', 'base 45 + escala propietarios + intención (mayoría, oferta, impulsor) - bloqueos suaves - cobertura suave + sucesión/envejecimiento (nunca penaliza) · clamp 0-100'
    )
  );
END $$;


--
-- Name: compute_score(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_score(p_building_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_row record;
  v_avisos jsonb := '[]'::jsonb;
  v_an public.building_analysis%ROWTYPE;
  v_has_ai boolean;
  v_activo numeric;
BEGIN
  SELECT * INTO v_row FROM public.v_building_score WHERE id = p_building_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- Score del activo: SIEMPRE desde score_raw (nunca desde el total ya ponderado).
  v_activo := v_row.score_raw;

  SELECT * INTO v_an FROM public.building_analysis WHERE building_id = p_building_id;
  v_has_ai := FOUND;

  IF v_has_ai THEN
    IF COALESCE(v_an.plantas_levantables,0) >= 2 THEN
      v_avisos := v_avisos || jsonb_build_object('key','elevable','label','Potencial de elevación','severity','high');
    END IF;
    IF v_an.esquina THEN
      v_avisos := v_avisos || jsonb_build_object('key','esquina','label','Edificio en esquina','severity','medium');
    END IF;
    IF v_an.segundas_escaleras THEN
      v_avisos := v_avisos || jsonb_build_object('key','doble_escalera','label','Dos escaleras detectadas','severity','medium');
    END IF;
    IF v_an.protegido_historicamente THEN
      v_avisos := v_avisos || jsonb_build_object('key','protegido','label','Protección histórica','severity','warn');
    END IF;
  ELSE
    v_avisos := v_avisos || jsonb_build_object('key','ai_pendiente','label','Análisis IA pendiente','severity','info');
  END IF;

  UPDATE public.buildings
  SET score_activo = v_activo,
      score_breakdown = v_row.score_breakdown,
      avisos_inteligentes = v_avisos,
      score_updated_at = now()
  WHERE id = p_building_id;

  RETURN v_activo;
END;
$$;


--
-- Name: FUNCTION compute_score(p_building_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.compute_score(p_building_id uuid) IS 'DEPRECATED: usar compute_cluster_score.';


--
-- Name: compute_score_total(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.compute_score_total(p_building_id uuid) RETURNS numeric
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_activo numeric; v_owner_score numeric; v_owner_result jsonb; v_total numeric;
BEGIN
  BEGIN v_activo := public.compute_score(p_building_id);
  EXCEPTION WHEN OTHERS THEN
    SELECT score_activo INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END;
  IF v_activo IS NULL THEN
    SELECT score_activo INTO v_activo FROM public.buildings WHERE id = p_building_id;
  END IF;

  v_owner_result := public.compute_owner_score(p_building_id);
  v_owner_score := (v_owner_result->>'score')::numeric;
  v_total := round(0.60 * coalesce(v_activo,0) + 0.40 * coalesce(v_owner_score,50), 1);

  UPDATE public.buildings
     SET score_activo = coalesce(v_activo, score_activo),
         score_propietarios = v_owner_score,
         score_propietarios_breakdown = v_owner_result->'breakdown',
         score_total = v_total,
         score = v_total,
         score_propietarios_updated_at = now()
   WHERE id = p_building_id;
  RETURN v_total;
END $$;


--
-- Name: count_distinct_owners(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_distinct_owners(p_building_id uuid) RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT (
    COALESCE((
      SELECT COUNT(DISTINCT COALESCE(
        NULLIF(public.normalize_person_name(o.nombre),''),
        NULLIF(upper(o.metadatos->>'nif'),''),
        NULLIF(upper(o.metadatos->>'dni'),''),
        NULLIF(lower(o.email),''),
        o.id::text
      ))
      FROM public.building_owners bo
      JOIN public.owners o ON o.id = bo.owner_id
      WHERE bo.building_id = p_building_id
        AND COALESCE(bo.rol_notas,'') NOT ILIKE '%representante%'
        AND COALESCE(bo.rol_notas,'') NOT ILIKE '%apoderado%'
    ),0)
    +
    COALESCE((
      SELECT COUNT(DISTINCT bc.company_id)
      FROM public.building_companies bc
      WHERE bc.building_id = p_building_id
        AND COALESCE(bc.role::text,'') IN ('titular','usufructuario','arrendador','otro')
    ),0)
  )::integer;
$$;


--
-- Name: count_distinct_owners_batch(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_distinct_owners_batch(p_building_ids uuid[]) RETURNS TABLE(building_id uuid, n integer)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT b.id AS building_id, public.count_distinct_owners(b.id) AS n
  FROM public.buildings b
  WHERE b.id = ANY(p_building_ids);
$$;


--
-- Name: count_pending_scoring_calls(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.count_pending_scoring_calls() RETURNS bigint
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT count(*)
  FROM public.calls c
  WHERE c.transcripcion IS NOT NULL
    AND c.transcripcion <> ''
    AND NOT (COALESCE(c.metadatos, '{}'::jsonb) ? 'post_call_scoring');
$$;


--
-- Name: current_user_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_user_role() RETURNS public.app_role
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin'::public.app_role THEN 1
    WHEN 'comercial_zona'::public.app_role THEN 2
    WHEN 'captacion'::public.app_role THEN 3
    WHEN 'prevalificacion'::public.app_role THEN 4
    WHEN 'viewer'::public.app_role THEN 5
    ELSE 9
  END
  LIMIT 1;
$$;


--
-- Name: dedup_owners_fuzzy(boolean, real, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.dedup_owners_fuzzy(p_dry_run boolean DEFAULT false, p_threshold real DEFAULT 0.7, p_building_id uuid DEFAULT NULL::uuid) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  pair record;
  v_pairs int := 0;
  v_merged int := 0;
  v_details jsonb;
  v_canonical uuid;
  v_loser uuid;
  v_canon_score int;
  v_loser_score int;
  v_reason text;
BEGIN
  FOR pair IN
    WITH candidates AS (
      SELECT DISTINCT o.id AS owner_id,
             public.normalize_person_name(o.nombre) AS nn,
             NULLIF(upper(COALESCE(o.metadatos->>'nif', o.metadatos->>'dni','')),'') AS nif,
             bo.building_id
        FROM public.owners o
        JOIN public.building_owners bo ON bo.owner_id = o.id
       WHERE o.merged_into IS NULL
         AND (p_building_id IS NULL OR bo.building_id = p_building_id)
    )
    SELECT a.owner_id AS a_id, b.owner_id AS b_id,
           a.nn AS a_nn, b.nn AS b_nn,
           a.nif AS a_nif, b.nif AS b_nif,
           a.building_id,
           (a.nif IS NOT NULL AND a.nif = b.nif) AS by_nif
      FROM candidates a
      JOIN candidates b
        ON a.building_id = b.building_id
       AND a.owner_id < b.owner_id
       AND a.nn IS NOT NULL AND b.nn IS NOT NULL
       AND (
         (a.nif IS NOT NULL AND a.nif = b.nif)
         OR public._owner_names_typo_match(a.nn, b.nn, p_threshold)
       )
  LOOP
    v_pairs := v_pairs + 1;
    IF EXISTS (SELECT 1 FROM public.owners WHERE id = pair.a_id AND merged_into IS NOT NULL)
       OR EXISTS (SELECT 1 FROM public.owners WHERE id = pair.b_id AND merged_into IS NOT NULL)
    THEN CONTINUE; END IF;

    SELECT (SELECT count(*) FROM public.external_ids WHERE entity_type='owner' AND entity_id=pair.a_id) * 1000
         + (SELECT count(*) FROM public.calls WHERE owner_id=pair.a_id) INTO v_canon_score;
    SELECT (SELECT count(*) FROM public.external_ids WHERE entity_type='owner' AND entity_id=pair.b_id) * 1000
         + (SELECT count(*) FROM public.calls WHERE owner_id=pair.b_id) INTO v_loser_score;

    IF v_canon_score >= v_loser_score THEN
      v_canonical := pair.a_id; v_loser := pair.b_id;
    ELSE
      v_canonical := pair.b_id; v_loser := pair.a_id;
    END IF;

    v_reason := CASE WHEN pair.by_nif THEN 'nif_match' ELSE 'fuzzy_name_typo' END;
    v_details := jsonb_build_object(
      'a_name', pair.a_nn, 'b_name', pair.b_nn,
      'nif', COALESCE(pair.a_nif, pair.b_nif), 'building_id', pair.building_id
    );

    IF p_dry_run THEN v_merged := v_merged + 1; CONTINUE; END IF;
    PERFORM public._merge_owner_pair(v_canonical, v_loser, v_reason, v_details);
    v_merged := v_merged + 1;
  END LOOP;

  RETURN jsonb_build_object('pairs_evaluated', v_pairs, 'merged', v_merged,
    'dry_run', p_dry_run, 'threshold', p_threshold, 'building_id', p_building_id);
END $$;


--
-- Name: detect_estado_vital_from_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_estado_vital_from_name(p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN p_name IS NULL THEN NULL
    WHEN p_name ~* '\yprobable\y[^a-z]{0,10}(fallecid|difunt)' THEN 'probable_fallecido'
    WHEN p_name ~* '(fallecid[oa]s?|difunt[oa]s?|\ye\.?\s*p\.?\s*d\.?\y|\yq\.?\s*e\.?\s*p\.?\s*d\.?\y)' THEN 'fallecido'
    ELSE NULL
  END;
$$;


--
-- Name: detect_guard_proposals(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_guard_proposals() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE g1 int; g2 int; g4 int; g6 int;
BEGIN
  g1 := public.detect_guarda_1();
  g2 := public.detect_guarda_2();
  g4 := public.detect_guarda_4();
  g6 := public.detect_guarda_6();
  INSERT INTO public.hubspot_sync_log (entity, started_at, finished_at, status, records_upserted, metadatos)
  VALUES ('guardas', now(), now(), 'ok', g1+g2+g4+g6,
          jsonb_build_object('guarda_1',g1,'guarda_2',g2,'guarda_4',g4,'guarda_6',g6,'modo','deteccion'));
  RETURN jsonb_build_object('guarda_1',g1,'guarda_2',g2,'guarda_4',g4,'guarda_6',g6);
END; $$;


--
-- Name: detect_guarda_1(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_guarda_1() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int := 0;
BEGIN
  WITH contactos AS (
    SELECT ei.provider_id AS hs_contact_id, o.id AS owner_id, o.nombre
    FROM public.external_ids ei
    JOIN public.owners o ON o.id = ei.entity_id
    WHERE ei.provider='hubspot' AND ei.entity_type='owner' AND ei.provider_object_type='contact'
      AND o.merged_into IS NULL
      AND (o.metadatos->>'hs_lead_status' IS NULL OR btrim(o.metadatos->>'hs_lead_status')='' OR o.metadatos->>'hs_lead_status'='No contactado')
  ), con_llamada AS (
    SELECT c.hs_contact_id, min(c.owner_id::text) AS owner_id, min(c.nombre) AS nombre,
           max(hc.hs_timestamp) AS ultima_llamada, count(*) AS n_llamadas
    FROM contactos c
    JOIN public.hubspot_calls hc ON c.hs_contact_id = ANY (hc.associated_contact_ids)
    WHERE (coalesce(hc.hs_call_duration,0) >= 30000 OR nullif(btrim(coalesce(hc.hs_call_body,'')),'') IS NOT NULL)
    GROUP BY 1
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, titulo, detalle, propuesta)
  SELECT 1, 'hubspot_contact', cl.hs_contact_id,
         coalesce(cl.nombre, 'Contacto ' || cl.hs_contact_id) || ' · estado de ciclo desactualizado',
         format('%s llamada(s) real(es), última el %s. Estado actual sin contactar.',
                cl.n_llamadas, coalesce(to_char(cl.ultima_llamada,'DD/MM/YYYY'),'fecha desconocida')),
         jsonb_build_object('accion','patch_contact','campo','hs_lead_status','valor','Contactado',
                            'hs_contact_id', cl.hs_contact_id, 'owner_id', cl.owner_id)
  FROM con_llamada cl
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;


--
-- Name: detect_guarda_2(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_guarda_2() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int := 0;
BEGIN
  WITH agg AS (
    SELECT bo.building_id, count(*) AS total, count(bo.cuota) AS con_cuota
    FROM public.building_owners bo GROUP BY 1
  )
  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 2, 'building', b.id::text, b.id,
         coalesce(b.direccion, 'Edificio ' || b.id::text) || ' · porcentajes sin cargar',
         format('%s de %s titulares con cuota. %s', a.con_cuota, a.total,
                CASE WHEN EXISTS (SELECT 1 FROM public.notas_simples ns WHERE ns.building_id = b.id)
                     THEN 'Hay nota simple atada: el dato existe pero no cuadra.'
                     ELSE 'Sin nota simple atada: conseguir nota.' END),
         jsonb_build_object('accion', CASE WHEN EXISTS (SELECT 1 FROM public.notas_simples ns WHERE ns.building_id = b.id)
                                           THEN 'revisar_nota' ELSE 'conseguir_nota' END,
                            'con_cuota', a.con_cuota, 'total', a.total)
  FROM agg a JOIN public.buildings b ON b.id = a.building_id
  WHERE a.total > 0 AND a.con_cuota::numeric < a.total::numeric * 0.5
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;


--
-- Name: detect_guarda_4(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_guarda_4() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int := 0;
BEGIN
  CREATE TEMP TABLE _g4_tareas ON COMMIT DROP AS
    SELECT DISTINCT ei.entity_id AS owner_id
    FROM public.hubspot_tasks ht
    JOIN LATERAL unnest(ht.associated_contact_ids) AS cid ON true
    JOIN public.external_ids ei ON ei.provider_id = cid
      AND ei.provider='hubspot' AND ei.entity_type='owner' AND ei.provider_object_type='contact'
    WHERE ht.hs_task_status = 'NOT_STARTED';

  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 4, 'building_owner', bo.owner_id::text || ':' || bo.building_id::text, bo.building_id,
         coalesce(o.nombre, 'Titular') || ' · titular con cuota sin tarea',
         format('Cuota %s%% en %s y sin próxima acción ni tarea abierta en HubSpot.',
                round(bo.cuota::numeric, 2), coalesce(b.direccion, 'edificio sin dirección')),
         jsonb_build_object('accion','crear_tarea','owner_id', bo.owner_id, 'building_id', bo.building_id, 'cuota', bo.cuota)
  FROM public.building_owners bo
  JOIN public.owners o ON o.id = bo.owner_id AND o.merged_into IS NULL
  JOIN public.buildings b ON b.id = bo.building_id
  WHERE bo.cuota IS NOT NULL
    AND coalesce(o.estado_vital, 'vivo') <> 'fallecido'
    AND NOT EXISTS (SELECT 1 FROM public.next_actions na WHERE na.owner_id = bo.owner_id AND na.estado = 'pendiente')
    AND NOT EXISTS (SELECT 1 FROM _g4_tareas t WHERE t.owner_id = bo.owner_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;


--
-- Name: detect_guarda_6(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.detect_guarda_6() RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE n int := 0;
BEGIN
  CREATE TEMP TABLE _g6_ce ON COMMIT DROP AS
    SELECT DISTINCT bo.building_id, ei.provider_id AS hs_contact_id
    FROM public.building_owners bo
    JOIN public.external_ids ei ON ei.entity_id = bo.owner_id
      AND ei.provider='hubspot' AND ei.entity_type='owner' AND ei.provider_object_type='contact';
  CREATE INDEX ON _g6_ce (hs_contact_id);
  CREATE INDEX ON _g6_ce (building_id);

  CREATE TEMP TABLE _g6_vivos ON COMMIT DROP AS
    SELECT building_id, max(ultima) AS ultima FROM (
      SELECT ce.building_id, max(hc.hs_timestamp) AS ultima
      FROM public.hubspot_calls hc
      JOIN LATERAL unnest(hc.associated_contact_ids) AS cid ON true
      JOIN _g6_ce ce ON ce.hs_contact_id = cid
      WHERE hc.hs_timestamp >= now() - interval '60 days'
      GROUP BY 1
      UNION ALL
      SELECT ei.entity_id, max(hc.hs_timestamp)
      FROM public.hubspot_calls hc
      JOIN LATERAL unnest(hc.associated_deal_ids) AS did ON true
      JOIN public.external_ids ei ON ei.provider_id = did
        AND ei.provider='hubspot' AND ei.entity_type='building' AND ei.provider_object_type='deal'
      WHERE hc.hs_timestamp >= now() - interval '60 days'
      GROUP BY 1
    ) s GROUP BY 1;

  INSERT INTO public.guard_proposals (guarda, entity_type, entity_id, edificio_id, titulo, detalle, propuesta)
  SELECT 6, 'building', b.id::text, b.id,
         coalesce(b.direccion, 'Edificio ' || b.id::text) || ' · operación viva sin próxima acción',
         format('Última llamada el %s y sin próxima acción pendiente ni tarea abierta en HubSpot.',
                to_char(v.ultima, 'DD/MM/YYYY')),
         jsonb_build_object('accion','definir_proxima_accion','building_id', b.id, 'ultima_llamada', v.ultima)
  FROM _g6_vivos v
  JOIN public.buildings b ON b.id = v.building_id
  WHERE NOT EXISTS (
      SELECT 1 FROM public.next_actions na
      WHERE na.estado='pendiente'
        AND (na.scope_id = b.id OR na.owner_id IN (SELECT bo.owner_id FROM public.building_owners bo WHERE bo.building_id = b.id)))
    AND NOT EXISTS (
      SELECT 1 FROM _g6_ce ce
      JOIN public.hubspot_tasks ht ON ce.hs_contact_id = ANY (ht.associated_contact_ids)
      WHERE ce.building_id = b.id AND ht.hs_task_status='NOT_STARTED')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END; $$;


--
-- Name: find_owner_for_orphan_contact(text, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.find_owner_for_orphan_contact(p_email text, p_phone text, p_first text, p_last text) RETURNS TABLE(owner_id uuid, method text, confidence numeric)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_id uuid;
  v_cnt int;
  v_phone_norm text;
  v_full text;
  v_sim numeric;
  v_next_sim numeric;
BEGIN
  -- Email exacto y único
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    SELECT count(*), min(o.id) INTO v_cnt, v_id
    FROM public.owners o
    WHERE lower(o.email) = lower(btrim(p_email))
      AND o.merged_into IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e
        WHERE e.entity_type = 'owner'
          AND e.entity_id = o.id
          AND e.provider = 'hubspot'
          AND e.provider_object_type = 'contact'
      );

    IF v_cnt = 1 THEN
      RETURN QUERY SELECT v_id, 'email'::text, 1.0::numeric;
      RETURN;
    END IF;
  END IF;

  -- Teléfono: últimos 9 dígitos, único
  v_phone_norm := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 9);
  IF length(v_phone_norm) = 9 THEN
    SELECT count(*), min(o.id) INTO v_cnt, v_id
    FROM public.owners o
    WHERE o.merged_into IS NULL
      AND o.telefono IS NOT NULL
      AND right(regexp_replace(o.telefono, '\D', '', 'g'), 9) = v_phone_norm
      AND NOT EXISTS (
        SELECT 1 FROM public.external_ids e
        WHERE e.entity_type = 'owner'
          AND e.entity_id = o.id
          AND e.provider = 'hubspot'
          AND e.provider_object_type = 'contact'
      );

    IF v_cnt = 1 THEN
      RETURN QUERY SELECT v_id, 'phone'::text, 0.95::numeric;
      RETURN;
    END IF;
  END IF;

  -- Nombre: similaridad trigrama, top-1 con margen frente al segundo candidato.
  v_full := public.normalize_person_name(concat_ws(' ', p_first, p_last));
  IF v_full IS NOT NULL AND length(v_full) >= 5 THEN
    WITH cand AS (
      SELECT
        o.id,
        similarity(public.normalize_person_name(o.nombre), v_full)::numeric AS sim
      FROM public.owners o
      WHERE o.merged_into IS NULL
        AND o.nombre IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.external_ids e
          WHERE e.entity_type = 'owner'
            AND e.entity_id = o.id
            AND e.provider = 'hubspot'
            AND e.provider_object_type = 'contact'
        )
        AND public.normalize_person_name(o.nombre) % v_full
    ), ranked AS (
      SELECT
        id,
        sim,
        row_number() OVER (ORDER BY sim DESC, id) AS rn,
        lead(sim) OVER (ORDER BY sim DESC, id) AS next_sim
      FROM cand
      ORDER BY sim DESC, id
      LIMIT 2
    )
    SELECT id, sim, next_sim
      INTO v_id, v_sim, v_next_sim
    FROM ranked
    WHERE rn = 1;

    IF v_id IS NOT NULL
       AND v_sim >= 0.75
       AND (v_next_sim IS NULL OR (v_sim - v_next_sim) >= 0.15) THEN
      RETURN QUERY SELECT v_id, 'name'::text, v_sim;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT NULL::uuid, 'none'::text, 0::numeric;
END;
$$;


--
-- Name: get_pending_scoring_calls(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.get_pending_scoring_calls(_limit integer DEFAULT 8) RETURNS TABLE(id uuid, comercial_email text, duracion_seg integer, transcripcion text, metadatos jsonb)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT c.id, c.comercial_email, c.duracion_seg, c.transcripcion, c.metadatos
  FROM public.calls c
  WHERE c.transcripcion IS NOT NULL
    AND c.transcripcion <> ''
    AND NOT (COALESCE(c.metadatos, '{}'::jsonb) ? 'post_call_scoring')
  ORDER BY c.fecha DESC
  LIMIT _limit;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  user_count INTEGER;
  assigned_role public.app_role;
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email)
  )
  ON CONFLICT (id) DO NOTHING;

  -- Reglas de rol:
  -- 1) Primer usuario del sistema = admin
  -- 2) jesus@afflux.es = comercial_zona (usuario de prueba)
  -- 3) Resto = viewer
  IF lower(NEW.email) = 'jesus@afflux.es' THEN
    assigned_role := 'comercial_zona'::public.app_role;
  ELSE
    SELECT COUNT(*) INTO user_count FROM public.profiles;
    IF user_count <= 1 THEN
      assigned_role := 'admin'::public.app_role;
    ELSE
      assigned_role := 'viewer'::public.app_role;
    END IF;
  END IF;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, assigned_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
END;
$$;


--
-- Name: has_oportunidades_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_oportunidades_access(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin'::public.app_role, 'whatsapp'::public.app_role,
                   'comercial_zona'::public.app_role, 'captacion'::public.app_role)
  )
$$;


--
-- Name: has_role(uuid, public.app_role); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;


--
-- Name: has_whatsapp_access(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.has_whatsapp_access(_user_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin'::public.app_role, 'whatsapp'::public.app_role)
  )
$$;


--
-- Name: iee_score_components(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.iee_score_components(p_building_id uuid) RETURNS TABLE(delta numeric, aviso jsonb, label text, estado text)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  b record;
  v_anios numeric;
  v_delta numeric := 0;
  v_aviso jsonb;
  v_label text;
BEGIN
  SELECT iee_estado, iee_fecha_inspeccion, iee_proxima_revision
    INTO b FROM public.buildings WHERE id = p_building_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0::numeric, NULL::jsonb, NULL::text, NULL::text; RETURN;
  END IF;
  v_anios := CASE WHEN b.iee_fecha_inspeccion IS NOT NULL
                  THEN EXTRACT(EPOCH FROM (now() - b.iee_fecha_inspeccion::timestamptz)) / (365.25*86400)
                  ELSE 0 END;
  IF b.iee_estado = 'favorable' THEN
    v_delta := 2;
    v_label := 'IEE favorable · próx. ' || to_char(b.iee_proxima_revision,'mon yyyy');
    v_aviso := jsonb_build_object('key','iee_favorable','label','IEE favorable','severity','info',
      'detail','Próxima revisión: ' || to_char(b.iee_proxima_revision,'YYYY-MM-DD') || '.');
  ELSIF b.iee_estado = 'caducada' THEN
    v_delta := -6;
    v_label := 'IEE caducada';
    v_aviso := jsonb_build_object('key','iee_caducada','label','IEE caducada','severity','high',
      'detail','IEE caducada desde ' || to_char(b.iee_proxima_revision,'YYYY-MM-DD') || '. Obligación incumplida.');
  ELSIF b.iee_estado = 'pendiente' THEN
    v_delta := -8;
    v_label := 'IEE pendiente';
    v_aviso := jsonb_build_object('key','iee_pendiente','label','IEE nunca presentada','severity','high',
      'detail','Edificio obligado sin IEE presentado.');
  ELSIF b.iee_estado = 'desfavorable_leve' THEN
    v_delta := -5 - LEAST(5, floor(v_anios)::numeric);
    v_label := 'IEE desfavorable (leve) · ' || round(v_anios,1)::text || ' a';
    v_aviso := jsonb_build_object('key','iee_desfavorable_leve','label','IEE desfavorable (leve)','severity','medium',
      'detail','Desde ' || to_char(b.iee_fecha_inspeccion,'YYYY-MM-DD') || ' (' || round(v_anios,1)::text || ' años sin corregir).');
  ELSIF b.iee_estado = 'desfavorable_grave' THEN
    v_delta := -10 - LEAST(10, floor(v_anios*1.5)::numeric);
    v_label := 'IEE desfavorable (grave) · ' || round(v_anios,1)::text || ' a';
    v_aviso := jsonb_build_object('key','iee_desfavorable_grave','label','IEE desfavorable (grave)','severity','high',
      'detail','Desde ' || to_char(b.iee_fecha_inspeccion,'YYYY-MM-DD') || ' (' || round(v_anios,1)::text || ' años sin corregir).');
  ELSE
    v_label := NULL; v_aviso := NULL;
  END IF;
  RETURN QUERY SELECT v_delta, v_aviso, v_label, b.iee_estado::text;
END;
$$;


--
-- Name: integridad_alertas_pendientes(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.integridad_alertas_pendientes() RETURNS TABLE(issue_key text, detalle text, severidad text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  CREATE TEMP TABLE _problemas ON COMMIT DROP AS
  WITH esperados(entity, max_edad) AS (VALUES
    ('calls_inc', interval '20 minutes'), ('notes_inc', interval '20 minutes'),
    ('tasks_inc', interval '20 minutes'), ('communications_inc', interval '20 minutes'),
    ('meetings_inc', interval '20 minutes'), ('contacts_inc', interval '50 minutes'),
    ('deals_inc', interval '50 minutes'), ('companies_inc', interval '3 hours')
  ), estado AS (
    SELECT e.entity, e.max_edad, s.last_run_at, s.last_run_status, s.last_error
    FROM esperados e LEFT JOIN hubspot_sync_state s ON s.entity = e.entity
  ), ultimo_cron AS (
    SELECT DISTINCT ON (jobid) jobid, status, return_message, start_time
    FROM cron.job_run_details ORDER BY jobid, start_time DESC
  ), ultimo_log AS (
    SELECT DISTINCT ON (entity) entity, status, error_message, finished_at
    FROM hubspot_sync_log WHERE entity <> 'integrity_watchdog'
    ORDER BY entity, coalesce(finished_at, started_at) DESC NULLS LAST
  ), sin_analizar AS (
    SELECT count(*) AS n FROM hubspot_calls hc
    WHERE nullif(hc.hs_call_transcription,'') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM call_sessions cs WHERE cs.hubspot_call_id = hc.hs_id)
      AND EXISTS (
        SELECT 1 FROM unnest(hc.associated_contact_ids) AS cid
        JOIN external_ids e ON e.provider_id = cid AND e.entity_type = 'owner' AND e.provider = 'hubspot'
        JOIN building_owners bo ON bo.owner_id = e.entity_id)
  )
  SELECT k, d, sev FROM (
    SELECT 'sync_parado:'||e.entity AS k,
      'El flujo '||e.entity||' lleva sin correr desde '||
      coalesce(to_char(e.last_run_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI'),'nunca')||
      CASE WHEN e.last_run_status='error' THEN ' · ERROR: '||left(coalesce(e.last_error,''),150) ELSE '' END AS d,
      CASE WHEN e.last_run_status='error' THEN 'ERROR' ELSE 'AVISO' END AS sev
    FROM estado e
    WHERE (e.last_run_at IS NULL AND e.entity IN ('calls_inc','notes_inc','tasks_inc','contacts_inc'))
       OR (e.last_run_at IS NOT NULL AND e.last_run_at < now() - e.max_edad)
       OR e.last_run_status = 'error'
    UNION ALL
    SELECT 'cron_fallando:'||j.jobname,
      'El cron '||j.jobname||' falló el '||to_char(u.start_time AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')||': '||left(coalesce(u.return_message,''),150),
      'ERROR'
    FROM cron.job j JOIN ultimo_cron u ON u.jobid = j.jobid
    WHERE j.active AND u.status = 'failed' AND u.start_time > now() - interval '24 hours'
    UNION ALL
    SELECT 'proceso_en_error:'||l.entity,
      'El último intento de '||l.entity||' ('||to_char(l.finished_at AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI')||') falló: '||left(coalesce(l.error_message,''),200),
      'ERROR'
    FROM ultimo_log l
    WHERE l.status = 'error' AND l.finished_at > now() - interval '7 days'
    UNION ALL
    SELECT 'sin_llamadas_48h',
      'No entra ninguna llamada nueva desde '||to_char(max(hs_timestamp) AT TIME ZONE 'Europe/Madrid','DD/MM HH24:MI'),
      'AVISO'
    FROM hubspot_calls HAVING max(hs_timestamp) < now() - interval '48 hours'
    UNION ALL
    SELECT 'llamadas_sin_analizar',
      'Hay '||n||' llamadas transcritas de propietarios nuestros SIN análisis ni score', 'CALIDAD'
    FROM sin_analizar WHERE n > 25
    -- === controles registrales separados (sustituyen a notas_sin_volcar_pct) ===
    UNION ALL
    SELECT 'derechos_sin_clasificar',
      'Hay '||count(*)||' derechos registrales sin clasificar (tipo "otro") pendientes de revisión manual', 'CALIDAD'
    FROM building_property_rights WHERE status='active' AND right_type='otro' HAVING count(*) > 0
    UNION ALL
    SELECT 'capa_pleno_incompleta',
      'Hay '||count(*)||' edificios cuya capa de pleno dominio no suma 100% en la nota simple', 'CALIDAD'
    FROM (SELECT building_id FROM v_rights_layer_check
          WHERE right_type IN ('pleno_dominio','ganancial') AND NOT capa_100
          GROUP BY building_id) x HAVING count(*) > 10
    UNION ALL
    SELECT 'sociedades_sin_derecho_enlazado',
      'Hay '||count(*)||' titulares sociedad sin empresa enlazada en el CRM', 'CALIDAD'
    FROM building_property_rights
    WHERE status='active' AND owner_id IS NULL AND company_id IS NULL AND identity_match = 'ninguno'
    HAVING count(*) > 0
    UNION ALL
    SELECT 'personas_sin_match',
      'Hay '||count(*)||' titulares persona de nota simple sin contacto identificado en el CRM', 'CALIDAD'
    FROM building_property_rights
    WHERE status='active' AND owner_id IS NULL AND company_id IS NULL AND identity_match IN ('aproximado','ninguno')
    HAVING count(*) > 50
    UNION ALL
    SELECT 'cuotas_operativas_contradictorias',
      'Hay '||count(*)||' cuotas de ficha que contradicen la nota simple (marcadas superseded/review, no usadas para score)', 'CALIDAD'
    FROM building_owners WHERE cuota_estado IN ('superseded','review') HAVING count(*) > 0
    UNION ALL
    SELECT 'reparse_dead_letter',
      'Hay '||count(*)||' notas simples descartadas tras 5 intentos fallidos de relectura', 'CALIDAD'
    FROM notas_simples WHERE dead_letter HAVING count(*) > 0
    UNION ALL
    SELECT 'consentimientos_desincronizados',
      'Hay '||count(*)||' consentimientos de WhatsApp sin reflejar en la ficha del propietario', 'CALIDAD'
    FROM wa_consent_signals w JOIN owners o ON o.id = w.owner_id
    WHERE w.veredicto = 'autorizado' AND coalesce(o.consentimiento,false) = false
    HAVING count(*) > 0
    UNION ALL
    SELECT 'wa_sin_escribir_hubspot',
      'Hay '||count(*)||' consentimientos autorizados sin escribir en HubSpot', 'AVISO'
    FROM wa_consent_signals WHERE veredicto = 'autorizado' AND NOT escrito_en_hubspot
    HAVING count(*) > 5
  ) q(k, d, sev);

  -- autocierre SIN borrar historial
  UPDATE integrity_alert_log l
     SET resolved_at = now()
   WHERE l.resolved_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM _problemas p WHERE p.k = l.issue_key);

  -- reapertura si vuelve a aparecer
  UPDATE integrity_alert_log l
     SET resolved_at = NULL
   WHERE l.resolved_at IS NOT NULL
     AND EXISTS (SELECT 1 FROM _problemas p WHERE p.k = l.issue_key);

  RETURN QUERY
  SELECT p.k, p.d, p.sev FROM _problemas p
  LEFT JOIN integrity_alert_log l ON l.issue_key = p.k
  WHERE l.last_sent_at IS NULL OR l.resolved_at IS NOT NULL OR l.last_sent_at < now() - interval '6 hours';
END $$;


--
-- Name: madrid_plantas_max(numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.madrid_plantas_max(ancho_m numeric) RETURNS integer
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE
    WHEN ancho_m IS NULL THEN NULL
    WHEN ancho_m > 20 THEN 7
    WHEN ancho_m >= 12 THEN 6
    WHEN ancho_m >= 8 THEN 5
    ELSE 4
  END;
$$;


--
-- Name: match_building_fuzzy(text, text, real); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_building_fuzzy(p_direccion text, p_ciudad text DEFAULT NULL::text, p_threshold real DEFAULT 0.35) RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  SELECT b.id
  FROM public.buildings b
  WHERE b.direccion IS NOT NULL
    AND length(coalesce(p_direccion,'')) > 6
    AND (p_ciudad IS NULL OR b.ciudad ILIKE '%' || p_ciudad || '%' OR similarity(b.ciudad, p_ciudad) > 0.4)
    AND similarity(b.direccion, p_direccion) > p_threshold
  ORDER BY similarity(b.direccion, p_direccion) DESC
  LIMIT 1;
$$;


--
-- Name: match_knowledge_chunks(public.vector, integer, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_knowledge_chunks(query_embedding public.vector, match_count integer DEFAULT 5, filter_scope_type text DEFAULT NULL::text, filter_scope_id uuid DEFAULT NULL::uuid) RETURNS TABLE(id uuid, contenido text, origen text, scope_type text, scope_id uuid, metadatos jsonb, similarity double precision)
    LANGUAGE sql STABLE
    SET search_path TO 'public'
    AS $$
  SELECT
    kc.id,
    kc.contenido,
    kc.origen,
    kc.scope_type,
    kc.scope_id,
    kc.metadatos,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_scope_type IS NULL OR kc.scope_type = filter_scope_type)
    AND (filter_scope_id IS NULL OR kc.scope_id = filter_scope_id)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count;
$$;


--
-- Name: match_knowledge_chunks(public.vector, integer, text[], text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_knowledge_chunks(query_embedding public.vector, match_count integer DEFAULT 6, filter_origenes text[] DEFAULT NULL::text[], filter_scope_type text DEFAULT NULL::text, filter_scope_id uuid DEFAULT NULL::uuid) RETURNS TABLE(chunk_id uuid, source text, snippet text, metadatos jsonb, similarity double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT
    kc.id AS chunk_id,
    kc.origen AS source,
    kc.contenido AS snippet,
    kc.metadatos,
    1 - (kc.embedding <=> query_embedding) AS similarity
  FROM public.knowledge_chunks kc
  WHERE kc.embedding IS NOT NULL
    AND (filter_origenes IS NULL OR kc.origen = ANY(filter_origenes))
    AND (filter_scope_type IS NULL OR kc.scope_type = filter_scope_type)
    AND (filter_scope_id IS NULL OR kc.scope_id = filter_scope_id)
  ORDER BY kc.embedding <=> query_embedding
  LIMIT match_count
$$;


--
-- Name: match_owner_by_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.match_owner_by_phone(p_phone text) RETURNS TABLE(owner_id uuid, owner_nombre text, match_status text, buildings jsonb)
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_norm text;
  v_count int;
  v_owner_id uuid;
  v_owner_nombre text;
  v_buildings jsonb;
BEGIN
  v_norm := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 9);
  IF v_norm IS NULL OR length(v_norm) < 9 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'none'::text, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT count(*), min(o.id)
    INTO v_count, v_owner_id
  FROM public.owners o
  WHERE o.telefono IS NOT NULL
    AND right(regexp_replace(o.telefono, '\D', '', 'g'), 9) = v_norm
    AND o.merged_into IS NULL;

  IF v_count = 0 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'none'::text, '[]'::jsonb;
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, 'ambiguous'::text, '[]'::jsonb;
    RETURN;
  END IF;

  SELECT nombre INTO v_owner_nombre FROM public.owners WHERE id = v_owner_id;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'building_id', b.id,
    'direccion', b.direccion,
    'cuota', bo.cuota
  ) ORDER BY bo.cuota DESC NULLS LAST), '[]'::jsonb)
    INTO v_buildings
  FROM public.building_owners bo
  JOIN public.buildings b ON b.id = bo.building_id
  WHERE bo.owner_id = v_owner_id;

  RETURN QUERY SELECT v_owner_id, v_owner_nombre, 'matched'::text, v_buildings;
END;
$$;


--
-- Name: merge_duplicate_owners(boolean); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.merge_duplicate_owners(p_dry_run boolean DEFAULT false) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  grp record;
  r record;
  v_canonical uuid;
  v_groups int := 0;
  v_merged int := 0;
BEGIN
  FOR grp IN
    WITH n AS (
      SELECT id, nombre, created_at,
             public.normalize_person_name(nombre) AS nrm,
             COALESCE(NULLIF(upper(metadatos->>'nif'),''), NULLIF(upper(metadatos->>'dni'),'')) AS nif,
             (EXISTS (SELECT 1 FROM public.external_ids e
                       WHERE e.entity_type='owner' AND e.entity_id=owners.id
                         AND e.provider='hubspot')) AS has_hs
      FROM public.owners
      WHERE merged_into IS NULL
    )
    SELECT nrm,
           array_agg(id ORDER BY has_hs DESC, created_at ASC) AS ids,
           array_agg(nif) FILTER (WHERE nif IS NOT NULL) AS nifs
    FROM n
    WHERE nrm IS NOT NULL AND nrm <> ''
    GROUP BY nrm
    HAVING COUNT(*) > 1
  LOOP
    v_groups := v_groups + 1;
    v_canonical := grp.ids[1];

    FOR r IN SELECT unnest(grp.ids[2:array_length(grp.ids,1)]) AS loser LOOP
      IF p_dry_run THEN v_merged := v_merged + 1; CONTINUE; END IF;

      -- external_ids: mover sólo si no choca con NINGUNO de los dos UNIQUE.
      -- 1) Mismo provider_id (provider, provider_object_type, provider_id) ya existe → drop
      -- 2) Canónico ya tiene una entrada para (provider, provider_object_type) sobre sí mismo → drop
      UPDATE public.external_ids e
        SET entity_id = v_canonical
        WHERE e.entity_type='owner' AND e.entity_id = r.loser
          AND NOT EXISTS (
            SELECT 1 FROM public.external_ids e2
            WHERE e2.entity_type='owner' AND e2.entity_id = v_canonical
              AND e2.provider = e.provider
              AND e2.provider_object_type = e.provider_object_type
              AND e2.provider_id = e.provider_id
          )
          AND NOT EXISTS (
            SELECT 1 FROM public.external_ids e3
            WHERE e3.entity_type='owner' AND e3.entity_id = v_canonical
              AND e3.provider = e.provider
              AND e3.provider_object_type = e.provider_object_type
          );
      DELETE FROM public.external_ids
        WHERE entity_type='owner' AND entity_id = r.loser;

      UPDATE public.calls               SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.notes               SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.notas_simples       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.nota_simple_titulares SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.call_sessions       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.cadence_steps       SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.whatsapp_messages   SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.assets              SET owner_id = v_canonical WHERE owner_id = r.loser;
      UPDATE public.next_actions        SET owner_id = v_canonical WHERE owner_id = r.loser;

      DELETE FROM public.owner_companies a
        WHERE a.owner_id = r.loser
          AND EXISTS (SELECT 1 FROM public.owner_companies b
                       WHERE b.owner_id = v_canonical AND b.company_id=a.company_id AND b.role=a.role);
      UPDATE public.owner_companies SET owner_id = v_canonical WHERE owner_id = r.loser;

      UPDATE public.owner_relations SET owner_a_id = v_canonical WHERE owner_a_id = r.loser AND owner_b_id <> v_canonical;
      UPDATE public.owner_relations SET owner_b_id = v_canonical WHERE owner_b_id = r.loser AND owner_a_id <> v_canonical;
      DELETE FROM public.owner_relations WHERE owner_a_id = r.loser OR owner_b_id = r.loser;

      -- building_owners: fusión por edificio
      UPDATE public.building_owners bc
      SET cuota = GREATEST(COALESCE(bc.cuota,0), COALESCE(bl.cuota,0)),
          es_influencer = bc.es_influencer OR bl.es_influencer,
          influencer_score = GREATEST(COALESCE(bc.influencer_score,0), COALESCE(bl.influencer_score,0)),
          rol_notas = COALESCE(bc.rol_notas, bl.rol_notas),
          metadatos = bc.metadatos || bl.metadatos
      FROM public.building_owners bl
      WHERE bl.owner_id = r.loser
        AND bc.owner_id = v_canonical
        AND bc.building_id = bl.building_id;

      DELETE FROM public.building_owners
        WHERE owner_id = r.loser
          AND building_id IN (SELECT building_id FROM public.building_owners WHERE owner_id = v_canonical);
      UPDATE public.building_owners SET owner_id = v_canonical WHERE owner_id = r.loser;

      INSERT INTO public.owner_merge_audit (canonical_owner_id, merged_owner_id, name_norm, nif, reason)
      VALUES (v_canonical, r.loser, grp.nrm,
              (SELECT n FROM unnest(grp.nifs) n LIMIT 1),
              'name_norm_match');

      UPDATE public.owners
      SET merged_into = v_canonical,
          metadatos = COALESCE(metadatos,'{}'::jsonb) || jsonb_build_object('merged_into', v_canonical, 'merged_at', now())
      WHERE id = r.loser;

      v_merged := v_merged + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('groups', v_groups, 'merged', v_merged);
END $$;


--
-- Name: norm_addr(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.norm_addr(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  SELECT nullif(btrim(regexp_replace(
    regexp_replace(
      lower(translate(coalesce(p,''),'áéíóúüñàèìòùçÁÉÍÓÚÜÑÀÈÌÒÙÇ','aeiouunaeioucAEIOUUNAEIOUC')),
      '(^|[^a-z0-9])(calle|c/|avenida|avda|av|paseo|pº|plaza|pza|pl|camino|carrer|travesia|glorieta|ronda|de|del|la|las|los|el)([^a-z0-9]|$)',
      ' ', 'g'),
    '[^a-z0-9]+', ' ', 'g')), '')
$_$;


--
-- Name: norm_person_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.norm_person_name(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT nullif(
    regexp_replace(
      regexp_replace(
        upper(translate(coalesce(p,''),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
          'AAAAAEEEEIIIIOOOOOUUUUNCAAAAAEEEEIIIIOOOOOUUUUNC')),
        '\m(DON|DONA|DOÑA|SR|SRA|D)\M\.?', ' ', 'g'),
      '[^A-Z0-9]+', ' ', 'g')
  , '');
$$;


--
-- Name: norm_phone(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.norm_phone(t text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT NULLIF(regexp_replace(regexp_replace(COALESCE(t,''), '\D','','g'), '^34',''), '');
$$;


--
-- Name: normalize_barrio(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_barrio(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $_$
  SELECT NULLIF(
    regexp_replace(
      upper(
        translate(
          regexp_replace(coalesce(p,''), '\s*\([^)]*\)\s*$', '', 'g'),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
          'AAAAAEEEEIIIIOOOOOUUUUNC'
        )
      ),
      '[^A-Z0-9]', '', 'g'
    ),
    ''
  );
$_$;


--
-- Name: normalize_catastro(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_catastro(p text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'public'
    AS $$
  SELECT NULLIF(regexp_replace(upper(coalesce(p, '')), '[^A-Z0-9]', '', 'g'), '');
$$;


--
-- Name: normalize_pct_propiedad(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_pct_propiedad(raw text) RETURNS TABLE(pct numeric, normalizado boolean, invalido boolean, raw_value text)
    LANGUAGE plpgsql IMMUTABLE
    AS $_$
DECLARE
  s text;
  num numeric;
  denom numeric;
  v numeric;
  m text[];
BEGIN
  raw_value := raw;
  IF raw IS NULL THEN
    pct := NULL; normalizado := false; invalido := false; RETURN NEXT; RETURN;
  END IF;
  s := btrim(raw);
  IF s = '' OR s = '-' THEN
    pct := NULL; normalizado := false; invalido := false; RETURN NEXT; RETURN;
  END IF;
  IF s = '0' OR s = '0%' OR s = '0,0' OR s = '0.0' THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  END IF;

  m := regexp_match(s, '^(\d+)\s*/\s*(\d+)$');
  IF m IS NOT NULL THEN
    num := m[1]::numeric; denom := m[2]::numeric;
    IF denom > 0 AND num <= denom THEN
      pct := round(num/denom*100, 2); normalizado := true; invalido := false; RETURN NEXT; RETURN;
    ELSE
      pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
    END IF;
  END IF;

  s := replace(replace(s, '%', ''), ',', '.');
  m := regexp_match(s, '(-?\d+(?:\.\d+)?)');
  IF m IS NULL THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  END IF;
  BEGIN
    v := m[1]::numeric;
  EXCEPTION WHEN OTHERS THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  END;

  IF v <= 0 THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  ELSIF v <= 1 THEN
    pct := round(v*100, 2); normalizado := true; invalido := false; RETURN NEXT; RETURN;
  ELSIF v = 100 THEN
    pct := 100; normalizado := false; invalido := false; RETURN NEXT; RETURN;
  ELSIF v > 100 AND v < 10000 THEN
    pct := round(v/100, 2); normalizado := true; invalido := false; RETURN NEXT; RETURN;
  ELSIF v >= 10000 THEN
    pct := NULL; normalizado := false; invalido := true; RETURN NEXT; RETURN;
  ELSE
    pct := round(v, 2); normalizado := false; invalido := false; RETURN NEXT; RETURN;
  END IF;
END;
$_$;


--
-- Name: normalize_person_name(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.normalize_person_name(p text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  SELECT NULLIF(
    array_to_string(
      ARRAY(
        SELECT t FROM unnest(
          string_to_array(
            regexp_replace(
              lower(translate(coalesce(p,''),
                'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ',
                'aaaaaeeeeiiiioooooouuuuncaaaaaeeeeiiiioooooouuuunc')),
              '[^a-z0-9 ]+', ' ', 'g'
            ), ' '
          )
        ) AS t
        WHERE length(t) > 1
        ORDER BY t
      ), ' '
    ),
    ''
  );
$$;


--
-- Name: nota_evidence_snippet(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.nota_evidence_snippet(p_nota_id uuid, p_nombre text) RETURNS jsonb
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
DECLARE v_txt text; v_key text; v_pos int := 0; v_snip text;
BEGIN
  SELECT raw_pdf_text INTO v_txt FROM notas_simples WHERE id = p_nota_id;
  IF v_txt IS NULL OR length(v_txt) < 20 OR p_nombre IS NULL THEN
    RETURN jsonb_build_object('nota_simple_id', p_nota_id, 'encontrado', false, 'fuente', 'structured_json');
  END IF;
  v_key := upper(btrim(left(regexp_replace(p_nombre, '\s*\(.*$', ''), 24)));
  v_pos := position(v_key in upper(v_txt));
  IF v_pos = 0 THEN
    v_key := upper(split_part(btrim(p_nombre), ' ', 1));
    IF length(v_key) >= 4 THEN v_pos := position(v_key in upper(v_txt)); END IF;
  END IF;
  IF v_pos = 0 THEN
    RETURN jsonb_build_object('nota_simple_id', p_nota_id, 'encontrado', false, 'fuente', 'raw_pdf_text');
  END IF;
  v_snip := btrim(regexp_replace(substr(v_txt, greatest(1, v_pos - 160), 440), '\s+', ' ', 'g'));
  RETURN jsonb_build_object(
    'nota_simple_id', p_nota_id, 'encontrado', true, 'fuente', 'raw_pdf_text',
    'char_offset', v_pos, 'cita', v_snip);
END $_$;


--
-- Name: notas_simples_kpis(text, text, timestamp with time zone, timestamp with time zone, uuid, uuid, text, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notas_simples_kpis(p_status text DEFAULT NULL::text, p_riesgo text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_building_id uuid DEFAULT NULL::uuid, p_owner_id uuid DEFAULT NULL::uuid, p_tipo_carga text DEFAULT NULL::text, p_divisible text DEFAULT NULL::text, p_search text DEFAULT NULL::text) RETURNS TABLE(total bigint, listas bigint, riesgo_alto bigint, sin_edificio bigint, importe_cargas numeric)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $_$
  WITH filtered AS (
    SELECT n.*
    FROM public.notas_simples n
    WHERE (p_status IS NULL OR n.status = p_status)
      AND (p_riesgo IS NULL OR n.riesgo = p_riesgo)
      AND (p_from IS NULL OR n.created_at >= p_from)
      AND (p_to IS NULL OR n.created_at <= p_to)
      AND (p_building_id IS NULL OR n.building_id = p_building_id)
      AND (p_owner_id IS NULL OR n.owner_id = p_owner_id)
      AND (
        p_tipo_carga IS NULL OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'cargas','[]'::jsonb)) c
          WHERE lower(c->>'tipo') = lower(p_tipo_carga)
        )
      )
      AND (
        p_divisible IS NULL OR
        (n.structured_json->>'divisible') = p_divisible
      )
      AND (
        p_search IS NULL OR p_search = '' OR
        (n.structured_json->'finca'->>'ref_catastral') ILIKE '%'||p_search||'%' OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'titulares','[]'::jsonb)) t
          WHERE (t->>'nombre') ILIKE '%'||p_search||'%'
        ) OR
        EXISTS (
          SELECT 1 FROM public.buildings b
          WHERE b.id = n.building_id
            AND (b.direccion ILIKE '%'||p_search||'%' OR b.ciudad ILIKE '%'||p_search||'%')
        )
      )
  )
  SELECT
    COUNT(*)::bigint AS total,
    COUNT(*) FILTER (WHERE status = 'listo')::bigint AS listas,
    COUNT(*) FILTER (WHERE riesgo = 'alto')::bigint AS riesgo_alto,
    COUNT(*) FILTER (WHERE building_id IS NULL)::bigint AS sin_edificio,
    COALESCE((
      SELECT SUM( (c->>'importe')::numeric )
      FROM filtered f, jsonb_array_elements(COALESCE(f.structured_json->'cargas','[]'::jsonb)) c
      WHERE (c->>'importe') ~ '^-?\d+(\.\d+)?$'
    ), 0)::numeric AS importe_cargas
  FROM filtered;
$_$;


--
-- Name: notas_simples_search(text, text, timestamp with time zone, timestamp with time zone, uuid, uuid, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notas_simples_search(p_status text DEFAULT NULL::text, p_riesgo text DEFAULT NULL::text, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_building_id uuid DEFAULT NULL::uuid, p_owner_id uuid DEFAULT NULL::uuid, p_tipo_carga text DEFAULT NULL::text, p_divisible text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, created_at timestamp with time zone, processed_at timestamp with time zone, status text, riesgo text, file_url text, building_id uuid, owner_id uuid, structured_json jsonb, error_message text, building_direccion text, building_ciudad text, owner_nombre text, total_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH filtered AS (
    SELECT n.*
    FROM public.notas_simples n
    WHERE (p_status IS NULL OR n.status = p_status)
      AND (p_riesgo IS NULL OR n.riesgo = p_riesgo)
      AND (p_from IS NULL OR n.created_at >= p_from)
      AND (p_to IS NULL OR n.created_at <= p_to)
      AND (p_building_id IS NULL OR n.building_id = p_building_id)
      AND (p_owner_id IS NULL OR n.owner_id = p_owner_id)
      AND (
        p_tipo_carga IS NULL OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'cargas','[]'::jsonb)) c
          WHERE lower(c->>'tipo') = lower(p_tipo_carga)
        )
      )
      AND (
        p_divisible IS NULL OR (n.structured_json->>'divisible') = p_divisible
      )
      AND (
        p_search IS NULL OR p_search = '' OR
        (n.structured_json->'finca'->>'ref_catastral') ILIKE '%'||p_search||'%' OR
        EXISTS (
          SELECT 1 FROM jsonb_array_elements(COALESCE(n.structured_json->'titulares','[]'::jsonb)) t
          WHERE (t->>'nombre') ILIKE '%'||p_search||'%'
        ) OR
        EXISTS (
          SELECT 1 FROM public.buildings b
          WHERE b.id = n.building_id
            AND (b.direccion ILIKE '%'||p_search||'%' OR b.ciudad ILIKE '%'||p_search||'%')
        )
      )
  ), counted AS (
    SELECT COUNT(*)::bigint AS total FROM filtered
  )
  SELECT
    f.id, f.created_at, f.processed_at, f.status, f.riesgo, f.file_url,
    f.building_id, f.owner_id, f.structured_json, f.error_message,
    b.direccion AS building_direccion,
    b.ciudad AS building_ciudad,
    o.nombre AS owner_nombre,
    (SELECT total FROM counted) AS total_count
  FROM filtered f
  LEFT JOIN public.buildings b ON b.id = f.building_id
  LEFT JOIN public.owners o ON o.id = f.owner_id
  ORDER BY f.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$$;


--
-- Name: owner_last_activity_at(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owner_last_activity_at(_owner_id uuid) RETURNS timestamp with time zone
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH hs AS (
    SELECT array_agg(provider_id) AS ids
    FROM public.external_ids
    WHERE entity_type = 'owner' AND entity_id = _owner_id AND provider = 'hubspot'
  ),
  vals AS (
    SELECT MAX(fecha) AS t FROM public.calls WHERE owner_id = _owner_id
    UNION ALL
    SELECT MAX(GREATEST(coalesce(hs_timestamp,'-infinity'::timestamptz), coalesce(hs_lastmodifieddate,'-infinity'::timestamptz)))
    FROM public.hubspot_calls hc, hs
    WHERE hs.ids IS NOT NULL AND hc.associated_contact_ids && hs.ids
    UNION ALL
    SELECT MAX(GREATEST(coalesce(hs_timestamp,'-infinity'::timestamptz), coalesce(hs_lastmodifieddate,'-infinity'::timestamptz)))
    FROM public.hubspot_notes hn, hs
    WHERE hs.ids IS NOT NULL AND hn.associated_contact_ids && hs.ids
    UNION ALL
    SELECT MAX(GREATEST(coalesce(hs_timestamp,'-infinity'::timestamptz), coalesce(hs_lastmodifieddate,'-infinity'::timestamptz)))
    FROM public.hubspot_whatsapp hw, hs
    WHERE hs.ids IS NOT NULL AND hw.associated_contact_ids && hs.ids
    UNION ALL
    SELECT GREATEST(o.updated_at, o.created_at) FROM public.owners o WHERE o.id = _owner_id
  )
  SELECT MAX(t) FROM vals;
$$;


--
-- Name: owners_maintain_display_and_estado(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.owners_maintain_display_and_estado() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_detected text;
BEGIN
  -- Nombre limpio para pintar
  NEW.nombre_display := coalesce(public.clean_owner_name(NEW.nombre), NEW.nombre);

  -- Estado vital derivado del nombre (solo si no lo han fijado ya a fallecido/probable manualmente y el detector encuentra algo)
  v_detected := public.detect_estado_vital_from_name(NEW.nombre);
  IF v_detected IS NOT NULL AND coalesce(NEW.estado_vital, 'activo') = 'activo' THEN
    NEW.estado_vital := v_detected;
    NEW.estado_vital_fuente := coalesce(NEW.estado_vital_fuente, 'marca_manual_nombre_hubspot');
    NEW.estado_vital_fecha := coalesce(NEW.estado_vital_fecha, now());
    NEW.estado_vital_evidencia := coalesce(NEW.estado_vital_evidencia, 'Marca en el nombre original: ' || NEW.nombre);
  END IF;

  -- edad_anios derivada de fecha_nacimiento
  IF NEW.fecha_nacimiento IS NOT NULL THEN
    NEW.edad_anios := extract(year from age(NEW.fecha_nacimiento))::int;
  END IF;

  RETURN NEW;
END;
$$;


--
-- Name: p0_mark_cuota_eligibility(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.p0_mark_cuota_eligibility() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v int;
BEGIN
  UPDATE public.building_property_rights r
  SET feeds_cuota = false,
      blocked_reason = NULLIF(array_to_string(s.bloqueos, ', '), '')
  FROM public.v_building_rights_status s
  WHERE s.building_id = r.building_id;

  UPDATE public.building_property_rights r
  SET feeds_cuota = true, blocked_reason = NULL
  FROM public.v_rights_cuota_eligible e
  WHERE e.titular_id = r.titular_id;
  GET DIAGNOSTICS v = ROW_COUNT;
  RETURN jsonb_build_object('feeds_cuota', v);
END;
$$;


--
-- Name: p0_rebuild_property_rights(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.p0_rebuild_property_rights(p_reason text DEFAULT 'fase2_p0'::text) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_arch int; v_ins int;
BEGIN
  INSERT INTO public.building_property_rights_archive(reason, row_data)
  SELECT p_reason, to_jsonb(r) FROM public.building_property_rights r;
  GET DIAGNOSTICS v_arch = ROW_COUNT;

  DELETE FROM public.building_property_rights;

  WITH tit AS (
    SELECT t.id AS titular_id, ns.id AS nota_id, ns.building_id,
           t.nombre_extraido,
           nullif(upper(regexp_replace(coalesce(t.cif_dni,''),'[^A-Za-z0-9]','','g')),'') AS dni,
           t.porcentaje,
           t.rol::text AS rol,
           coalesce(t.rol_literal, t.metadatos->>'rol_literal') AS rol_literal,
           t.company_id,
           public.norm_person_name(t.nombre_extraido) AS nn
    FROM public.nota_simple_titulares t
    JOIN public.notas_simples ns ON ns.id = t.nota_simple_id
    WHERE ns.building_id IS NOT NULL
  ),
  clasif AS (
    SELECT tit.*,
      lower(coalesce(tit.rol_literal,'')) AS lit,
      CASE
        WHEN tit.rol = 'ganancial'
          OR coalesce(tit.rol_literal,'') ~* '(car[áa]cter\s+ganancial|gananciales?|sociedad\s+conyugal)'
          OR tit.nombre_extraido ~* '(SOCIEDAD\s+CONYUGAL|GANANCIAL)' THEN 'ganancial'
        WHEN tit.rol = 'pleno' OR coalesce(tit.rol_literal,'') ~* 'pleno\s*dominio' THEN 'pleno_dominio'
        WHEN tit.rol = 'nuda_propiedad' OR coalesce(tit.rol_literal,'') ~* 'nuda\s*propiedad' THEN 'nuda_propiedad'
        WHEN tit.rol = 'usufructo' OR coalesce(tit.rol_literal,'') ~* 'usufruct' THEN 'usufructo'
        ELSE 'otro'
      END AS right_type,
      CASE WHEN tit.nombre_extraido ~* '(S\.?L\.?U?|S\.?A\.?|SOCIEDAD LIMITADA|SOCIEDAD ANONIMA|INMOBILIARIA|CAPITAL)\M'
                OR tit.dni ~ '^[ABCDEFGHJNPQRSUVW][0-9]'
           THEN true ELSE false END AS es_sociedad
    FROM tit
  ),
  capa AS (
    SELECT nota_id, right_type, count(*) AS n_capa FROM clasif GROUP BY nota_id, right_type
  ),
  m_dni AS (
    SELECT c.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
    FROM clasif c
    JOIN public.owners o
      ON nullif(upper(regexp_replace(coalesce(o.metadatos->>'dni__nif__cif',''),'[^A-Za-z0-9]','','g')),'') = c.dni
    WHERE c.dni IS NOT NULL AND o.merged_into IS NULL
    GROUP BY c.titular_id
  ),
  m_nom AS (
    SELECT c.titular_id, min(o.id::text)::uuid AS owner_id, count(*) AS n
    FROM clasif c
    JOIN public.owners o ON public.norm_person_name(o.nombre) = c.nn
    WHERE c.nn IS NOT NULL AND o.merged_into IS NULL
    GROUP BY c.titular_id
  ),
  m_comp AS (
    SELECT c.titular_id, min(k.id::text)::uuid AS company_id, count(*) AS n
    FROM clasif c
    JOIN public.companies k ON public.norm_person_name(k.nombre) = c.nn
    WHERE c.es_sociedad AND c.nn IS NOT NULL
    GROUP BY c.titular_id
  ),
  final AS (
    SELECT c.*, cp.n_capa,
      CASE WHEN c.es_sociedad THEN coalesce(c.company_id, CASE WHEN mc.n = 1 THEN mc.company_id END) ELSE c.company_id END AS f_company_id,
      CASE WHEN NOT c.es_sociedad THEN CASE WHEN md.n = 1 THEN md.owner_id WHEN mn.n = 1 THEN mn.owner_id ELSE NULL END END AS f_owner_id,
      CASE
        WHEN c.es_sociedad THEN CASE WHEN c.company_id IS NOT NULL OR mc.n = 1 THEN 'nombre_exacto' ELSE 'ninguno' END
        WHEN md.n = 1 THEN 'dni'
        WHEN mn.n = 1 THEN 'nombre_exacto'
        WHEN md.n > 1 OR mn.n > 1 THEN 'aproximado'
        ELSE 'ninguno'
      END AS f_identity,
      CASE WHEN md.n = 1 THEN 1.0 WHEN mn.n = 1 THEN 0.8 ELSE 0.4 END AS f_conf,
      public.nota_evidence_snippet(c.nota_id, c.nombre_extraido) AS ev
    FROM clasif c
    LEFT JOIN capa cp ON cp.nota_id = c.nota_id AND cp.right_type = c.right_type
    LEFT JOIN m_dni md ON md.titular_id = c.titular_id
    LEFT JOIN m_nom mn ON mn.titular_id = c.titular_id
    LEFT JOIN m_comp mc ON mc.titular_id = c.titular_id
  )
  INSERT INTO public.building_property_rights (
    building_id, owner_id, company_id, note_simple_id, titular_id, titular_nombre, titular_dni,
    right_type, percentage, coownership_regime, cotitulares,
    source_type, source_ref, evidence, evidence_ref, right_literal,
    identity_match, confidence, status, review_flag, review_reason, feeds_cuota, blocked_reason
  )
  SELECT
    f.building_id, f.f_owner_id, f.f_company_id, f.nota_id, f.titular_id, f.nombre_extraido, f.dni,
    f.right_type, f.porcentaje,
    CASE
      WHEN f.right_type = 'ganancial' THEN 'gananciales'
      WHEN f.n_capa > 1 THEN 'proindiviso'
      WHEN f.n_capa = 1 AND f.porcentaje IS NOT NULL AND abs(f.porcentaje - 100) <= 0.5 THEN 'privativo'
      ELSE 'desconocido'
    END,
    CASE WHEN f.right_type = 'ganancial'
         THEN (SELECT array_agg(btrim(x)) FROM unnest(regexp_split_to_array(
                 regexp_replace(f.nombre_extraido, '\s*\((SOCIEDAD\s+CONYUGAL|GANANCIALES?)\)\s*', '', 'gi'),
                 '\s+Y\s+')) x WHERE btrim(x) <> '')
    END,
    'nota_simple',
    'titular:' || f.titular_id::text || '|nota:' || f.nota_id::text,
    'Nota simple ' || f.nota_id::text || ' · titular literal: "' || f.nombre_extraido ||
      '" · derecho: ' || f.right_type || coalesce(' ("' || f.rol_literal || '")','') ||
      ' · porcentaje declarado: ' || coalesce(f.porcentaje::text,'(sin dato)') ||
      CASE WHEN (f.ev->>'encontrado')::boolean THEN ' · cita registral: «' || (f.ev->>'cita') || '»'
           ELSE ' · SIN cita literal localizada en el texto de la nota' END,
    f.ev, f.rol_literal,
    f.f_identity, f.f_conf, 'active',
    -- revisión obligatoria
    (f.right_type = 'otro')
      OR (f.right_type = 'ganancial')
      OR ((f.ev->>'encontrado')::boolean IS DISTINCT FROM true)
      OR (f.rol_literal IS NOT NULL AND f.right_type = 'pleno_dominio' AND f.rol_literal !~* 'pleno')
      OR (f.porcentaje IS NULL),
    nullif(concat_ws(' · ',
      CASE WHEN f.right_type = 'otro' THEN 'rol no reconocido en la nota (no se asume pleno dominio)' END,
      CASE WHEN f.right_type = 'ganancial' THEN 'carácter ganancial: no se reparte entre cónyuges, requiere validación' END,
      CASE WHEN (f.ev->>'encontrado')::boolean IS DISTINCT FROM true THEN 'sin cita literal trazable en la nota' END,
      CASE WHEN f.rol_literal IS NOT NULL AND f.right_type = 'pleno_dominio' AND f.rol_literal !~* 'pleno' THEN 'contradicción entre texto literal y rol clasificado' END,
      CASE WHEN f.porcentaje IS NULL THEN 'porcentaje ausente en la nota' END
    ), ''),
    false, NULL
  FROM final f;

  GET DIAGNOSTICS v_ins = ROW_COUNT;

  -- feeds_cuota solo en casos seguros
  UPDATE public.building_property_rights r
     SET feeds_cuota = true, blocked_reason = NULL
   WHERE r.status = 'active' AND NOT r.review_flag
     AND r.right_type = 'pleno_dominio' AND r.identity_match = 'dni' AND r.owner_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.v_building_rights_status s
                 WHERE s.building_id = r.building_id AND s.apto_para_cuota);

  UPDATE public.building_property_rights r
     SET blocked_reason = coalesce(r.review_reason, 'no cumple pleno dominio + identidad por DNI + capa completa')
   WHERE NOT r.feeds_cuota AND r.blocked_reason IS NULL;

  RETURN jsonb_build_object('archivadas', v_arch, 'insertadas', v_ins);
END $$;


--
-- Name: person_match_key(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.person_match_key(p_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public'
    AS $$
  WITH t AS (
    SELECT regexp_split_to_array(
      btrim(regexp_replace(public.normalize_person_name(coalesce(p_name,'')), '\s+', ' ', 'g')), ' '
    ) AS a
  )
  SELECT CASE
    WHEN array_length(a,1) IS NULL OR array_length(a,1) < 3 THEN NULL
    ELSE a[array_length(a,1)-1] || ' ' || a[array_length(a,1)] || ' ' || left(a[1],1)
  END
  FROM t;
$$;


--
-- Name: recompute_building_owner_metrics(uuid[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.recompute_building_owner_metrics(p_building_ids uuid[] DEFAULT NULL::uuid[]) RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  v_updated int := 0;
  v_inconsistente int := 0;
BEGIN
  WITH ids AS (
    SELECT b.id FROM public.buildings b
    WHERE p_building_ids IS NULL OR b.id = ANY(p_building_ids)
  ),
  base AS (
    SELECT vo.building_id, vo.owner_id, vo.pct_propiedad, vo.pct_origen
    FROM public.v_owner_score vo
    JOIN public.building_owners bo
      ON bo.building_id = vo.building_id AND bo.owner_id = vo.owner_id
    WHERE vo.building_id IN (SELECT id FROM ids)
  ),
  dedup AS (
    SELECT building_id, owner_id, MAX(pct_propiedad) AS pct, MAX(pct_origen) AS origen
    FROM base
    GROUP BY building_id, owner_id
  ),
  sums AS (
    SELECT building_id,
           COUNT(*) AS n_owners_unicos,
           ROUND(SUM(COALESCE(pct,0))::numeric, 2) AS sum_pct,
           bool_or(origen = 'nota_simple') AS has_nota
    FROM dedup
    GROUP BY building_id
  ),
  upd AS (
    UPDATE public.building_analysis ba
    SET metricas_extra = COALESCE(ba.metricas_extra,'{}'::jsonb)
      || jsonb_build_object(
           'owners_unicos_post_dedup', s.n_owners_unicos,
           'pct_propiedad_sum', s.sum_pct,
           'pct_propiedad_estado',
              CASE
                WHEN NOT s.has_nota AND s.sum_pct > 0 THEN 'sin_nota_simple'
                WHEN s.sum_pct BETWEEN 95 AND 105 THEN 'ok'
                WHEN s.sum_pct = 0 THEN 'sin_pct'
                WHEN s.sum_pct > 105 THEN 'sobre_105'
                ELSE 'bajo_95'
              END,
           'pct_propiedad_needs_review',
              CASE
                WHEN NOT s.has_nota THEN true
                WHEN s.sum_pct BETWEEN 95 AND 105 OR s.sum_pct = 0 THEN false
                ELSE true
              END,
           'pct_propiedad_audited_at', to_jsonb(now())
         )
    FROM sums s
    WHERE ba.building_id = s.building_id
    RETURNING ba.building_id, s.sum_pct
  )
  SELECT COUNT(*) FILTER (WHERE TRUE), COUNT(*) FILTER (WHERE sum_pct < 95 OR sum_pct > 105)
    INTO v_updated, v_inconsistente
  FROM upd;

  UPDATE public.buildings b
  SET numero_propietarios = sub.n
  FROM (
    SELECT building_id, COUNT(DISTINCT owner_id) AS n
    FROM public.building_owners
    WHERE building_id IN (SELECT id FROM public.buildings WHERE p_building_ids IS NULL OR id = ANY(p_building_ids))
    GROUP BY building_id
  ) sub
  WHERE b.id = sub.building_id;

  RETURN jsonb_build_object('buildings_updated', v_updated, 'inconsistentes', v_inconsistente);
END $$;


--
-- Name: reconciliation_mark_candidates(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reconciliation_mark_candidates() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v jsonb;
BEGIN
  UPDATE public.reconciliation_queue q
     SET apto_auto = req.apto,
         requisitos = req.det,
         estado = CASE WHEN q.estado IN ('aplicado','descartado') THEN q.estado ELSE 'candidato' END,
         updated_at = now()
  FROM (
    SELECT q2.id,
      jsonb_build_object(
        'dni_exacto', q2.match_kind = 'dni_exacto',
        'nota_del_edificio', ns.building_id IS NOT DISTINCT FROM q2.building_id,
        'nota_vigente', coalesce(ns.status,'listo') = 'listo',
        'derecho_pleno_dominio', bpr.right_type = 'pleno_dominio',
        'derecho_sin_revision', coalesce(bpr.review_flag, true) = false,
        'identidad_coherente', (bpr.company_id IS NULL AND q2.match_company_id IS NULL AND q2.match_owner_id IS NOT NULL)
      ) AS det,
      (q2.match_kind = 'dni_exacto'
        AND ns.building_id IS NOT DISTINCT FROM q2.building_id
        AND coalesce(ns.status,'listo') = 'listo'
        AND bpr.right_type = 'pleno_dominio'
        AND coalesce(bpr.review_flag, true) = false
        AND bpr.company_id IS NULL AND q2.match_company_id IS NULL AND q2.match_owner_id IS NOT NULL) AS apto
    FROM public.reconciliation_queue q2
    LEFT JOIN public.notas_simples ns ON ns.id = q2.nota_simple_id
    LEFT JOIN public.building_property_rights bpr ON bpr.titular_id = q2.titular_id AND bpr.status = 'active'
  ) req
  WHERE req.id = q.id;

  SELECT jsonb_build_object('total', count(*), 'aptos', count(*) FILTER (WHERE apto_auto),
                            'candidatos', count(*) FILTER (WHERE estado='candidato'))
    INTO v FROM public.reconciliation_queue;
  RETURN v;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: notas_simples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_simples (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    owner_id uuid,
    file_url text,
    status text DEFAULT 'pendiente'::text NOT NULL,
    raw_pdf_text text,
    structured_json jsonb,
    riesgo text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    attempt_count integer DEFAULT 0 NOT NULL,
    last_error text,
    next_retry_at timestamp with time zone,
    claimed_at timestamp with time zone,
    dead_letter boolean DEFAULT false NOT NULL
);


--
-- Name: reparse_claim_batch(integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reparse_claim_batch(p_limit integer DEFAULT 12, p_lock_minutes integer DEFAULT 10) RETURNS SETOF public.notas_simples
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  RETURN QUERY
  UPDATE public.notas_simples n SET claimed_at = now()
  WHERE n.id IN (
    SELECT c.id FROM public.notas_simples c
    WHERE c.status = 'listo'
      AND c.dead_letter = false
      AND (c.building_id IS NULL OR c.structured_json->>'needs_extract' = '1')
      AND coalesce(c.structured_json->>'reparse_done','') <> '1'
      AND (c.next_retry_at IS NULL OR c.next_retry_at <= now())
      AND (c.claimed_at IS NULL OR c.claimed_at < now() - make_interval(mins => p_lock_minutes))
    ORDER BY c.attempt_count ASC, c.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING n.*;
END $$;


--
-- Name: rpc_inversores_paginated(text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_inversores_paginated(p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, nombre text, telefono text, email text, metadatos jsonb, updated_at timestamp with time zone, total_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH filtered AS (
    SELECT o.id, o.nombre, o.telefono, o.email, o.metadatos, o.updated_at
    FROM public.owners o
    WHERE o.metadatos->>'tipo_de_inversor' IS NOT NULL
      AND o.metadatos->>'tipo_de_inversor' <> ''
      AND (
        p_search IS NULL OR p_search = '' OR
        o.nombre ILIKE '%'||p_search||'%' OR
        (o.metadatos->>'tipo_de_inversor') ILIKE '%'||p_search||'%' OR
        (o.metadatos->>'distrito_zona') ILIKE '%'||p_search||'%' OR
        COALESCE(o.email,'') ILIKE '%'||p_search||'%' OR
        COALESCE(o.telefono,'') ILIKE '%'||p_search||'%'
      )
  ), counted AS (
    SELECT COUNT(*)::bigint AS total FROM filtered
  )
  SELECT f.id, f.nombre, f.telefono, f.email, f.metadatos, f.updated_at,
         (SELECT total FROM counted) AS total_count
  FROM filtered f
  ORDER BY f.updated_at DESC NULLS LAST, f.nombre ASC
  LIMIT p_limit OFFSET p_offset;
$$;


--
-- Name: rpc_inversores_paginated(text, text, text, text, text, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_inversores_paginated(p_search text DEFAULT NULL::text, p_tipo text DEFAULT NULL::text, p_buyer_persona text DEFAULT NULL::text, p_distrito text DEFAULT NULL::text, p_order text DEFAULT 'recent'::text, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0) RETURNS TABLE(id uuid, nombre text, telefono text, email text, metadatos jsonb, updated_at timestamp with time zone, total_count bigint)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH filtered AS (
    SELECT o.id, o.nombre, o.telefono, o.email, o.metadatos, o.updated_at
    FROM public.owners o
    WHERE o.metadatos->>'tipo_de_inversor' IS NOT NULL
      AND o.metadatos->>'tipo_de_inversor' <> ''
      AND (p_tipo IS NULL OR p_tipo = '' OR o.metadatos->>'tipo_de_inversor' = p_tipo)
      AND (p_buyer_persona IS NULL OR p_buyer_persona = '' OR o.buyer_persona::text = p_buyer_persona)
      AND (p_distrito IS NULL OR p_distrito = '' OR o.metadatos->>'distrito_zona' = p_distrito)
      AND (
        p_search IS NULL OR p_search = '' OR
        o.nombre ILIKE '%'||p_search||'%' OR
        (o.metadatos->>'tipo_de_inversor') ILIKE '%'||p_search||'%' OR
        (o.metadatos->>'distrito_zona') ILIKE '%'||p_search||'%' OR
        COALESCE(o.email,'') ILIKE '%'||p_search||'%' OR
        COALESCE(o.telefono,'') ILIKE '%'||p_search||'%'
      )
  ), counted AS (
    SELECT COUNT(*)::bigint AS total FROM filtered
  )
  SELECT f.id, f.nombre, f.telefono, f.email, f.metadatos, f.updated_at,
         (SELECT total FROM counted) AS total_count
  FROM filtered f
  ORDER BY
    CASE WHEN p_order = 'alpha' THEN f.nombre END ASC NULLS LAST,
    CASE WHEN p_order = 'recent' OR p_order IS NULL THEN f.updated_at END DESC NULLS LAST,
    f.nombre ASC
  LIMIT p_limit OFFSET p_offset;
$$;


--
-- Name: rpc_rag_search(text, public.vector, integer, text, uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.rpc_rag_search(query_text text, query_embedding public.vector DEFAULT NULL::public.vector, match_count integer DEFAULT 8, filter_scope_type text DEFAULT NULL::text, filter_scope_id uuid DEFAULT NULL::uuid, filter_origen text DEFAULT NULL::text) RETURNS TABLE(id uuid, contenido text, origen text, referencia_id uuid, scope_type text, scope_id uuid, metadatos jsonb, similarity double precision, fts_rank double precision, hybrid_score double precision)
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  WITH q AS (
    SELECT
      websearch_to_tsquery('spanish', coalesce(query_text, '')) AS tsq
  ),
  scored AS (
    SELECT
      kc.id,
      kc.contenido,
      kc.origen,
      kc.referencia_id,
      kc.scope_type,
      kc.scope_id,
      kc.metadatos,
      CASE
        WHEN query_embedding IS NOT NULL AND kc.embedding IS NOT NULL
        THEN 1 - (kc.embedding <=> query_embedding)
        ELSE 0
      END::double precision AS similarity,
      CASE
        WHEN query_text IS NOT NULL AND length(trim(query_text)) > 0
        THEN ts_rank(to_tsvector('spanish', coalesce(kc.contenido,'')), (SELECT tsq FROM q))::double precision
        ELSE 0
      END AS fts_rank
    FROM public.knowledge_chunks kc
    WHERE
      (filter_scope_type IS NULL OR kc.scope_type = filter_scope_type)
      AND (filter_scope_id IS NULL OR kc.scope_id = filter_scope_id)
      AND (filter_origen IS NULL OR kc.origen = filter_origen)
      AND (
        query_embedding IS NULL
        OR query_text IS NULL
        OR to_tsvector('spanish', coalesce(kc.contenido,'')) @@ (SELECT tsq FROM q)
        OR kc.embedding IS NOT NULL
      )
  )
  SELECT
    id, contenido, origen, referencia_id, scope_type, scope_id, metadatos,
    similarity, fts_rank,
    (0.7 * similarity + 0.3 * LEAST(fts_rank, 1.0))::double precision AS hybrid_score
  FROM scored
  ORDER BY (0.7 * similarity + 0.3 * LEAST(fts_rank, 1.0)) DESC
  LIMIT match_count;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: strip_html_to_text(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.strip_html_to_text(_in text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        replace(replace(replace(replace(replace(replace(replace(replace(
          regexp_replace(COALESCE(_in, ''), '<[^>]+>', ' ', 'g'),
          '&nbsp;', ' '),
          '&amp;', '&'),
          '&lt;', '<'),
          '&gt;', '>'),
          '&quot;', '"'),
          '&#39;', ''''),
          '&apos;', ''''),
          '&ndash;', '-'),
        '\s+', ' ', 'g'
      )
    ),
    ''
  );
$$;


--
-- Name: tg_call_session_recompute_score(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_call_session_recompute_score() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_bid uuid;
BEGIN
  IF NEW.building_id IS NOT NULL THEN
    PERFORM public.compute_score_total(NEW.building_id);
  ELSIF NEW.owner_id IS NOT NULL THEN
    FOR v_bid IN SELECT DISTINCT building_id FROM public.building_owners WHERE owner_id = NEW.owner_id LOOP
      PERFORM public.compute_score_total(v_bid);
    END LOOP;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;


--
-- Name: tg_iee_maintain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_iee_maintain() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.iee_estado = 'favorable' AND NEW.iee_fecha_inspeccion IS NOT NULL THEN
    NEW.iee_proxima_revision := NEW.iee_fecha_inspeccion + interval '10 years';
    IF NEW.iee_proxima_revision < CURRENT_DATE THEN
      NEW.iee_estado := 'caducada';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: tg_prep_cache_recompute_score(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.tg_prep_cache_recompute_score() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_bid uuid;
BEGIN
  IF NEW.owner_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.kpis_json IS NOT DISTINCT FROM NEW.kpis_json THEN RETURN NEW; END IF;
  FOR v_bid IN SELECT DISTINCT building_id FROM public.building_owners WHERE owner_id = NEW.owner_id LOOP
    PERFORM public.compute_score_total(v_bid);
  END LOOP;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;


--
-- Name: touch_deals_gemelos_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_deals_gemelos_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;


--
-- Name: touch_hubspot_deals_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_hubspot_deals_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public'
    AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;


--
-- Name: trg_bpr_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_bpr_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.building_property_rights_history(right_id, building_id, accion, antes, changed_by)
    VALUES (OLD.id, OLD.building_id, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
  NEW.updated_at := now();
  INSERT INTO public.building_property_rights_history(right_id, building_id, accion, antes, despues, changed_by)
  VALUES (NEW.id, NEW.building_id, TG_OP,
          CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END, to_jsonb(NEW), auth.uid());
  RETURN NEW;
END $$;


--
-- Name: trg_building_owners_set_name_norm(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_building_owners_set_name_norm() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  SELECT public.normalize_person_name(o.nombre) INTO NEW.owner_name_norm
  FROM public.owners o WHERE o.id = NEW.owner_id;
  RETURN NEW;
END $$;


--
-- Name: trg_recompute_score(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_recompute_score() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  PERFORM public.compute_cluster_score(NEW.building_id);
  RETURN NEW;
END;
$$;


--
-- Name: trg_sanitation_audit(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.trg_sanitation_audit() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  NEW.updated_at := now();
  INSERT INTO public.building_sanitation_history(building_id, accion, antes, despues, source, changed_by)
  VALUES (NEW.building_id, TG_OP, CASE WHEN TG_OP='UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
          to_jsonb(NEW), NEW.source, auth.uid());
  RETURN NEW;
END $$;


--
-- Name: volcar_cuotas_desde_notas(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.volcar_cuotas_desde_notas() RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE v_upd int := 0; v_edif int := 0; v_aprox int := 0;
BEGIN
  WITH nota_principal AS (
    SELECT DISTINCT ON (n.building_id) n.building_id, n.id AS nota_id
    FROM notas_simples n
    WHERE n.building_id IS NOT NULL AND n.status='listo'
    ORDER BY n.building_id,
      (SELECT count(*) FROM nota_simple_titulares t WHERE t.nota_simple_id=n.id AND t.porcentaje IS NOT NULL) DESC,
      n.created_at DESC
  ), pct AS (
    SELECT np.building_id,
           public.normalize_person_name(t.nombre_extraido) AS nn,
           least(100, round(sum(t.porcentaje)::numeric, 4)) AS cuota
    FROM nota_principal np
    JOIN nota_simple_titulares t ON t.nota_simple_id = np.nota_id
    WHERE t.porcentaje IS NOT NULL AND nullif(t.nombre_extraido,'') IS NOT NULL
    GROUP BY 1,2
  ), upd AS (
    UPDATE building_owners bo
       SET cuota = p.cuota,
           metadatos = coalesce(bo.metadatos,'{}'::jsonb)
                       || jsonb_build_object('cuota_origen','nota_simple_principal','cuota_match','exacto','cuota_fecha', now()::text)
    FROM pct p
    WHERE bo.building_id = p.building_id
      AND bo.owner_name_norm = p.nn
      AND (bo.cuota IS NULL OR bo.cuota <> p.cuota)
    RETURNING bo.building_id
  )
  SELECT count(*), count(DISTINCT building_id) INTO v_upd, v_edif FROM upd;

  -- Segundo intento: por apellidos + inicial, solo si hay UN único candidato en ambos lados
  WITH nota_principal AS (
    SELECT DISTINCT ON (n.building_id) n.building_id, n.id AS nota_id
    FROM notas_simples n
    WHERE n.building_id IS NOT NULL AND n.status='listo'
    ORDER BY n.building_id,
      (SELECT count(*) FROM nota_simple_titulares t WHERE t.nota_simple_id=n.id AND t.porcentaje IS NOT NULL) DESC,
      n.created_at DESC
  ), pct AS (
    SELECT np.building_id,
           public.person_match_key(t.nombre_extraido) AS mk,
           least(100, round(sum(t.porcentaje)::numeric, 4)) AS cuota,
           count(DISTINCT public.normalize_person_name(t.nombre_extraido)) AS n_nombres
    FROM nota_principal np
    JOIN nota_simple_titulares t ON t.nota_simple_id = np.nota_id
    WHERE t.porcentaje IS NOT NULL
      AND public.person_match_key(t.nombre_extraido) IS NOT NULL
      AND NOT (t.cif_dni ~* '^[ABCDEFGHJNPQRSUVW]')
    GROUP BY 1,2
  ), pct1 AS (
    SELECT * FROM pct WHERE n_nombres = 1
  ), cands AS (
    SELECT bo.building_id, bo.owner_id, public.person_match_key(bo.owner_name_norm) AS mk
    FROM building_owners bo
    WHERE bo.cuota IS NULL AND public.person_match_key(bo.owner_name_norm) IS NOT NULL
  ), uniq AS (
    SELECT c.building_id, c.mk, min(c.owner_id::text)::uuid AS owner_id, count(*) AS n
    FROM cands c
    GROUP BY 1,2
  ), upd2 AS (
    UPDATE building_owners bo
       SET cuota = p.cuota,
           metadatos = coalesce(bo.metadatos,'{}'::jsonb)
                       || jsonb_build_object('cuota_origen','nota_simple_principal','cuota_match','aproximado','cuota_fecha', now()::text)
    FROM pct1 p
    JOIN uniq u ON u.building_id = p.building_id AND u.mk = p.mk AND u.n = 1
    WHERE bo.building_id = u.building_id
      AND bo.owner_id = u.owner_id
      AND bo.cuota IS NULL
    RETURNING bo.building_id
  )
  SELECT count(*) INTO v_aprox FROM upd2;

  RETURN jsonb_build_object('cuotas_actualizadas', v_upd, 'edificios', v_edif, 'cuotas_aproximadas', v_aprox);
END $$;


--
-- Name: wa_messages_touch_contact_origin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wa_messages_touch_contact_origin() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.direction = 'out' AND NEW.sender_type = 'human_agent' THEN
    UPDATE public.wa_contacts
      SET last_human_agent_id = COALESCE(NEW.agent_user_id, last_human_agent_id),
          last_human_contact_at = NEW.created_at
      WHERE id = NEW.contact_id;
  ELSIF NEW.direction = 'out' AND NEW.sender_type = 'bot' THEN
    UPDATE public.wa_contacts
      SET last_bot_contact_at = NEW.created_at
      WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END $$;


--
-- Name: wa_pause_bot_on_human_outbound(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.wa_pause_bot_on_human_outbound() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF NEW.direction = 'out'
     AND COALESCE(NEW.sender_type, 'bot') <> 'bot'
     AND NEW.conversation_id IS NOT NULL THEN
    UPDATE public.wa_conversations
      SET ai_enabled       = false,
          bot_paused_until = now() + interval '24 hours',
          handoff_reason   = COALESCE(handoff_reason, 'human_outbound'),
          updated_at       = now()
      WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    provider_id text,
    provider text,
    identity_data jsonb DEFAULT '{}'::jsonb,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text,
    encrypted_password text,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    instance_id uuid,
    aud text,
    role text,
    email_confirmed_at timestamp with time zone,
    confirmation_token text,
    recovery_token text,
    email_change_token_new text,
    email_change text,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
    is_super_admin boolean,
    phone text,
    is_sso_user boolean DEFAULT false,
    is_anonymous boolean DEFAULT false,
    deleted_at timestamp with time zone,
    confirmed_at timestamp with time zone
);


--
-- Name: _a1_dangling_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._a1_dangling_review (
    hs_deal text NOT NULL,
    dealname text,
    address text,
    candidato uuid,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: _fn_backups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._fn_backups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fn_name text,
    definition text,
    note text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: _wave1a_drift_marks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public._wave1a_drift_marks (
    mark text NOT NULL,
    applied_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_name text NOT NULL,
    scope_type text,
    scope_id uuid,
    modelo text,
    latencia_ms integer,
    tokens_in integer,
    tokens_out integer,
    confianza numeric(3,2),
    resultado jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: app_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_settings (
    key text NOT NULL,
    value jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    owner_id uuid,
    tipo public.asset_type DEFAULT 'vivienda'::public.asset_type NOT NULL,
    ubicacion text NOT NULL,
    ciudad text,
    superficie_m2 numeric(10,2),
    valoracion_estimada numeric(14,2),
    valoracion_fuente text,
    valoracion_confianza numeric(3,2),
    estado public.asset_status DEFAULT 'prospecto'::public.asset_status NOT NULL,
    descripcion text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: building_analysis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_analysis (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    ventanas_fachada_total integer,
    ventanas_por_planta jsonb,
    patios_detectados integer,
    segundas_escaleras boolean,
    esquina boolean,
    protegido_historicamente boolean,
    plantas_visibles integer,
    plantas_max_normativa integer,
    plantas_levantables integer,
    metricas_extra jsonb,
    modelo_usado text,
    modelo_fallback boolean DEFAULT false,
    sources_used jsonb,
    confidence numeric,
    llm_raw_response jsonb,
    analyzed_at timestamp with time zone,
    analyze_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    anotaciones_plano jsonb,
    analysis_duration_ms integer,
    plano_render_url text,
    viviendas_por_planta_tipo integer,
    n_locales_planta_baja integer,
    n_almacenes_sotano integer,
    tiene_sotano boolean,
    tiene_azotea_transitable boolean,
    n_escaleras_en_piso01 integer,
    n_escaleras_en_planta_baja integer,
    patios_codigos jsonb,
    accesos_codigos jsonb,
    metricas_detalle jsonb,
    ventanas_patios_total integer,
    ventanas_patios_por_planta jsonb,
    ventanas_patios_por_patio jsonb,
    densidad_ventanas_fachada numeric,
    fachada_lineal_total_m numeric,
    ventanas_patios_estimadas integer,
    ventanas_patios_desglose jsonb,
    formula_ventanas_patio text,
    confidence_ventanas numeric,
    aviso_ventanas text,
    mala_gestion_score smallint,
    mala_gestion_evidencias jsonb,
    edificio_reformado boolean,
    gestion_profesional boolean,
    local_pb_m2 numeric,
    local_pb_fachada_m numeric,
    local_pb_esquina boolean,
    local_pb_viviendas_potenciales smallint,
    local_pb_tipo_calle text,
    proteccion_source text,
    protegido_raw jsonb DEFAULT '[]'::jsonb,
    n_escaleras_final integer,
    n_escaleras_fuente text,
    n_escaleras_evidencia jsonb,
    ventanas_fachada_needs_review boolean DEFAULT false NOT NULL,
    escaleras_needs_review boolean DEFAULT false NOT NULL,
    plantas_levantables_requiere_humano boolean DEFAULT false NOT NULL,
    n_escaleras_visor integer,
    escaleras_visor_confianza numeric,
    escaleras_visor_catalogo text,
    escaleras_visor_grado text,
    escaleras_visor_source text DEFAULT 'pg97_analisis_edificacion'::text,
    escaleras_visor_at timestamp with time zone,
    escaleras_visor_raw jsonb,
    es_esquina_visor boolean,
    calles_frente_visor jsonb,
    esquina_visor_confianza numeric,
    esquina_needs_review boolean DEFAULT false NOT NULL
);


--
-- Name: building_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid,
    status public.assignment_status DEFAULT 'active'::public.assignment_status NOT NULL
);


--
-- Name: building_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    company_id uuid NOT NULL,
    role public.building_company_role DEFAULT 'otro'::public.building_company_role NOT NULL,
    percentage numeric,
    fecha_inicio date,
    fecha_fin date,
    source text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: building_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    autor_id uuid,
    autor_email text,
    canal text NOT NULL,
    texto text,
    audio_url text,
    dimension text,
    estado text DEFAULT 'nueva'::text NOT NULL,
    analisis_ia jsonb,
    override_aplicado jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT building_feedback_canal_check CHECK ((canal = ANY (ARRAY['voz'::text, 'texto'::text, 'verificacion_inline'::text]))),
    CONSTRAINT building_feedback_estado_check CHECK ((estado = ANY (ARRAY['nueva'::text, 'analizada'::text, 'aplicada'::text, 'descartada'::text, 'requiere_codigo'::text])))
);


--
-- Name: building_hs_deal_link_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_hs_deal_link_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    old_hs_deal_id text,
    new_hs_deal_id text,
    criterio text NOT NULL,
    snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: building_imagery; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_imagery (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    source text NOT NULL,
    heading integer,
    pitch integer,
    zoom integer,
    file_path text NOT NULL,
    public_url text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT building_imagery_source_check CHECK ((source = ANY (ARRAY['satellite'::text, 'streetview'::text, 'oblique'::text])))
);


--
-- Name: building_overrides; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_overrides (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    dimension text NOT NULL,
    valor_num numeric,
    valor_bool boolean,
    valor_text text,
    fuente text DEFAULT 'building_feedback'::text,
    nota text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: building_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_owners (
    building_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    cuota numeric,
    subrole public.owner_subrole DEFAULT 'ninguno'::public.owner_subrole NOT NULL,
    rol_notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    es_influencer boolean DEFAULT false NOT NULL,
    influencer_score numeric,
    influencer_reason text,
    owner_name_norm text,
    cuota_estado text DEFAULT 'sin_auditar'::text NOT NULL,
    cuota_estado_motivo text,
    cuota_auditada_at timestamp with time zone,
    CONSTRAINT building_owners_cuota_estado_chk CHECK ((cuota_estado = ANY (ARRAY['sin_auditar'::text, 'vigente'::text, 'review'::text, 'superseded'::text])))
);


--
-- Name: building_processing_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_processing_status (
    building_id uuid NOT NULL,
    current_phase text,
    status text,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    error text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    pipeline_stage text,
    phases jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: building_property_rights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_property_rights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    owner_id uuid,
    company_id uuid,
    note_simple_id uuid,
    right_type text DEFAULT 'pleno_dominio'::text NOT NULL,
    percentage numeric,
    coownership_regime text,
    source_type text DEFAULT 'manual'::text NOT NULL,
    source_ref text,
    evidence text,
    confidence numeric,
    valid_from date,
    valid_to date,
    verified_at timestamp with time zone,
    verified_by uuid,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    titular_id uuid,
    titular_nombre text,
    titular_dni text,
    identity_match text DEFAULT 'ninguno'::text NOT NULL,
    cotitulares text[],
    feeds_cuota boolean DEFAULT false NOT NULL,
    blocked_reason text,
    review_flag boolean DEFAULT false NOT NULL,
    review_reason text,
    right_literal text,
    evidence_ref jsonb,
    CONSTRAINT bpr_owner_xor_company CHECK (((((owner_id IS NOT NULL))::integer + ((company_id IS NOT NULL))::integer) = 1)),
    CONSTRAINT building_property_rights_identity_match_check CHECK ((identity_match = ANY (ARRAY['dni'::text, 'nombre_exacto'::text, 'aproximado'::text, 'ninguno'::text]))),
    CONSTRAINT building_property_rights_percentage_check CHECK (((percentage IS NULL) OR ((percentage >= (0)::numeric) AND (percentage <= (100)::numeric)))),
    CONSTRAINT building_property_rights_right_type_check CHECK ((right_type = ANY (ARRAY['pleno_dominio'::text, 'nuda_propiedad'::text, 'usufructo'::text, 'ganancial'::text, 'otro'::text]))),
    CONSTRAINT building_property_rights_status_check CHECK ((status = ANY (ARRAY['active'::text, 'review'::text, 'superseded'::text])))
);


--
-- Name: building_property_rights_archive; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_property_rights_archive (
    archive_id uuid DEFAULT gen_random_uuid() NOT NULL,
    archived_at timestamp with time zone DEFAULT now() NOT NULL,
    reason text NOT NULL,
    row_data jsonb NOT NULL
);


--
-- Name: building_property_rights_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_property_rights_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    right_id uuid,
    building_id uuid,
    accion text NOT NULL,
    antes jsonb,
    despues jsonb,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: building_sanitation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_sanitation_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    accion text NOT NULL,
    antes jsonb,
    despues jsonb,
    source text,
    changed_by uuid,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: building_sanitation_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_sanitation_reviews (
    building_id uuid NOT NULL,
    feedback_row integer,
    interest_status text DEFAULT 'active'::text NOT NULL,
    exclusion_reason text,
    note_status text DEFAULT 'unknown'::text NOT NULL,
    note_requested_at timestamp with time zone,
    ownership_kind text DEFAULT 'unknown'::text NOT NULL,
    feedback_text text,
    source text DEFAULT 'feedback_jesus_2026-08-06'::text NOT NULL,
    requires_human_review boolean DEFAULT false NOT NULL,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT building_sanitation_reviews_interest_status_check CHECK ((interest_status = ANY (ARRAY['active'::text, 'no_interest'::text, 'discarded'::text, 'review'::text]))),
    CONSTRAINT building_sanitation_reviews_note_status_check CHECK ((note_status = ANY (ARRAY['unknown'::text, 'requested'::text, 'received'::text, 'unusable'::text, 'not_required'::text]))),
    CONSTRAINT building_sanitation_reviews_ownership_kind_check CHECK ((ownership_kind = ANY (ARRAY['person'::text, 'company'::text, 'mixed'::text, 'unknown'::text])))
);


--
-- Name: building_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.building_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    user_id uuid NOT NULL,
    task_type text DEFAULT 'manual'::text NOT NULL,
    task_key text,
    title text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text NOT NULL,
    priority text DEFAULT 'medium'::text NOT NULL,
    due_date timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: buildings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.buildings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    direccion text NOT NULL,
    ciudad text NOT NULL,
    codigo_postal text,
    division_horizontal boolean DEFAULT false NOT NULL,
    numero_propietarios integer,
    catastro_ref text,
    estado public.building_status DEFAULT 'identificado'::public.building_status NOT NULL,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    comercial text,
    hs_deal_id text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_synced_at timestamp with time zone,
    refcatastral text,
    score numeric,
    score_breakdown jsonb,
    score_updated_at timestamp with time zone,
    avisos_inteligentes jsonb,
    cartera_demo_seed boolean DEFAULT false NOT NULL,
    score_summary text,
    confianza_media numeric,
    cluster_asignado text,
    cluster_score numeric,
    cluster_breakdown jsonb,
    cluster_motivo text,
    es_esquina_manual boolean,
    iee_estado public.iee_estado DEFAULT 'desconocido'::public.iee_estado NOT NULL,
    iee_fecha_inspeccion date,
    iee_proxima_revision date,
    iee_deficiencias jsonb DEFAULT '[]'::jsonb,
    iee_fuente text,
    iee_actualizado_at timestamp with time zone,
    grupo_barrio text,
    pct_terciario numeric,
    es_estrella boolean DEFAULT false NOT NULL,
    score_activo numeric,
    score_propietarios numeric,
    score_propietarios_breakdown jsonb,
    score_total numeric,
    score_propietarios_updated_at timestamp with time zone
);


--
-- Name: COLUMN buildings.es_esquina_manual; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.buildings.es_esquina_manual IS 'Override manual: si no es null, fuerza es_esquina al valor indicado y esquina_source=manual en count-facade-windows.';


--
-- Name: cadence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cadence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    tipo public.cadence_step_kind NOT NULL,
    dia_offset integer DEFAULT 0 NOT NULL,
    plantilla text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_playbook; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_playbook (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    perfil_tipologia text NOT NULL,
    tactica_tipo text NOT NULL,
    tactica_texto text NOT NULL,
    ejemplo_literal text,
    n_usos integer DEFAULT 0 NOT NULL,
    n_exito integer DEFAULT 0 NOT NULL,
    tasa_exito numeric DEFAULT 0 NOT NULL,
    evidencia jsonb DEFAULT '[]'::jsonb NOT NULL,
    ultima_actualizacion timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: call_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.call_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    comercial_id uuid NOT NULL,
    owner_id uuid,
    building_id uuid,
    paso integer DEFAULT 1 NOT NULL,
    objetivo text,
    checklist jsonb DEFAULT '[]'::jsonb NOT NULL,
    voss_brief jsonb,
    voss_post jsonb,
    resultado text,
    notas text,
    call_id uuid,
    iniciada_at timestamp with time zone DEFAULT now() NOT NULL,
    cerrada_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    puntuacion numeric,
    hubspot_call_id text,
    estado text DEFAULT 'preparada'::text NOT NULL,
    finalizada_at timestamp with time zone,
    kpis_objetivo jsonb,
    retroactiva boolean DEFAULT false NOT NULL,
    comercial_email text,
    next_retry_at timestamp with time zone,
    retries_left integer DEFAULT 0 NOT NULL
);


--
-- Name: COLUMN call_sessions.kpis_objetivo; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.call_sessions.kpis_objetivo IS 'KPIs a abordar (claves del checklist) fijados en el paso 1. Inmutable como parte del expediente.';


--
-- Name: calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    fecha timestamp with time zone DEFAULT now() NOT NULL,
    direccion public.call_direction DEFAULT 'saliente'::public.call_direction NOT NULL,
    duracion_seg integer,
    resumen text,
    transcripcion text,
    transcripcion_url text,
    siguiente_accion text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    outcome text,
    sentiment text,
    objeciones text[] DEFAULT '{}'::text[],
    tecnica_score numeric,
    preguntas_abiertas integer,
    preguntas_cerradas integer,
    ratio_comercial_cliente numeric,
    frases_clave_positivas text[] DEFAULT '{}'::text[],
    frases_clave_negativas text[] DEFAULT '{}'::text[],
    analisis_confianza numeric,
    analyzed_at timestamp with time zone,
    comercial_hs_id text,
    comercial_email text,
    comercial_nombre text,
    pivot_moments jsonb DEFAULT '[]'::jsonb NOT NULL,
    tacticas_usadas text[] DEFAULT '{}'::text[] NOT NULL,
    notas_post_llamada text,
    transcripcion_source text DEFAULT 'note'::text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT calls_outcome_chk CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['interesado'::text, 'dudoso'::text, 'no_interesado'::text, 'no_contestado'::text, 'agente_bloqueado'::text, 'otro'::text, 'no_interesa'::text, 'volver'::text, 'no_contesta'::text])))),
    CONSTRAINT calls_sentiment_chk CHECK (((sentiment IS NULL) OR (sentiment = ANY (ARRAY['positivo'::text, 'neutro'::text, 'negativo'::text]))))
);


--
-- Name: catastro_authority_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catastro_authority_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refcatastral_14 text NOT NULL,
    refcatastral_20 text,
    direccion_oficial text,
    lat double precision,
    lon double precision,
    numero_plantas integer,
    plantas jsonb DEFAULT '[]'::jsonb NOT NULL,
    viviendas_total integer,
    locales_total integer,
    garajes_total integer,
    ano_construccion integer,
    superficie_parcela_m2 numeric,
    usos jsonb,
    confidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    flags jsonb DEFAULT '[]'::jsonb NOT NULL,
    errors jsonb DEFAULT '[]'::jsonb NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    n_subparcelas_residenciales integer
);


--
-- Name: catastro_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.catastro_data (
    refcatastral text NOT NULL,
    building_id uuid,
    lat double precision,
    lon double precision,
    plano_url text,
    dnprc_json jsonb,
    ancho_calle_m numeric,
    fetched_at timestamp with time zone,
    fetch_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    plantas_pdf_url text,
    plantas_pages_urls jsonb,
    plantas_num_pages integer,
    plantas_pdf_disponible boolean DEFAULT false,
    fetch_quality text DEFAULT 'high'::text,
    fxcc_pdf_url text,
    fxcc_pages_urls jsonb,
    fxcc_num_pages integer,
    fxcc_disponible boolean DEFAULT false NOT NULL,
    fxcc_source text
);


--
-- Name: coach_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coach_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    week_start date NOT NULL,
    week_end date NOT NULL,
    fortalezas jsonb DEFAULT '[]'::jsonb NOT NULL,
    mejoras jsonb DEFAULT '[]'::jsonb NOT NULL,
    frases_ganadoras text[] DEFAULT '{}'::text[] NOT NULL,
    plan_accion jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_calls integer DEFAULT 0,
    metricas jsonb DEFAULT '{}'::jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    comercial_hs_id text
);


--
-- Name: companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    cif text,
    email text,
    telefono text,
    buyer_persona public.buyer_persona DEFAULT 'sin_clasificar'::public.buyer_persona NOT NULL,
    consentimiento boolean DEFAULT false NOT NULL,
    notas text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: compliance_cases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_cases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    scope_type text NOT NULL,
    scope_id uuid,
    estado public.compliance_status DEFAULT 'pendiente'::public.compliance_status NOT NULL,
    dpia_ok boolean DEFAULT false NOT NULL,
    motivo text NOT NULL,
    evidencia text,
    owner_revisor text,
    resuelto_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deals_gemelos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deals_gemelos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    hs_deal_nuestro text,
    hs_deal_gemelo text NOT NULL,
    dealname text,
    notas_recuperadas integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: enrichment_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    reglas jsonb DEFAULT '{}'::jsonb NOT NULL,
    parametros jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: enrichment_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    nota_simple_id uuid,
    titular_nombre text NOT NULL,
    titular_apellido1 text,
    titular_apellido2 text,
    titular_tipo text NOT NULL,
    titular_nif text,
    titular_pct numeric,
    fase text NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    datos jsonb DEFAULT '{}'::jsonb NOT NULL,
    intentos integer DEFAULT 0 NOT NULL,
    max_intentos integer DEFAULT 3 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now(),
    error text,
    lease_token uuid,
    lease_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enrichment_jobs_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'en_curso'::text, 'esperando_navegador'::text, 'requiere_revision'::text, 'requiere_humano'::text, 'ok'::text, 'error'::text, 'descartado'::text]))),
    CONSTRAINT enrichment_jobs_fase_check CHECK ((fase = ANY (ARRAY['datoscif'::text, 'inglobaly'::text, 'tecnofind'::text, 'verificacion'::text, 'hubspot'::text]))),
    CONSTRAINT enrichment_jobs_titular_tipo_check CHECK ((titular_tipo = ANY (ARRAY['persona'::text, 'empresa'::text])))
);


--
-- Name: enrichment_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    propuesta jsonb DEFAULT '{}'::jsonb NOT NULL,
    decision text DEFAULT 'pendiente'::text NOT NULL,
    aprobado_por uuid,
    aprobado_at timestamp with time zone,
    motivo text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT enrichment_verifications_decision_check CHECK ((decision = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text])))
);


--
-- Name: escaleras_control_set; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escaleras_control_set (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_name text NOT NULL,
    building_id uuid NOT NULL,
    gt integer NOT NULL,
    seed text NOT NULL,
    rank integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: escaleras_eval_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escaleras_eval_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    set_name text NOT NULL,
    version text NOT NULL,
    building_id uuid NOT NULL,
    gt integer NOT NULL,
    pred_n integer,
    pred_segundas boolean,
    needs_review boolean DEFAULT false NOT NULL,
    confidence numeric,
    evidencia jsonb,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: escaleras_validation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escaleras_validation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    direccion text,
    rc14 text,
    n_escaleras_detectado integer,
    segundas_escaleras boolean,
    evidencia jsonb DEFAULT '{}'::jsonb,
    confianza numeric,
    motivo text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    detectado_en timestamp with time zone DEFAULT now() NOT NULL,
    validado_por uuid,
    validado_at timestamp with time zone,
    validado_n_escaleras integer,
    validado_resultado boolean
);


--
-- Name: esquina_validation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.esquina_validation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid,
    direccion text,
    rc14 text,
    tipo_anterior text,
    tipo_nuevo text,
    is_corner_anterior boolean,
    is_corner_nuevo boolean,
    n_frentes integer,
    street_names text[],
    confianza numeric,
    nota text,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    detectado_en timestamp with time zone DEFAULT now() NOT NULL,
    validado_por uuid,
    validado_at timestamp with time zone,
    validado_tipo text,
    validado_resultado boolean
);


--
-- Name: external_ids; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.external_ids (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    provider text NOT NULL,
    provider_object_type text NOT NULL,
    provider_id text NOT NULL,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: facade_window_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facade_window_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    refcatastral_14 text NOT NULL,
    vlm_raw_response text NOT NULL,
    vlm_parsed jsonb,
    street_view_panoramas jsonb DEFAULT '[]'::jsonb NOT NULL,
    fachada_principal jsonb NOT NULL,
    fachada_secundaria jsonb,
    longitud_fachada_m numeric,
    longitud_fachada_source text,
    final_count integer NOT NULL,
    ejes_verticales integer NOT NULL,
    confidence text NOT NULL,
    flags text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    es_esquina boolean,
    esquina_source text,
    fachadas_a_calle jsonb,
    longitud_fachada_total_m numeric
);


--
-- Name: COLUMN facade_window_counts.es_esquina; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facade_window_counts.es_esquina IS 'true si el poligono tiene >=2 aristas a calle con angulo en [60, 120] grados';


--
-- Name: COLUMN facade_window_counts.esquina_source; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facade_window_counts.esquina_source IS 'geometria | vlm_fallback | desconocido';


--
-- Name: COLUMN facade_window_counts.fachadas_a_calle; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facade_window_counts.fachadas_a_calle IS 'Array de aristas a calle: [{bearing, len, heading, midpoint, role}]';


--
-- Name: COLUMN facade_window_counts.longitud_fachada_total_m; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.facade_window_counts.longitud_fachada_total_m IS 'Suma de longitudes de TODAS las aristas a calle';


--
-- Name: facade_window_ground_truth; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.facade_window_ground_truth (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    direccion text NOT NULL,
    human_count integer NOT NULL,
    model_count integer,
    delta integer GENERATED ALWAYS AS ((human_count - COALESCE(model_count, human_count))) STORED,
    annotated_image_path text,
    rule_learned text,
    notes text,
    source text DEFAULT 'human_truth'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: guard_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.guard_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    guarda smallint NOT NULL,
    entity_type text NOT NULL,
    entity_id text NOT NULL,
    edificio_id uuid,
    titulo text NOT NULL,
    detalle text,
    propuesta jsonb DEFAULT '{}'::jsonb NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    creado_at timestamp with time zone DEFAULT now() NOT NULL,
    resuelto_at timestamp with time zone,
    resuelto_por text,
    CONSTRAINT guard_proposals_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aprobada'::text, 'rechazada'::text])))
);


--
-- Name: hubspot_calls; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_calls (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_id text NOT NULL,
    hs_call_title text,
    hs_call_body text,
    hs_call_status text,
    hs_call_direction text,
    hs_call_disposition text,
    hs_call_duration integer,
    hs_call_recording_url text,
    hs_call_to_number text,
    hs_call_from_number text,
    hs_timestamp timestamp with time zone,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    associated_contact_ids text[] DEFAULT '{}'::text[],
    associated_deal_ids text[] DEFAULT '{}'::text[],
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    hs_owner_id text,
    hs_call_transcription text,
    hs_call_source text,
    hs_call_summary text
);


--
-- Name: hubspot_changes_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_changes_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_type text NOT NULL,
    hs_id text NOT NULL,
    field text NOT NULL,
    old_value text,
    new_value text,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    sync_run_id uuid
);


--
-- Name: hubspot_communications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_communications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_id text NOT NULL,
    hs_communication_channel_type text,
    hs_communication_body text,
    hs_communication_logged_from text,
    hs_timestamp timestamp with time zone,
    hs_owner_id text,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    associated_contact_ids text[] DEFAULT '{}'::text[] NOT NULL,
    associated_deal_ids text[] DEFAULT '{}'::text[] NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_deals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_deals (
    hs_id text NOT NULL,
    dealname text,
    dealstage text,
    pipeline text,
    hs_owner_id text,
    amount numeric,
    closedate timestamp with time zone,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    cobertura_del_edificio text,
    n_total_de_copropietarios text,
    associated_contact_ids text[] DEFAULT '{}'::text[],
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_emails (
    hs_id text NOT NULL,
    hs_email_subject text,
    hs_email_text text,
    hs_email_html text,
    hs_email_direction text,
    hs_email_status text,
    hs_email_from_email text,
    hs_email_to_email text,
    hs_timestamp timestamp with time zone,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    hs_owner_id text,
    associated_contact_ids text[] DEFAULT '{}'::text[],
    associated_deal_ids text[] DEFAULT '{}'::text[],
    raw jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_link_review; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_link_review (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_contact_id text NOT NULL,
    firstname text,
    lastname text,
    email text,
    phone text,
    refs_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    reason text,
    candidates jsonb DEFAULT '[]'::jsonb NOT NULL,
    resolved_owner_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_list_memberships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_list_memberships (
    hs_list_id text NOT NULL,
    record_id text NOT NULL,
    object_type text NOT NULL,
    added_at timestamp with time zone,
    observed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_list_id text NOT NULL,
    name text,
    list_type text,
    object_type_id text,
    processing_type text,
    size integer,
    created_at_hs timestamp with time zone,
    updated_at_hs timestamp with time zone,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_meetings (
    hs_id text NOT NULL,
    hs_meeting_title text,
    hs_meeting_body text,
    hs_meeting_start_time timestamp with time zone,
    hs_meeting_end_time timestamp with time zone,
    hs_meeting_outcome text,
    hs_meeting_location text,
    hs_timestamp timestamp with time zone,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    hs_owner_id text,
    associated_contact_ids text[] DEFAULT '{}'::text[],
    associated_deal_ids text[] DEFAULT '{}'::text[],
    raw jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_id text NOT NULL,
    hs_note_body text,
    hs_timestamp timestamp with time zone,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    associated_contact_ids text[] DEFAULT '{}'::text[],
    associated_deal_ids text[] DEFAULT '{}'::text[],
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_owners (
    hs_owner_id text NOT NULL,
    email text,
    first_name text,
    last_name text,
    full_name text,
    archived boolean DEFAULT false NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_snapshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    taken_at timestamp with time zone DEFAULT now() NOT NULL,
    entity_type text NOT NULL,
    total_count integer NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: hubspot_sync_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_sync_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    status text DEFAULT 'running'::text NOT NULL,
    pages_fetched integer DEFAULT 0 NOT NULL,
    records_upserted integer DEFAULT 0 NOT NULL,
    records_failed integer DEFAULT 0 NOT NULL,
    error_message text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_sync_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_sync_state (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity text NOT NULL,
    cursor text,
    last_full_sync_at timestamp with time zone,
    last_run_at timestamp with time zone,
    last_run_status text,
    total_synced integer DEFAULT 0 NOT NULL,
    last_error text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_id text NOT NULL,
    hs_task_subject text,
    hs_task_body text,
    hs_task_status text,
    hs_task_priority text,
    hs_task_type text,
    hs_timestamp timestamp with time zone,
    hs_task_completion_date timestamp with time zone,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    associated_contact_ids text[] DEFAULT '{}'::text[],
    associated_deal_ids text[] DEFAULT '{}'::text[],
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: hubspot_whatsapp; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.hubspot_whatsapp (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    hs_id text NOT NULL,
    hs_communication_channel_type text,
    hs_communication_body text,
    hs_communication_logged_from text,
    hs_timestamp timestamp with time zone,
    hs_owner_id text,
    hs_createdate timestamp with time zone,
    hs_lastmodifieddate timestamp with time zone,
    associated_contact_ids text[] DEFAULT '{}'::text[] NOT NULL,
    associated_deal_ids text[] DEFAULT '{}'::text[] NOT NULL,
    raw jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: investors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.investors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    email text,
    telefono text,
    ticket_min numeric(14,2),
    ticket_max numeric(14,2),
    ciudades text[] DEFAULT '{}'::text[] NOT NULL,
    tipos_activo public.asset_type[] DEFAULT '{}'::public.asset_type[] NOT NULL,
    consentimiento boolean DEFAULT false NOT NULL,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: knowledge_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    origen text NOT NULL,
    referencia_id uuid,
    scope_type text,
    scope_id uuid,
    contenido text NOT NULL,
    embedding public.vector(768),
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    document_id uuid
);


--
-- Name: knowledge_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    storage_path text NOT NULL,
    mime_type text,
    size_bytes bigint,
    origen text NOT NULL,
    num_chunks integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pendiente'::text NOT NULL,
    error text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: madrid_barrio_clusters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.madrid_barrio_clusters (
    barrio_norm text NOT NULL,
    distrito text NOT NULL,
    barrio text NOT NULL,
    cluster text NOT NULL,
    cluster_secundario text,
    notas text,
    CONSTRAINT madrid_barrio_clusters_cluster_check CHECK ((cluster = ANY (ARRAY['ultra_prime'::text, 'prime_value_add'::text, 'flex_living_core'::text, 'outer_distressed'::text, 'outer_distressed_selectivo'::text, 'baja_prioridad'::text])))
);


--
-- Name: madrid_calles_comerciales; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.madrid_calles_comerciales (
    calle_norm text NOT NULL,
    calle text NOT NULL,
    tipo text NOT NULL,
    CONSTRAINT madrid_calles_comerciales_tipo_check CHECK ((tipo = ANY (ARRAY['buena'::text, 'mala'::text])))
);


--
-- Name: madrid_calles_subzona; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.madrid_calles_subzona (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    calle_norm text NOT NULL,
    numero_desde integer,
    numero_hasta integer,
    barrio text,
    sub_zona text NOT NULL,
    cluster_override text NOT NULL,
    notas text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    especificidad smallint DEFAULT 2 NOT NULL
);


--
-- Name: madrid_edificios_protegidos; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.madrid_edificios_protegidos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refcat text,
    refcat_norm text,
    direccion text,
    direccion_norm text,
    nivel_proteccion text,
    fuente text DEFAULT 'pgou_catalogo'::text NOT NULL,
    raw jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: match_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.match_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    asset_id uuid NOT NULL,
    investor_id uuid NOT NULL,
    score numeric(3,2) NOT NULL,
    evidencia text,
    estado public.match_status DEFAULT 'propuesto'::public.match_status NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: next_actions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.next_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    asset_id uuid,
    titulo text NOT NULL,
    detalle text,
    vencimiento date,
    estado public.next_action_status DEFAULT 'pendiente'::public.next_action_status NOT NULL,
    origen text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    scope_type text,
    scope_id uuid
);


--
-- Name: nota_simple_titulares; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nota_simple_titulares (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nota_simple_id uuid NOT NULL,
    owner_id uuid,
    company_id uuid,
    nombre_extraido text,
    cif_dni text,
    porcentaje numeric,
    rol public.nota_titular_rol DEFAULT 'pleno'::public.nota_titular_rol NOT NULL,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    rol_literal text,
    evidencia jsonb
);


--
-- Name: notas_fuera_universo; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notas_fuera_universo (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nota_simple_id uuid,
    hs_deal_id text NOT NULL,
    dealname text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    asset_id uuid,
    texto text NOT NULL,
    etiquetas text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: org_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    clave text NOT NULL,
    valor jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: owner_call_building_assignment; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_call_building_assignment (
    hs_id text NOT NULL,
    owner_id uuid NOT NULL,
    building_id uuid NOT NULL,
    assigned_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: owner_call_prep_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_call_prep_cache (
    owner_id uuid NOT NULL,
    kpis_json jsonb,
    brief_json jsonb,
    kpis_generated_at timestamp with time zone,
    brief_generated_at timestamp with time zone,
    kpis_last_activity_at timestamp with time zone,
    brief_last_activity_at timestamp with time zone,
    kpis_model text,
    brief_model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: owner_companies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid NOT NULL,
    company_id uuid NOT NULL,
    role public.owner_company_role NOT NULL,
    percentage numeric,
    source text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: owner_kpis_state; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.owner_kpis_state AS
 WITH kpi_events AS (
         SELECT cs.owner_id,
            (item.value ->> 'k'::text) AS k,
            LEAST(cs.finalizada_at, cs.cerrada_at, cs.updated_at) AS at,
            cs.hubspot_call_id
           FROM public.call_sessions cs,
            LATERAL jsonb_array_elements(COALESCE(cs.checklist, '[]'::jsonb)) item(value)
          WHERE ((cs.estado = 'finalizada'::text) AND (((item.value ->> 'done'::text))::boolean IS TRUE) AND (cs.owner_id IS NOT NULL))
        UNION ALL
         SELECT c.owner_id,
            'whatsapp'::text AS k,
            c.fecha,
            (c.metadatos ->> 'hubspot_call_id'::text)
           FROM public.calls c
          WHERE ((c.owner_id IS NOT NULL) AND (((c.metadatos ->> 'whatsapp_enviado'::text))::boolean IS TRUE))
        UNION ALL
         SELECT c.owner_id,
            'pixel'::text AS text,
            c.fecha,
            (c.metadatos ->> 'hubspot_call_id'::text)
           FROM public.calls c
          WHERE ((c.owner_id IS NOT NULL) AND (((c.metadatos ->> 'pixel_enviado'::text))::boolean IS TRUE))
        UNION ALL
         SELECT c.owner_id,
            'reunion'::text AS text,
            c.fecha,
            (c.metadatos ->> 'hubspot_call_id'::text)
           FROM public.calls c
          WHERE ((c.owner_id IS NOT NULL) AND (((c.metadatos ->> 'reunion_cerrada'::text))::boolean IS TRUE))
        )
 SELECT owner_id,
    k,
    min(at) AS first_done_at,
    (array_agg(hubspot_call_id ORDER BY at))[1] AS first_hubspot_call_id,
    count(*) AS times_done
   FROM kpi_events
  WHERE (at IS NOT NULL)
  GROUP BY owner_id, k;


--
-- Name: owner_merge_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_merge_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    canonical_owner_id uuid NOT NULL,
    merged_owner_id uuid NOT NULL,
    name_norm text,
    nif text,
    reason text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: owner_relations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owner_relations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_a_id uuid NOT NULL,
    owner_b_id uuid NOT NULL,
    relation_type public.owner_relation_type NOT NULL,
    percentage numeric,
    notes text,
    source text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT owner_relations_distinct CHECK ((owner_a_id <> owner_b_id))
);


--
-- Name: owners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.owners (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    nombre text NOT NULL,
    email text,
    telefono text,
    rol public.owner_role DEFAULT 'desconocido'::public.owner_role NOT NULL,
    rol_confianza numeric(3,2),
    rol_justificacion text,
    consentimiento boolean DEFAULT false NOT NULL,
    notas_breves text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    fecha_nacimiento date,
    estado_vital text,
    edad_anios integer,
    subrole public.owner_subrole DEFAULT 'ninguno'::public.owner_subrole NOT NULL,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    last_synced_at timestamp with time zone,
    buyer_persona public.buyer_persona DEFAULT 'sin_clasificar'::public.buyer_persona NOT NULL,
    merged_into uuid,
    nombre_display text
);


--
-- Name: parcel_geometry_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.parcel_geometry_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    refcatastral_14 text NOT NULL,
    exterior_ring jsonb NOT NULL,
    interior_rings jsonb DEFAULT '[]'::jsonb NOT NULL,
    bbox jsonb NOT NULL,
    centroid jsonb NOT NULL,
    area_m2 numeric,
    perimeter_m numeric,
    source text NOT NULL,
    confidence text NOT NULL,
    osm_id bigint,
    osm_type text,
    flags text[] DEFAULT '{}'::text[] NOT NULL,
    raw_response jsonb,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '180 days'::interval) NOT NULL,
    street_edges_jsonb jsonb,
    is_corner boolean,
    total_street_length_m numeric,
    corner_type text,
    street_names_distinct text[],
    frentes_jsonb jsonb
);


--
-- Name: patio_window_counts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patio_window_counts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    refcatastral_14 text NOT NULL,
    patios_detectados jsonb NOT NULL,
    estimacion_total integer NOT NULL,
    estimacion_rango jsonb NOT NULL,
    metodo text NOT NULL,
    confianza text NOT NULL,
    flags text[] DEFAULT '{}'::text[] NOT NULL,
    notas text,
    densidad_patio_m numeric,
    plantas_residenciales integer,
    numero_viviendas integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pending_conversation_emails; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pending_conversation_emails (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    contact_id uuid,
    phone text,
    kind text NOT NULL,
    send_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    last_error text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    email text,
    full_name text,
    avatar_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: proteccion_validation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proteccion_validation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    direccion text,
    rc14 text,
    estado text NOT NULL,
    capa text,
    nivel_proteccion text,
    n_catalogo text,
    nota text,
    detectado_en timestamp with time zone DEFAULT now() NOT NULL,
    validado_por uuid,
    validado_at timestamp with time zone,
    validado_resultado boolean,
    CONSTRAINT proteccion_validation_queue_estado_check CHECK ((estado = ANY (ARRAY['hit_pgou'::text, 'marcado_pero_miss'::text, 'needs_review_sin_fuente'::text])))
);


--
-- Name: qa_ground_truth; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.qa_ground_truth (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lista text NOT NULL,
    direccion_raw text NOT NULL,
    direccion_norm text NOT NULL,
    deal_id text,
    zona text,
    ano integer,
    m2_tot integer,
    m2_viv integer,
    pct_viv numeric,
    dh boolean,
    escaleras integer,
    n_viv integer,
    m2_per_viv integer,
    propietarios integer,
    tipo text,
    motivo text,
    building_id uuid,
    matched_by text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    es_esquina boolean,
    ventanas_fachada integer,
    ventanas_patio integer,
    cluster_label text,
    protegido boolean,
    verificado_por text,
    verificado_at timestamp with time zone,
    fuente_verificacion text,
    CONSTRAINT qa_ground_truth_lista_check CHECK ((lista = ANY (ARRAY['buenos'::text, 'malos'::text, 'dos_escaleras'::text])))
);


--
-- Name: reconciliation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    nota_simple_id uuid,
    titular_id uuid,
    titular_nombre text,
    titular_cif_dni text,
    titular_pct numeric,
    match_kind text DEFAULT 'none'::text NOT NULL,
    match_owner_id uuid,
    match_company_id uuid,
    candidatos jsonb DEFAULT '[]'::jsonb NOT NULL,
    estado text DEFAULT 'pendiente'::text NOT NULL,
    motivo text,
    source text DEFAULT 'reconciliacion_determinista_2026-08-10'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    requisitos jsonb,
    apto_auto boolean DEFAULT false NOT NULL,
    CONSTRAINT reconciliation_queue_estado_check CHECK ((estado = ANY (ARRAY['pendiente'::text, 'aplicado'::text, 'descartado'::text, 'revision'::text]))),
    CONSTRAINT reconciliation_queue_match_kind_check CHECK ((match_kind = ANY (ARRAY['dni_exacto'::text, 'fuzzy'::text, 'multiple'::text, 'none'::text])))
);


--
-- Name: scoring_v2_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_v2_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    building_id uuid NOT NULL,
    aviso_key text NOT NULL,
    vote integer NOT NULL,
    user_email text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_id uuid,
    tipo text,
    valor text,
    comentario text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT scoring_v2_feedback_vote_check CHECK ((vote = ANY (ARRAY['-1'::integer, 1])))
);


--
-- Name: scoring_v2_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_v2_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phase text,
    status text DEFAULT 'pending'::text NOT NULL,
    total integer DEFAULT 0,
    processed integer DEFAULT 0,
    failed integer DEFAULT 0,
    log jsonb DEFAULT '[]'::jsonb,
    started_at timestamp with time zone DEFAULT now(),
    finished_at timestamp with time zone,
    cursor text,
    kind text DEFAULT 'single'::text,
    current_phase text,
    phase_progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    items_status jsonb DEFAULT '[]'::jsonb NOT NULL,
    error text
);


--
-- Name: scoring_v2_seed; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scoring_v2_seed (
    edificio text NOT NULL,
    direccion text,
    hubspot_deal_id text,
    raw jsonb,
    matched_building_id uuid,
    matched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    role public.app_role NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: v_building_calls; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_calls AS
 WITH building_deals AS (
         SELECT external_ids.entity_id AS building_id,
            external_ids.provider_id AS hs_deal_id
           FROM public.external_ids
          WHERE ((external_ids.entity_type = 'building'::text) AND (external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'deal'::text))
        ), owner_contacts AS (
         SELECT external_ids.entity_id AS owner_id,
            external_ids.provider_id AS hs_contact_id
           FROM public.external_ids
          WHERE ((external_ids.entity_type = 'owner'::text) AND (external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'contact'::text))
        )
 SELECT DISTINCT bd.building_id,
    hc.hs_id,
    hc.hs_timestamp,
    hc.hs_call_direction AS direccion,
    (round(((COALESCE(hc.hs_call_duration, 0))::numeric / 1000.0)))::integer AS duracion_seg,
    hc.hs_call_body AS nota,
    (COALESCE(hc.hs_call_recording_url, ''::text) <> ''::text) AS tiene_grabacion,
    COALESCE(( SELECT bo.owner_id
           FROM (public.building_owners bo
             JOIN owner_contacts oc ON ((oc.owner_id = bo.owner_id)))
          WHERE ((bo.building_id = bd.building_id) AND (oc.hs_contact_id = ANY (hc.associated_contact_ids)))
         LIMIT 1), ( SELECT bo.owner_id
           FROM (public.building_owners bo
             JOIN public.owners o ON ((o.id = bo.owner_id)))
          WHERE ((bo.building_id = bd.building_id) AND (public.norm_phone(o.telefono) IS NOT NULL) AND ((public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_to_number)) OR (public.norm_phone(o.telefono) = public.norm_phone(hc.hs_call_from_number))))
         LIMIT 1)) AS owner_id
   FROM (public.hubspot_calls hc
     JOIN building_deals bd ON ((bd.hs_deal_id = ANY (hc.associated_deal_ids))));


--
-- Name: v_building_common_intel; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_common_intel AS
 WITH sessions AS (
         SELECT cs.building_id,
            cs.owner_id,
            cs.finalizada_at,
            cs.voss_post,
            cs.hubspot_call_id
           FROM public.call_sessions cs
          WHERE ((cs.estado = 'finalizada'::text) AND (cs.building_id IS NOT NULL) AND (cs.voss_post IS NOT NULL))
        ), prices AS (
         SELECT s.building_id,
            s.owner_id,
            s.finalizada_at AS at,
            s.hubspot_call_id,
            (NULLIF(regexp_replace(COALESCE((s.voss_post #>> '{intel_edificio,precio_o_oferta}'::text[]), (s.voss_post #>> '{inteligencia_edificio,precio_o_oferta}'::text[]), ''::text), '[^0-9]'::text, ''::text, 'g'::text), ''::text))::bigint AS amount,
            COALESCE((s.voss_post #>> '{intel_edificio,precio_o_oferta}'::text[]), (s.voss_post #>> '{inteligencia_edificio,precio_o_oferta}'::text[])) AS raw
           FROM sessions s
        ), blockers AS (
         SELECT s.building_id,
            s.owner_id,
            s.finalizada_at AS at,
            COALESCE((s.voss_post #>> '{intel_edificio,bloqueador}'::text[]), (s.voss_post #>> '{inteligencia_edificio,bloqueador}'::text[])) AS bloqueador,
            COALESCE((s.voss_post #>> '{intel_edificio,gestor}'::text[]), (s.voss_post #>> '{inteligencia_edificio,gestor}'::text[]), (s.voss_post #>> '{intel_edificio,portavoz}'::text[])) AS gestor,
            COALESCE((s.voss_post #>> '{intel_edificio,conflicto}'::text[]), (s.voss_post #>> '{inteligencia_edificio,conflicto}'::text[])) AS conflicto,
            COALESCE((s.voss_post #>> '{intel_edificio,estado_venta}'::text[]), (s.voss_post #>> '{inteligencia_edificio,estado_venta}'::text[])) AS estado_venta
           FROM sessions s
        ), price_agg AS (
         SELECT prices.building_id,
            jsonb_agg(jsonb_build_object('owner_id', prices.owner_id, 'at', prices.at, 'hubspot_call_id', prices.hubspot_call_id, 'amount', prices.amount, 'raw', prices.raw) ORDER BY prices.at DESC) FILTER (WHERE ((prices.raw IS NOT NULL) AND (prices.raw <> ''::text))) AS mentions,
            min(prices.amount) FILTER (WHERE (prices.amount IS NOT NULL)) AS min_amount,
            max(prices.amount) FILTER (WHERE (prices.amount IS NOT NULL)) AS max_amount,
            count(DISTINCT prices.amount) FILTER (WHERE (prices.amount IS NOT NULL)) AS distinct_amounts
           FROM prices
          GROUP BY prices.building_id
        )
 SELECT b.building_id,
    COALESCE(pa.mentions, '[]'::jsonb) AS precios_mencionados,
    pa.min_amount,
    pa.max_amount,
        CASE
            WHEN ((pa.min_amount IS NOT NULL) AND (pa.max_amount IS NOT NULL) AND (((pa.max_amount - pa.min_amount) > 500000) OR ((((pa.max_amount - pa.min_amount))::numeric / (NULLIF(pa.min_amount, 0))::numeric) > 0.10))) THEN true
            ELSE false
        END AS precio_discrepancia,
    ( SELECT jsonb_agg(DISTINCT jsonb_build_object('at', bl.at, 'owner_id', bl.owner_id, 'texto', bl.bloqueador)) AS jsonb_agg
           FROM blockers bl
          WHERE ((bl.building_id = b.building_id) AND (bl.bloqueador IS NOT NULL) AND (bl.bloqueador <> ''::text))) AS bloqueadores,
    ( SELECT jsonb_agg(DISTINCT jsonb_build_object('at', bl.at, 'owner_id', bl.owner_id, 'texto', bl.gestor)) AS jsonb_agg
           FROM blockers bl
          WHERE ((bl.building_id = b.building_id) AND (bl.gestor IS NOT NULL) AND (bl.gestor <> ''::text))) AS gestores,
    ( SELECT jsonb_agg(DISTINCT jsonb_build_object('at', bl.at, 'owner_id', bl.owner_id, 'texto', bl.conflicto)) AS jsonb_agg
           FROM blockers bl
          WHERE ((bl.building_id = b.building_id) AND (bl.conflicto IS NOT NULL) AND (bl.conflicto <> ''::text))) AS conflictos,
    ( SELECT jsonb_agg(DISTINCT jsonb_build_object('at', bl.at, 'owner_id', bl.owner_id, 'texto', bl.estado_venta)) AS jsonb_agg
           FROM blockers bl
          WHERE ((bl.building_id = b.building_id) AND (bl.estado_venta IS NOT NULL) AND (bl.estado_venta <> ''::text))) AS estados_venta
   FROM (( SELECT DISTINCT sessions.building_id
           FROM sessions) b
     LEFT JOIN price_agg pa USING (building_id));


--
-- Name: v_building_conversations; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_conversations AS
 WITH deal_to_building AS (
         SELECT external_ids.entity_id AS building_id,
            external_ids.provider_id AS deal_hs_id
           FROM public.external_ids
          WHERE ((external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'deal'::text))
        )
 SELECT db.building_id,
    'call'::text AS kind,
    c.hs_id,
    c.hs_timestamp AS ts,
    c.hs_call_body AS body,
    c.hs_call_duration AS duration_seg,
    c.hs_call_direction AS direction,
    c.hs_owner_id,
    c.associated_contact_ids,
    c.associated_deal_ids
   FROM (public.hubspot_calls c
     JOIN deal_to_building db ON ((db.deal_hs_id = ANY (c.associated_deal_ids))))
UNION ALL
 SELECT db.building_id,
    'whatsapp'::text AS kind,
    w.hs_id,
    w.hs_timestamp AS ts,
    w.hs_communication_body AS body,
    NULL::integer AS duration_seg,
    NULL::text AS direction,
    w.hs_owner_id,
    w.associated_contact_ids,
    w.associated_deal_ids
   FROM (public.hubspot_whatsapp w
     JOIN deal_to_building db ON ((db.deal_hs_id = ANY (w.associated_deal_ids))))
UNION ALL
 SELECT db.building_id,
    'note'::text AS kind,
    n.hs_id,
    n.hs_timestamp AS ts,
    n.hs_note_body AS body,
    NULL::integer AS duration_seg,
    NULL::text AS direction,
    NULL::text AS hs_owner_id,
    n.associated_contact_ids,
    n.associated_deal_ids
   FROM (public.hubspot_notes n
     JOIN deal_to_building db ON ((db.deal_hs_id = ANY (n.associated_deal_ids))));


--
-- Name: v_building_graph; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_graph WITH (security_invoker='true') AS
 SELECT b.id AS building_id,
    b.direccion,
    b.ciudad,
    b.estado,
    b.numero_propietarios,
    COALESCE(o.owners_count, 0) AS owners_count,
    COALESCE(co.companies_count, 0) AS companies_count,
    COALESCE(n.notas_count, 0) AS notas_count,
    COALESCE(i.influencers_count, 0) AS influencers_count
   FROM ((((public.buildings b
     LEFT JOIN ( SELECT building_owners.building_id,
            (count(*))::integer AS owners_count
           FROM public.building_owners
          GROUP BY building_owners.building_id) o ON ((o.building_id = b.id)))
     LEFT JOIN ( SELECT building_companies.building_id,
            (count(*))::integer AS companies_count
           FROM public.building_companies
          GROUP BY building_companies.building_id) co ON ((co.building_id = b.id)))
     LEFT JOIN ( SELECT notas_simples.building_id,
            (count(*))::integer AS notas_count
           FROM public.notas_simples
          WHERE (notas_simples.building_id IS NOT NULL)
          GROUP BY notas_simples.building_id) n ON ((n.building_id = b.id)))
     LEFT JOIN ( SELECT building_owners.building_id,
            (count(*))::integer AS influencers_count
           FROM public.building_owners
          WHERE (building_owners.es_influencer = true)
          GROUP BY building_owners.building_id) i ON ((i.building_id = b.id)));


--
-- Name: v_rights_layer_check; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_rights_layer_check AS
 SELECT building_id,
    note_simple_id,
    right_type,
    count(*) AS n_titulares,
    round(sum(COALESCE(percentage, (0)::numeric)), 2) AS suma_capa,
    bool_and((percentage IS NOT NULL)) AS todos_con_pct,
    ((abs((sum(COALESCE(percentage, (0)::numeric)) - (100)::numeric)) <= 0.5) AND bool_and((percentage IS NOT NULL))) AS capa_100
   FROM public.building_property_rights r
  WHERE (status = 'active'::text)
  GROUP BY building_id, note_simple_id, right_type;


--
-- Name: v_building_rights_status; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_rights_status AS
 WITH notas AS (
         SELECT building_property_rights.building_id,
            count(DISTINCT building_property_rights.note_simple_id) AS n_notas
           FROM public.building_property_rights
          WHERE (building_property_rights.status = 'active'::text)
          GROUP BY building_property_rights.building_id
        ), capas AS (
         SELECT v_rights_layer_check.building_id,
            bool_and(v_rights_layer_check.capa_100) AS todas_capas_100,
            count(*) FILTER (WHERE (NOT v_rights_layer_check.capa_100)) AS capas_malas,
            jsonb_agg(jsonb_build_object('nota', v_rights_layer_check.note_simple_id, 'capa', v_rights_layer_check.right_type, 'suma', v_rights_layer_check.suma_capa, 'ok', v_rights_layer_check.capa_100)) AS detalle_capas
           FROM public.v_rights_layer_check
          GROUP BY v_rights_layer_check.building_id
        ), pleno_por_nota AS (
         SELECT building_property_rights.building_id,
            building_property_rights.note_simple_id,
            md5(string_agg(COALESCE(public.norm_person_name(building_property_rights.titular_nombre), ''::text), '|'::text ORDER BY (public.norm_person_name(building_property_rights.titular_nombre)))) AS firma
           FROM public.building_property_rights
          WHERE ((building_property_rights.status = 'active'::text) AND (building_property_rights.right_type = ANY (ARRAY['pleno_dominio'::text, 'ganancial'::text])))
          GROUP BY building_property_rights.building_id, building_property_rights.note_simple_id
        ), contra AS (
         SELECT pleno_por_nota.building_id,
            count(DISTINCT pleno_por_nota.firma) AS firmas,
            count(*) AS notas_pleno
           FROM pleno_por_nota
          GROUP BY pleno_por_nota.building_id
        ), ident AS (
         SELECT building_property_rights.building_id,
            count(*) FILTER (WHERE (building_property_rights.identity_match = 'ninguno'::text)) AS sin_identidad,
            count(*) FILTER (WHERE (building_property_rights.identity_match = 'aproximado'::text)) AS identidad_ambigua
           FROM public.building_property_rights
          WHERE (building_property_rights.status = 'active'::text)
          GROUP BY building_property_rights.building_id
        )
 SELECT b.id AS building_id,
    b.direccion,
    COALESCE(n.n_notas, (0)::bigint) AS n_notas,
    COALESCE(c.todas_capas_100, false) AS todas_capas_100,
    COALESCE(c.capas_malas, (0)::bigint) AS capas_malas,
    c.detalle_capas,
    COALESCE(x.firmas, (0)::bigint) AS firmas_pleno,
    COALESCE(i.sin_identidad, (0)::bigint) AS sin_identidad,
    COALESCE(i.identidad_ambigua, (0)::bigint) AS identidad_ambigua,
    array_remove(ARRAY[
        CASE
            WHEN (COALESCE(n.n_notas, (0)::bigint) = 0) THEN 'sin_nota_con_titulares'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(c.capas_malas, (0)::bigint) > 0) THEN 'capa_no_suma_100'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(x.firmas, (0)::bigint) > 1) THEN 'contradiccion_entre_notas'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(i.identidad_ambigua, (0)::bigint) > 0) THEN 'identidad_ambigua'::text
            ELSE NULL::text
        END], NULL::text) AS bloqueos,
    ((COALESCE(n.n_notas, (0)::bigint) > 0) AND COALESCE(c.todas_capas_100, false) AND (COALESCE(x.firmas, (0)::bigint) <= 1) AND (COALESCE(i.identidad_ambigua, (0)::bigint) = 0)) AS apto_para_cuota
   FROM ((((public.buildings b
     LEFT JOIN notas n ON ((n.building_id = b.id)))
     LEFT JOIN capas c ON ((c.building_id = b.id)))
     LEFT JOIN contra x ON ((x.building_id = b.id)))
     LEFT JOIN ident i ON ((i.building_id = b.id)));


--
-- Name: v_building_rights_summary; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_rights_summary WITH (security_invoker='true') AS
 SELECT building_id,
    right_type,
    count(*) AS n_titulares,
    count(*) FILTER (WHERE (percentage IS NULL)) AS n_sin_pct,
    round(sum(COALESCE(percentage, (0)::numeric)), 2) AS suma_pct,
    ((count(*) FILTER (WHERE (percentage IS NULL)) = 0) AND ((sum(COALESCE(percentage, (0)::numeric)) >= (99)::numeric) AND (sum(COALESCE(percentage, (0)::numeric)) <= (101)::numeric))) AS capa_completa
   FROM public.building_property_rights r
  WHERE (status = 'active'::text)
  GROUP BY building_id, right_type;


--
-- Name: v_building_score; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_score AS
 WITH own_counts AS (
         SELECT bo.building_id,
            count(DISTINCT COALESCE(NULLIF(public.normalize_person_name(o.nombre), ''::text), NULLIF(upper((o.metadatos ->> 'nif'::text)), ''::text), NULLIF(upper((o.metadatos ->> 'dni'::text)), ''::text), NULLIF(lower(o.email), ''::text), (o.id)::text)) AS n
           FROM (public.building_owners bo
             JOIN public.owners o ON ((o.id = bo.owner_id)))
          WHERE ((COALESCE(bo.rol_notas, ''::text) !~~* '%representante%'::text) AND (COALESCE(bo.rol_notas, ''::text) !~~* '%apoderado%'::text))
          GROUP BY bo.building_id
        ), comp_counts AS (
         SELECT bc.building_id,
            count(DISTINCT bc.company_id) AS n
           FROM public.building_companies bc
          WHERE (COALESCE((bc.role)::text, ''::text) = ANY (ARRAY['titular'::text, 'usufructuario'::text, 'arrendador'::text, 'otro'::text]))
          GROUP BY bc.building_id
        ), ov AS (
         SELECT building_overrides.building_id,
            (building_overrides.valor_num)::integer AS n
           FROM public.building_overrides
          WHERE ((building_overrides.dimension = 'propietarios'::text) AND (building_overrides.valor_num IS NOT NULL))
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
            (NULLIF((b.metadatos ->> 'metros_cuadrados__exactos_'::text), ''::text))::numeric AS m2_exactos,
            NULLIF((b.metadatos ->> 'metros_cuadrados__rango_'::text), ''::text) AS m2_rango,
            COALESCE((NULLIF((b.metadatos ->> 'viviendas__unidades___clonada_'::text), ''::text))::integer, (NULLIF((b.metadatos ->> 'viviendas__unidades_'::text), ''::text))::integer, (NULLIF((b.metadatos ->> 'num_viviendas'::text), ''::text))::integer) AS viviendas_unidades,
            (COALESCE((ov.n)::bigint, (COALESCE(oc.n, (0)::bigint) + COALESCE(cc.n, (0)::bigint))))::integer AS owners_count
           FROM (((public.buildings b
             LEFT JOIN own_counts oc ON ((oc.building_id = b.id)))
             LEFT JOIN comp_counts cc ON ((cc.building_id = b.id)))
             LEFT JOIN ov ON ((ov.building_id = b.id)))
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
            (NULLIF((agg.md ->> 'metros_cuadrados_comercio'::text), ''::text))::numeric AS m2_comercio_x,
            (COALESCE(NULLIF((agg.md ->> 'metros_cuadrados_oficina'::text), ''::text), NULLIF((agg.md ->> 'metros_cuadrado_oficina'::text), ''::text)))::numeric AS m2_oficina_x,
            (NULLIF((agg.md ->> 'metros_cuadrados_almacen'::text), ''::text))::numeric AS m2_almacen_x,
            (NULLIF((agg.md ->> 'metros_cuadrados_industrial'::text), ''::text))::numeric AS m2_industrial_x,
                CASE
                    WHEN ((agg.m2_exactos IS NOT NULL) AND (((((agg.m2_exactos - COALESCE((NULLIF((agg.md ->> 'metros_cuadrados_comercio'::text), ''::text))::numeric, (0)::numeric)) - COALESCE((COALESCE(NULLIF((agg.md ->> 'metros_cuadrados_oficina'::text), ''::text), NULLIF((agg.md ->> 'metros_cuadrado_oficina'::text), ''::text)))::numeric, (0)::numeric)) - COALESCE((NULLIF((agg.md ->> 'metros_cuadrados_almacen'::text), ''::text))::numeric, (0)::numeric)) - COALESCE((NULLIF((agg.md ->> 'metros_cuadrados_industrial'::text), ''::text))::numeric, (0)::numeric)) > (0)::numeric)) THEN ((((agg.m2_exactos - COALESCE((NULLIF((agg.md ->> 'metros_cuadrados_comercio'::text), ''::text))::numeric, (0)::numeric)) - COALESCE((COALESCE(NULLIF((agg.md ->> 'metros_cuadrados_oficina'::text), ''::text), NULLIF((agg.md ->> 'metros_cuadrado_oficina'::text), ''::text)))::numeric, (0)::numeric)) - COALESCE((NULLIF((agg.md ->> 'metros_cuadrados_almacen'::text), ''::text))::numeric, (0)::numeric)) - COALESCE((NULLIF((agg.md ->> 'metros_cuadrados_industrial'::text), ''::text))::numeric, (0)::numeric))
                    ELSE agg.m2_exactos
                END AS m2_vivienda_calc,
            LEAST(1.0, ((COALESCE(agg.viviendas_unidades, 0))::numeric / 40.0)) AS s_viviendas,
            LEAST(1.0, (COALESCE(agg.m2_exactos, (0)::numeric) / 4000.0)) AS s_m2,
                CASE
                    WHEN (agg.division_horizontal IS FALSE) THEN 1.0
                    ELSE (0)::numeric
                END AS s_no_dh,
                CASE
                    WHEN (agg.owners_count >= 10) THEN 1.00
                    WHEN (agg.owners_count >= 7) THEN 0.90
                    WHEN (agg.owners_count >= 5) THEN 0.75
                    WHEN (agg.owners_count = 4) THEN 0.55
                    WHEN (agg.owners_count >= 2) THEN 0.30
                    ELSE (0)::numeric
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
                    WHEN ((scored.viviendas_unidades > 0) AND (scored.m2_vivienda_calc IS NOT NULL)) THEN GREATEST((0)::numeric, (1.0 - LEAST(1.0, ((scored.m2_vivienda_calc / (NULLIF(scored.viviendas_unidades, 0))::numeric) / 150.0))))
                    ELSE (0)::numeric
                END AS s_ratio,
                CASE
                    WHEN ((scored.viviendas_unidades > 0) AND (scored.m2_vivienda_calc IS NOT NULL)) THEN round((scored.m2_vivienda_calc / (NULLIF(scored.viviendas_unidades, 0))::numeric), 1)
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
            (ba.id IS NOT NULL) AS has_ai_analysis,
            ba.ventanas_fachada_total,
            ba.esquina,
            ba.segundas_escaleras,
            ba.protegido_historicamente,
            ba.plantas_levantables,
            ba.patios_detectados,
            ba.confidence,
                CASE
                    WHEN (ba.metricas_extra ? 'intencion_venta'::text) THEN (NULLIF((ba.metricas_extra ->> 'intencion_venta'::text), ''::text))::boolean
                    ELSE NULL::boolean
                END AS intencion_venta
           FROM (scored2 s
             LEFT JOIN public.building_analysis ba ON ((ba.building_id = s.id)))
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
            round((((((((0.25 * ai.s_m2) + (0.15 * ai.s_viviendas)) + (0.20 * ai.s_ratio)) + (0.20 * ai.s_owners)) + (0.10 * ai.s_no_dh)) + (0.10 *
                CASE
                    WHEN ai.has_ai_analysis THEN COALESCE(ai.confidence, 0.5)
                    ELSE (0)::numeric
                END)) * (100)::numeric), 1) AS score_raw
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
    score_raw AS score,
    jsonb_build_array(jsonb_build_object('key', 'm2', 'label', 'Tamaño', 'pct', round((s_m2 * (100)::numeric), 0), 'weight', 25), jsonb_build_object('key', 'viv', 'label', 'Nº viviendas', 'pct', round((s_viviendas * (100)::numeric), 0), 'weight', 15), jsonb_build_object('key', 'ratio', 'label', 'Ratio m²/viv', 'pct', round((s_ratio * (100)::numeric), 0), 'weight', 20), jsonb_build_object('key', 'owners', 'label', 'Propietarios', 'pct', round((s_owners * (100)::numeric), 0), 'weight', 20), jsonb_build_object('key', 'no_dh', 'label', 'Sin DH', 'pct', round((s_no_dh * (100)::numeric), 0), 'weight', 10), jsonb_build_object('key', 'ai', 'label', 'Confianza IA', 'pct', round((COALESCE(confidence, 0.5) * (100)::numeric), 0), 'weight', 10)) AS score_breakdown,
    b_score_activo AS score_activo,
    b_score_propietarios AS score_propietarios,
    b_score_total AS score_total,
    m2_vivienda_calc,
    ratio_m2_viv
   FROM calc c;


--
-- Name: v_building_score_gate; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_score_gate AS
 WITH r AS (
         SELECT building_property_rights.building_id,
            count(*) FILTER (WHERE (building_property_rights.right_type = 'otro'::text)) AS n_otro,
            count(*) FILTER (WHERE building_property_rights.review_flag) AS n_review,
            count(*) FILTER (WHERE building_property_rights.feeds_cuota) AS n_ok
           FROM public.building_property_rights
          WHERE (building_property_rights.status = 'active'::text)
          GROUP BY building_property_rights.building_id
        ), c AS (
         SELECT building_owners.building_id,
            count(*) FILTER (WHERE (building_owners.cuota_estado = ANY (ARRAY['review'::text, 'superseded'::text]))) AS n_cuota_mala,
            count(*) FILTER (WHERE (building_owners.cuota_estado = 'vigente'::text)) AS n_cuota_ok
           FROM public.building_owners
          GROUP BY building_owners.building_id
        )
 SELECT b.id AS building_id,
    b.direccion,
    COALESCE(r.n_ok, (0)::bigint) AS derechos_usables,
    COALESCE(r.n_review, (0)::bigint) AS derechos_en_revision,
    COALESCE(r.n_otro, (0)::bigint) AS derechos_sin_clasificar,
    COALESCE(c.n_cuota_ok, (0)::bigint) AS cuotas_vigentes,
    COALESCE(c.n_cuota_mala, (0)::bigint) AS cuotas_no_usables,
    array_remove(ARRAY[
        CASE
            WHEN (COALESCE(r.n_ok, (0)::bigint) = 0) THEN 'sin_pleno_dominio_verificado'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(r.n_otro, (0)::bigint) > 0) THEN 'derechos_sin_clasificar'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(r.n_review, (0)::bigint) > 0) THEN 'derechos_en_revision'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (COALESCE(c.n_cuota_mala, (0)::bigint) > 0) THEN 'cuotas_operativas_contradictorias'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT COALESCE(s.apto_para_cuota, false)) THEN 'capa_registral_incompleta'::text
            ELSE NULL::text
        END], NULL::text) AS motivos,
    ((COALESCE(r.n_ok, (0)::bigint) = 0) OR (COALESCE(r.n_otro, (0)::bigint) > 0) OR (COALESCE(r.n_review, (0)::bigint) > 0) OR (COALESCE(c.n_cuota_mala, (0)::bigint) > 0) OR (NOT COALESCE(s.apto_para_cuota, false))) AS score_bloqueado
   FROM (((public.buildings b
     LEFT JOIN r ON ((r.building_id = b.id)))
     LEFT JOIN c ON ((c.building_id = b.id)))
     LEFT JOIN public.v_building_rights_status s ON ((s.building_id = b.id)));


--
-- Name: v_building_sucesion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_building_sucesion WITH (security_invoker='true') AS
 WITH per_owner AS (
         SELECT bo.building_id,
            o.id AS owner_id,
            o.estado_vital,
            o.edad_anios,
            o.fecha_nacimiento
           FROM (public.building_owners bo
             JOIN public.owners o ON ((o.id = bo.owner_id)))
          WHERE (o.merged_into IS NULL)
        ), agg AS (
         SELECT per_owner.building_id,
            (count(*))::integer AS n_propietarios,
            (count(*) FILTER (WHERE (per_owner.estado_vital = 'fallecido'::text)))::integer AS n_fallecidos,
            (count(*) FILTER (WHERE (per_owner.estado_vital = 'probable_fallecido'::text)))::integer AS n_probables,
            (count(*) FILTER (WHERE (per_owner.fecha_nacimiento IS NOT NULL)))::integer AS n_con_fecha,
            (count(*) FILTER (WHERE (per_owner.edad_anios >= 85)))::integer AS n_mayores_85,
            (count(*) FILTER (WHERE (per_owner.edad_anios >= 90)))::integer AS n_mayores_90,
            round(avg(per_owner.edad_anios) FILTER (WHERE (per_owner.edad_anios IS NOT NULL)), 1) AS edad_media
           FROM per_owner
          GROUP BY per_owner.building_id
        )
 SELECT building_id,
    n_propietarios,
    n_fallecidos,
    n_probables,
    n_mayores_85,
    n_mayores_90,
    edad_media,
        CASE
            WHEN (n_propietarios > 0) THEN (round(((100.0 * (n_con_fecha)::numeric) / (n_propietarios)::numeric), 0))::integer
            ELSE 0
        END AS pct_con_fecha,
        CASE
            WHEN (n_fallecidos >= 1) THEN 'herencia_abierta'::text
            WHEN (n_probables >= 1) THEN 'sospecha'::text
            WHEN ((n_con_fecha >= 1) AND (((n_mayores_85)::numeric / (GREATEST(n_con_fecha, 1))::numeric) >= 0.30)) THEN 'envejecimiento_alto'::text
            ELSE 'sin_senales'::text
        END AS estado_sucesion
   FROM agg a;


--
-- Name: v_owner_last_contact; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_owner_last_contact AS
 SELECT id AS owner_id,
    ( SELECT max(c.fecha) AS max
           FROM public.calls c
          WHERE (c.owner_id = o.id)) AS last_call_at,
    (( SELECT count(*) AS count
           FROM public.calls c
          WHERE (c.owner_id = o.id)))::integer AS calls_count
   FROM public.owners o;


--
-- Name: v_owner_score; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_owner_score WITH (security_invoker='on') AS
 WITH raw_owner_finca AS (
         SELECT t.owner_id,
            t.nota_simple_id,
            n.building_id,
            sum(np.pct) FILTER (WHERE (np.pct IS NOT NULL)) AS pct_raw_sum,
            max(np.raw_value) AS raw_value,
            bool_and(np.invalido) AS all_invalid
           FROM ((public.nota_simple_titulares t
             JOIN public.notas_simples n ON ((n.id = t.nota_simple_id)))
             CROSS JOIN LATERAL public.normalize_pct_propiedad((t.porcentaje)::text) np(pct, normalizado, invalido, raw_value))
          WHERE ((t.owner_id IS NOT NULL) AND (n.building_id IS NOT NULL) AND (COALESCE(n.status, 'listo'::text) = 'listo'::text))
          GROUP BY t.owner_id, t.nota_simple_id, n.building_id
        ), finca_totals AS (
         SELECT raw_owner_finca.nota_simple_id,
            raw_owner_finca.building_id,
            sum(raw_owner_finca.pct_raw_sum) AS finca_sum
           FROM raw_owner_finca
          WHERE ((raw_owner_finca.pct_raw_sum IS NOT NULL) AND (raw_owner_finca.pct_raw_sum > (0)::numeric))
          GROUP BY raw_owner_finca.nota_simple_id, raw_owner_finca.building_id
        ), building_data_fincas AS (
         SELECT finca_totals.building_id,
            (count(*))::numeric AS n_fincas
           FROM finca_totals
          GROUP BY finca_totals.building_id
        ), owner_finca_norm AS (
         SELECT r.owner_id,
            r.building_id,
            r.nota_simple_id,
                CASE
                    WHEN ((ft.finca_sum IS NOT NULL) AND (ft.finca_sum > (0)::numeric) AND (r.pct_raw_sum IS NOT NULL)) THEN ((r.pct_raw_sum / ft.finca_sum) * 100.0)
                    ELSE NULL::numeric
                END AS pct_finca_norm,
            r.raw_value,
            r.all_invalid
           FROM (raw_owner_finca r
             LEFT JOIN finca_totals ft ON ((ft.nota_simple_id = r.nota_simple_id)))
        ), ns_pct AS (
         SELECT o_1.owner_id,
            o_1.building_id,
            round(sum((o_1.pct_finca_norm / NULLIF(bdf.n_fincas, (0)::numeric))) FILTER (WHERE (o_1.pct_finca_norm IS NOT NULL)), 2) AS pct,
            bool_or((o_1.pct_finca_norm IS NOT NULL)) AS has_norm,
            bool_and(o_1.all_invalid) AS all_invalid,
            max(o_1.raw_value) AS raw_value
           FROM (owner_finca_norm o_1
             LEFT JOIN building_data_fincas bdf ON ((bdf.building_id = o_1.building_id)))
          GROUP BY o_1.owner_id, o_1.building_id
        ), pct_resolved AS (
         SELECT bo_1.owner_id,
            bo_1.building_id,
                CASE
                    WHEN (np.pct IS NOT NULL) THEN np.pct
                    WHEN (hs.pct IS NOT NULL) THEN hs.pct
                    ELSE NULL::numeric
                END AS pct_propiedad,
                CASE
                    WHEN (np.pct IS NOT NULL) THEN 'nota_simple'::text
                    WHEN (hs.pct IS NOT NULL) THEN 'building_owners'::text
                    ELSE 'desconocido'::text
                END AS pct_origen,
                CASE
                    WHEN (np.pct IS NOT NULL) THEN true
                    WHEN (hs.pct IS NOT NULL) THEN COALESCE(hs.normalizado, false)
                    ELSE false
                END AS pct_normalizado,
                CASE
                    WHEN ((np.pct IS NULL) AND (hs.pct IS NULL) AND (COALESCE(np.all_invalid, false) OR COALESCE(hs.invalido, false))) THEN true
                    ELSE false
                END AS pct_invalido,
            COALESCE(np.raw_value, hs.raw_value) AS pct_raw
           FROM (((public.building_owners bo_1
             JOIN public.owners o_1 ON ((o_1.id = bo_1.owner_id)))
             LEFT JOIN ns_pct np ON (((np.owner_id = bo_1.owner_id) AND (np.building_id = bo_1.building_id))))
             LEFT JOIN LATERAL public.normalize_pct_propiedad((bo_1.cuota)::text) hs(pct, normalizado, invalido, raw_value) ON (true))
        )
 SELECT o.id AS owner_id,
    o.nombre,
    o.telefono,
    o.email,
    o.rol,
    bo.building_id,
    bo.subrole,
    bo.rol_notas,
    bo.es_influencer,
    bo.influencer_score,
    bo.influencer_reason,
    o.metadatos,
    pr.pct_propiedad,
    pr.pct_origen,
    pr.pct_normalizado,
    pr.pct_invalido,
    pr.pct_raw,
    COALESCE(lc.calls_count, 0) AS contactos_previos,
    lc.last_call_at,
    round(((((((0.30 *
        CASE
            WHEN (pr.pct_propiedad IS NULL) THEN (0)::numeric
            ELSE (1.0 - LEAST(1.0, (pr.pct_propiedad / 100.0)))
        END) + (0.25 *
        CASE
            WHEN (pr.pct_propiedad IS NULL) THEN (0)::numeric
            ELSE LEAST(1.0, (pr.pct_propiedad / 100.0))
        END)) + (0.20 * LEAST(1.0, ((COALESCE(lc.calls_count, 0))::numeric / 5.0)))) + (0.15 * (
        CASE
            WHEN (o.rol = 'desconocido'::public.owner_role) THEN 0
            ELSE 1
        END)::numeric)) + (0.10 * (
        CASE
            WHEN ((o.telefono IS NOT NULL) AND (o.telefono <> ''::text)) THEN 1
            ELSE 0
        END)::numeric)) * (100)::numeric), 1) AS score
   FROM (((public.owners o
     JOIN public.building_owners bo ON ((bo.owner_id = o.id)))
     LEFT JOIN pct_resolved pr ON (((pr.owner_id = bo.owner_id) AND (pr.building_id = bo.building_id))))
     LEFT JOIN public.v_owner_last_contact lc ON ((lc.owner_id = o.id)))
  WHERE (o.merged_into IS NULL);


--
-- Name: v_call_queue_daily; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_call_queue_daily AS
 WITH owner_signal AS (
         SELECT bo.building_id,
            bo.owner_id,
            o.nombre,
            o.telefono,
            bo.cuota,
            COALESCE(vbs.score, (0)::numeric) AS score_edificio,
            COALESCE(vos.score, (0)::numeric) AS score_owner,
            COALESCE(vos.contactos_previos, 0) AS contactos_previos,
            vos.last_call_at,
                CASE
                    WHEN (vos.last_call_at IS NULL) THEN 'cold'::text
                    WHEN (vos.last_call_at > (now() - '60 days'::interval)) THEN 'hot'::text
                    ELSE 'cold'::text
                END AS temperatura,
            GREATEST((0)::numeric, ((EXTRACT(epoch FROM (now() - COALESCE(vos.last_call_at, (now() - '365 days'::interval)))) / (86400)::numeric) - (30)::numeric)) AS dias_cadencia_vencida
           FROM (((public.building_owners bo
             JOIN public.owners o ON ((o.id = bo.owner_id)))
             LEFT JOIN public.v_building_score vbs ON ((vbs.id = bo.building_id)))
             LEFT JOIN public.v_owner_score vos ON ((vos.owner_id = bo.owner_id)))
          WHERE ((o.telefono IS NOT NULL) AND (o.telefono <> ''::text))
        )
 SELECT building_id,
    owner_id,
    nombre,
    telefono,
    cuota,
    score_edificio,
    score_owner,
    contactos_previos,
    last_call_at,
    temperatura,
    dias_cadencia_vencida,
    round(((GREATEST(score_edificio, (10)::numeric) * GREATEST(score_owner, (1)::numeric)) * ((1)::numeric + (dias_cadencia_vencida / 30.0))), 2) AS prioridad
   FROM owner_signal
  ORDER BY (round(((GREATEST(score_edificio, (10)::numeric) * GREATEST(score_owner, (1)::numeric)) * ((1)::numeric + (dias_cadencia_vencida / 30.0))), 2)) DESC;


--
-- Name: v_calls_feed; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_calls_feed WITH (security_invoker='on') AS
 WITH owner_contacts AS (
         SELECT external_ids.entity_id AS owner_id,
            external_ids.provider_id AS hs_contact_id
           FROM public.external_ids
          WHERE ((external_ids.entity_type = 'owner'::text) AND (external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'contact'::text))
        ), building_deals AS (
         SELECT external_ids.entity_id AS building_id,
            external_ids.provider_id AS hs_deal_id
           FROM public.external_ids
          WHERE ((external_ids.entity_type = 'building'::text) AND (external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'deal'::text))
        ), owner_deals AS (
         SELECT DISTINCT bo.owner_id,
            bd.building_id,
            bd.hs_deal_id
           FROM (public.building_owners bo
             JOIN building_deals bd ON ((bd.building_id = bo.building_id)))
        ), attribution AS (
         SELECT cs_1.hubspot_call_id AS hs_id,
            cs_1.owner_id,
            cs_1.building_id,
            1 AS prio
           FROM public.call_sessions cs_1
          WHERE ((cs_1.hubspot_call_id IS NOT NULL) AND (cs_1.owner_id IS NOT NULL))
        UNION ALL
         SELECT hc_1.hs_id,
            oc.owner_id,
            NULL::uuid AS building_id,
            2 AS prio
           FROM (public.hubspot_calls hc_1
             JOIN owner_contacts oc ON ((oc.hs_contact_id = ANY (hc_1.associated_contact_ids))))
        UNION ALL
         SELECT hc_1.hs_id,
            od.owner_id,
            od.building_id,
            3 AS prio
           FROM ((public.hubspot_calls hc_1
             JOIN owner_deals od ON ((od.hs_deal_id = ANY (hc_1.associated_deal_ids))))
             JOIN public.owners o_1 ON ((o_1.id = od.owner_id)))
          WHERE ((public.norm_phone(o_1.telefono) IS NOT NULL) AND ((public.norm_phone(o_1.telefono) = public.norm_phone(hc_1.hs_call_to_number)) OR (public.norm_phone(o_1.telefono) = public.norm_phone(hc_1.hs_call_from_number))))
        ), best AS (
         SELECT DISTINCT ON (attribution.hs_id) attribution.hs_id,
            attribution.owner_id,
            attribution.building_id
           FROM attribution
          ORDER BY attribution.hs_id, attribution.prio
        )
 SELECT hc.hs_id,
    hc.hs_timestamp AS fecha,
        CASE
            WHEN (COALESCE(hc.hs_call_duration, 0) > 14400) THEN (round(((hc.hs_call_duration)::numeric / (1000)::numeric)))::integer
            ELSE hc.hs_call_duration
        END AS duracion_seg,
    lower(COALESCE(hc.hs_call_direction, ''::text)) AS direccion,
    hc.hs_call_status AS resultado,
    hc.hs_call_disposition,
    COALESCE(NULLIF(public.strip_html_to_text(hc.hs_call_body), ''::text), hc.hs_call_summary) AS resumen,
    hc.hs_call_transcription,
    ((hc.hs_call_recording_url IS NOT NULL) AND (hc.hs_call_recording_url <> ''::text)) AS tiene_grabacion,
    ((hc.hs_call_transcription IS NOT NULL) AND (hc.hs_call_transcription <> ''::text)) AS tiene_transcripcion,
    (hc.hs_call_status = 'COMPLETED'::text) AS conectada,
    b.owner_id,
    o.nombre AS owner_nombre,
    b.building_id,
    cs.id AS session_id,
    cs.puntuacion,
    cs.estado AS session_estado,
    cs.retroactiva
   FROM (((public.hubspot_calls hc
     LEFT JOIN best b ON ((b.hs_id = hc.hs_id)))
     LEFT JOIN public.owners o ON ((o.id = b.owner_id)))
     LEFT JOIN LATERAL ( SELECT call_sessions.id,
            call_sessions.puntuacion,
            call_sessions.estado,
            call_sessions.retroactiva
           FROM public.call_sessions
          WHERE (call_sessions.hubspot_call_id = hc.hs_id)
          ORDER BY call_sessions.finalizada_at DESC NULLS LAST, call_sessions.created_at DESC
         LIMIT 1) cs ON (true));


--
-- Name: v_cohort77_calls_audit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_cohort77_calls_audit WITH (security_invoker='on') AS
 WITH cohort AS (
         SELECT DISTINCT bps.building_id
           FROM public.building_processing_status bps
        ), owners_x_building AS (
         SELECT bo.building_id,
            bo.owner_id
           FROM public.building_owners bo
          WHERE (bo.building_id IN ( SELECT cohort.building_id
                   FROM cohort))
        ), locales AS (
         SELECT ob.building_id,
            count(c_1.id) AS calls_locales,
            max(c_1.fecha) AS ultima_call_local
           FROM (owners_x_building ob
             LEFT JOIN public.calls c_1 ON ((c_1.owner_id = ob.owner_id)))
          GROUP BY ob.building_id
        ), hs_via_contact AS (
         SELECT ob.building_id,
            hc.hs_id,
            hc.hs_timestamp
           FROM ((owners_x_building ob
             JOIN public.external_ids ei ON (((ei.entity_type = 'owner'::text) AND (ei.provider = 'hubspot'::text) AND (ei.provider_object_type = 'contact'::text) AND (ei.entity_id = ob.owner_id))))
             JOIN public.hubspot_calls hc ON ((ei.provider_id = ANY (hc.associated_contact_ids))))
        ), hs_via_deal AS (
         SELECT ei.entity_id AS building_id,
            hc.hs_id,
            hc.hs_timestamp
           FROM (public.external_ids ei
             JOIN public.hubspot_calls hc ON ((ei.provider_id = ANY (hc.associated_deal_ids))))
          WHERE ((ei.entity_type = 'building'::text) AND (ei.provider = 'hubspot'::text) AND (ei.provider_object_type = 'deal'::text) AND (ei.entity_id IN ( SELECT cohort.building_id
                   FROM cohort)))
        ), hs_union AS (
         SELECT hs_via_contact.building_id,
            hs_via_contact.hs_id,
            hs_via_contact.hs_timestamp
           FROM hs_via_contact
        UNION
         SELECT hs_via_deal.building_id,
            hs_via_deal.hs_id,
            hs_via_deal.hs_timestamp
           FROM hs_via_deal
        ), hs_agg AS (
         SELECT hs_union.building_id,
            count(DISTINCT hs_union.hs_id) AS hs_calls_esperadas,
            max(hs_union.hs_timestamp) AS ultima_call_hs
           FROM hs_union
          GROUP BY hs_union.building_id
        ), owners_stats AS (
         SELECT ob.building_id,
            count(DISTINCT ob.owner_id) AS owners_total,
            count(DISTINCT ob.owner_id) FILTER (WHERE (EXISTS ( SELECT 1
                   FROM public.external_ids ei
                  WHERE ((ei.entity_type = 'owner'::text) AND (ei.provider = 'hubspot'::text) AND (ei.provider_object_type = 'contact'::text) AND (ei.entity_id = ob.owner_id))))) AS owners_con_hs
           FROM owners_x_building ob
          GROUP BY ob.building_id
        )
 SELECT c.building_id,
    b.direccion,
    COALESCE(os.owners_total, (0)::bigint) AS owners_total,
    COALESCE(os.owners_con_hs, (0)::bigint) AS owners_con_hs,
    COALESCE(l.calls_locales, (0)::bigint) AS calls_locales,
    COALESCE(h.hs_calls_esperadas, (0)::bigint) AS hs_calls_esperadas,
    (COALESCE(h.hs_calls_esperadas, (0)::bigint) - COALESCE(l.calls_locales, (0)::bigint)) AS gap,
    l.ultima_call_local,
    h.ultima_call_hs
   FROM ((((cohort c
     LEFT JOIN public.buildings b ON ((b.id = c.building_id)))
     LEFT JOIN owners_stats os ON ((os.building_id = c.building_id)))
     LEFT JOIN locales l ON ((l.building_id = c.building_id)))
     LEFT JOIN hs_agg h ON ((h.building_id = c.building_id)));


--
-- Name: v_cohort77_pct_audit; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_cohort77_pct_audit WITH (security_invoker='on') AS
 WITH cohort AS (
         SELECT building_analysis.building_id
           FROM public.building_analysis
          WHERE (building_analysis.metricas_extra ? 'reprocess_frozen_v1'::text)
        UNION
         SELECT qa_ground_truth.building_id
           FROM public.qa_ground_truth
        )
 SELECT b.id AS building_id,
    b.direccion,
    count(*) AS n_owners,
    count(vo.pct_propiedad) AS con_pct,
    count(*) FILTER (WHERE vo.pct_invalido) AS invalidos,
    round(sum(COALESCE(vo.pct_propiedad, (0)::numeric)), 2) AS sum_pct,
        CASE
            WHEN (count(vo.pct_propiedad) = 0) THEN 'sin_pct'::text
            WHEN (sum(COALESCE(vo.pct_propiedad, (0)::numeric)) > (105)::numeric) THEN 'sobre_105'::text
            WHEN (sum(COALESCE(vo.pct_propiedad, (0)::numeric)) < (95)::numeric) THEN 'bajo_95'::text
            ELSE 'ok'::text
        END AS estado
   FROM (public.buildings b
     JOIN public.v_owner_score vo ON ((vo.building_id = b.id)))
  WHERE (b.id IN ( SELECT cohort.building_id
           FROM cohort))
  GROUP BY b.id, b.direccion;


--
-- Name: v_cola_simulada; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_cola_simulada AS
 WITH rel AS (
         SELECT bo.building_id,
            bo.owner_id,
            bo.cuota,
            bo.metadatos AS rel_metadatos,
            o.nombre,
            o.telefono,
            o.estado_vital,
            np.pct AS cuota_pct,
            np.invalido AS cuota_invalida,
            (COALESCE((bo.metadatos ->> 'cuota_match'::text), ''::text) = 'aproximado'::text) AS es_aprox
           FROM ((public.building_owners bo
             JOIN public.owners o ON (((o.id = bo.owner_id) AND (o.merged_into IS NULL))))
             CROSS JOIN LATERAL public.normalize_pct_propiedad((bo.cuota)::text) np(pct, normalizado, invalido, raw_value))
        ), agg AS (
         SELECT rel.building_id,
            (count(*))::integer AS n_owners,
            (count(*) FILTER (WHERE (rel.cuota_pct IS NOT NULL)))::integer AS n_con_cuota,
            (count(*) FILTER (WHERE rel.es_aprox))::integer AS n_aprox,
            round(COALESCE(sum(rel.cuota_pct), (0)::numeric), 2) AS suma_cuotas
           FROM rel
          GROUP BY rel.building_id
        ), ns AS (
         SELECT notas_simples.building_id,
            (count(*))::integer AS n_notas,
            (count(*) FILTER (WHERE (notas_simples.status = 'listo'::text)))::integer AS n_listas,
            (count(*) FILTER (WHERE ((notas_simples.status = 'listo'::text) AND (COALESCE(notas_simples.raw_pdf_text, ''::text) <> ''::text))))::integer AS n_listas_texto,
            max(notas_simples.created_at) FILTER (WHERE (notas_simples.status = 'listo'::text)) AS ultima_nota_at
           FROM public.notas_simples
          WHERE (notas_simples.building_id IS NOT NULL)
          GROUP BY notas_simples.building_id
        ), coh AS (
         SELECT bo.building_id,
            (count(*))::integer AS n_rel,
            (count(*) FILTER (WHERE (vos.owner_id IS NULL)))::integer AS n_rel_sin_dato,
            (count(*) FILTER (WHERE (vos.pct_origen = 'nota_simple'::text)))::integer AS n_rel_nota,
            (count(*) FILTER (WHERE ((vos.pct_origen = 'nota_simple'::text) AND (vos.pct_propiedad IS NOT NULL))))::integer AS n_pct_nota,
            round(COALESCE(sum(vos.pct_propiedad) FILTER (WHERE (vos.pct_origen = 'nota_simple'::text)), (0)::numeric), 2) AS suma_nota,
            (count(*) FILTER (WHERE ((vos.pct_origen = 'nota_simple'::text) AND (vos.pct_propiedad IS NOT NULL) AND ((np.pct IS NULL) OR (abs((np.pct - vos.pct_propiedad)) > 0.5)))))::integer AS n_incoherentes
           FROM (((public.building_owners bo
             JOIN public.owners o ON (((o.id = bo.owner_id) AND (o.merged_into IS NULL))))
             CROSS JOIN LATERAL public.normalize_pct_propiedad((bo.cuota)::text) np(pct, normalizado, invalido, raw_value))
             LEFT JOIN public.v_owner_score vos ON (((vos.owner_id = bo.owner_id) AND (vos.building_id = bo.building_id))))
          GROUP BY bo.building_id
        ), gp_b AS (
         SELECT guard_proposals.edificio_id AS building_id,
            (count(*))::integer AS n
           FROM public.guard_proposals
          WHERE ((guard_proposals.estado = 'pendiente'::text) AND (guard_proposals.edificio_id IS NOT NULL))
          GROUP BY guard_proposals.edificio_id
        ), gp_o AS (
         SELECT guard_proposals.entity_id,
            (count(*))::integer AS n
           FROM public.guard_proposals
          WHERE ((guard_proposals.estado = 'pendiente'::text) AND (guard_proposals.entity_id IS NOT NULL))
          GROUP BY guard_proposals.entity_id
        ), gem AS (
         SELECT deals_gemelos.building_id,
            (count(*))::integer AS n
           FROM public.deals_gemelos
          WHERE (deals_gemelos.building_id IS NOT NULL)
          GROUP BY deals_gemelos.building_id
        ), base AS (
         SELECT r.building_id,
            r.owner_id,
            r.nombre,
            r.telefono,
            r.cuota,
            r.cuota_pct,
            r.es_aprox,
            r.estado_vital,
            b.direccion,
            b.division_horizontal,
            b.hs_deal_id,
            COALESCE(a.n_owners, 0) AS n_owners,
            COALESCE(a.n_con_cuota, 0) AS n_con_cuota,
            COALESCE(a.n_aprox, 0) AS n_aprox,
            COALESCE(a.suma_cuotas, (0)::numeric) AS suma_cuotas,
            COALESCE(ns.n_notas, 0) AS n_notas,
            COALESCE(ns.n_listas, 0) AS n_notas_listas,
            COALESCE(ns.n_listas_texto, 0) AS n_notas_texto,
            ns.ultima_nota_at,
            COALESCE(coh.n_rel, 0) AS n_rel,
            COALESCE(coh.n_rel_sin_dato, 0) AS n_rel_sin_dato,
            COALESCE(coh.n_rel_nota, 0) AS n_rel_nota,
            COALESCE(coh.n_pct_nota, 0) AS n_pct_nota,
            COALESCE(coh.suma_nota, (0)::numeric) AS suma_nota,
            COALESCE(coh.n_incoherentes, 0) AS n_incoherentes,
            (COALESCE(gp_b.n, 0) + COALESCE(gp_o.n, 0)) AS n_guardas,
            COALESCE(gem.n, 0) AS n_gemelos,
            COALESCE(vbs.score_raw, (0)::numeric) AS score_activo_raw,
            COALESCE(vos.score, (0)::numeric) AS score_owner,
            vos.last_call_at,
            COALESCE(vos.contactos_previos, 0) AS contactos_previos,
            vos.pct_origen,
            ext.provider_id AS deal_ext_provider_id,
            rev.entity_id AS deal_map_building_id,
            GREATEST((0)::numeric, ((EXTRACT(epoch FROM (now() - COALESCE(vos.last_call_at, (now() - '365 days'::interval)))) / (86400)::numeric) - (30)::numeric)) AS dias_cadencia_vencida
           FROM (((((((((((rel r
             JOIN public.buildings b ON ((b.id = r.building_id)))
             LEFT JOIN agg a ON ((a.building_id = r.building_id)))
             LEFT JOIN ns ON ((ns.building_id = r.building_id)))
             LEFT JOIN coh ON ((coh.building_id = r.building_id)))
             LEFT JOIN gp_b ON ((gp_b.building_id = r.building_id)))
             LEFT JOIN gp_o ON ((gp_o.entity_id = (r.owner_id)::text)))
             LEFT JOIN gem ON ((gem.building_id = r.building_id)))
             LEFT JOIN public.v_building_score vbs ON ((vbs.id = r.building_id)))
             LEFT JOIN public.v_owner_score vos ON (((vos.owner_id = r.owner_id) AND (vos.building_id = r.building_id))))
             LEFT JOIN LATERAL ( SELECT e.provider_id
                   FROM public.external_ids e
                  WHERE ((e.provider = 'hubspot'::text) AND (e.entity_type = 'building'::text) AND (e.provider_object_type = 'deal'::text) AND (e.entity_id = b.id))
                  ORDER BY e.updated_at DESC NULLS LAST
                 LIMIT 1) ext ON (true))
             LEFT JOIN LATERAL ( SELECT e2.entity_id
                   FROM public.external_ids e2
                  WHERE ((e2.provider = 'hubspot'::text) AND (e2.entity_type = 'building'::text) AND (e2.provider_object_type = 'deal'::text) AND (e2.provider_id = b.hs_deal_id))
                 LIMIT 1) rev ON (((b.hs_deal_id IS NOT NULL) AND (b.hs_deal_id <> ''::text))))
        ), flags AS (
         SELECT base.building_id,
            base.owner_id,
            base.nombre,
            base.telefono,
            base.cuota,
            base.cuota_pct,
            base.es_aprox,
            base.estado_vital,
            base.direccion,
            base.division_horizontal,
            base.hs_deal_id,
            base.n_owners,
            base.n_con_cuota,
            base.n_aprox,
            base.suma_cuotas,
            base.n_notas,
            base.n_notas_listas,
            base.n_notas_texto,
            base.ultima_nota_at,
            base.n_rel,
            base.n_rel_sin_dato,
            base.n_rel_nota,
            base.n_pct_nota,
            base.suma_nota,
            base.n_incoherentes,
            base.n_guardas,
            base.n_gemelos,
            base.score_activo_raw,
            base.score_owner,
            base.last_call_at,
            base.contactos_previos,
            base.pct_origen,
            base.deal_ext_provider_id,
            base.deal_map_building_id,
            base.dias_cadencia_vencida,
            (base.n_notas_listas > 0) AS ck_nota_lista,
            (base.n_notas_texto > 0) AS ck_nota_texto,
            (base.n_owners >= 1) AS ck_min_owner,
            ((base.n_owners > 0) AND (base.n_con_cuota = base.n_owners)) AS ck_cuotas_completas,
            (base.n_aprox = 0) AS ck_sin_aprox,
            ((base.suma_cuotas >= (99)::numeric) AND (base.suma_cuotas <= (101)::numeric)) AS ck_suma_ok,
            ((base.n_pct_nota > 0) AND (base.suma_nota >= (99)::numeric) AND (base.suma_nota <= (101)::numeric)) AS ck_suma_nota_ok,
            ((base.n_pct_nota > 0) AND (base.n_incoherentes = 0)) AS ck_coherencia,
            (base.n_pct_nota = 0) AS coherencia_desconocida,
            ((base.telefono IS NOT NULL) AND (base.telefono <> ''::text)) AS ck_telefono,
            (base.n_guardas = 0) AS ck_sin_guardas,
            ((base.n_rel > 0) AND (base.n_rel_nota = base.n_rel)) AS ck_trazabilidad,
            (base.n_rel_sin_dato > 0) AS trazabilidad_desconocida,
            ((base.hs_deal_id IS NOT NULL) AND (base.hs_deal_id <> ''::text) AND (base.deal_ext_provider_id = base.hs_deal_id)) AS ck_deal,
                CASE
                    WHEN ((base.hs_deal_id IS NULL) OR (base.hs_deal_id = ''::text)) THEN 'sin_deal'::text
                    WHEN (base.deal_ext_provider_id IS NULL) THEN 'sin_mapa'::text
                    WHEN (base.deal_ext_provider_id <> base.hs_deal_id) THEN 'conflicto'::text
                    ELSE 'ok'::text
                END AS deal_estado,
            (COALESCE(base.division_horizontal, false) = false) AS ck_sin_dh,
            (base.n_gemelos = 0) AS ck_sin_gemelo
           FROM base
        )
 SELECT building_id,
    direccion,
    owner_id,
    nombre,
    telefono,
    cuota,
    cuota_pct,
    suma_cuotas,
    suma_nota,
    n_pct_nota,
    n_incoherentes,
    n_owners,
    n_con_cuota,
    n_aprox,
    n_notas,
    n_notas_listas,
    n_notas_texto,
    ultima_nota_at,
    n_rel,
    n_rel_nota,
    n_rel_sin_dato,
    n_guardas,
    n_gemelos,
    pct_origen,
    hs_deal_id,
    deal_ext_provider_id,
    deal_map_building_id,
    deal_estado,
    score_activo_raw,
    score_owner,
    contactos_previos,
    last_call_at,
    round(dias_cadencia_vencida, 1) AS dias_cadencia_vencida,
    (ck_nota_lista AND ck_nota_texto AND ck_min_owner AND ck_cuotas_completas AND ck_sin_aprox AND ck_suma_ok AND ck_suma_nota_ok AND ck_coherencia AND ck_telefono AND ck_sin_guardas AND ck_trazabilidad AND ck_deal AND ck_sin_dh AND ck_sin_gemelo) AS apto_publicar_estricto,
    ((NOT (ck_nota_lista AND ck_nota_texto AND ck_min_owner AND ck_cuotas_completas AND ck_sin_aprox AND ck_suma_ok AND ck_suma_nota_ok AND ck_coherencia AND ck_telefono AND ck_sin_guardas AND ck_trazabilidad AND ck_deal AND ck_sin_dh AND ck_sin_gemelo)) AND ck_min_owner AND ck_cuotas_completas AND ck_sin_aprox AND ck_suma_ok AND ck_telefono AND ck_sin_guardas AND ck_deal AND (n_incoherentes = 0) AND (NOT ck_trazabilidad)) AS apto_observacion,
    jsonb_build_array(jsonb_build_object('key', 'nota_lista', 'label', 'Nota simple asociada en estado listo', 'estado',
        CASE
            WHEN ck_nota_lista THEN 'PASS'::text
            WHEN (n_notas > 0) THEN 'UNKNOWN'::text
            ELSE 'FAIL'::text
        END, 'valor', (((n_notas_listas || ' de '::text) || n_notas) || ' notas en estado listo'::text), 'fuente', 'notas_simples.status'), jsonb_build_object('key', 'nota_texto', 'label', 'Nota lista con texto extraído', 'estado',
        CASE
            WHEN ck_nota_texto THEN 'PASS'::text
            WHEN ck_nota_lista THEN 'FAIL'::text
            ELSE 'UNKNOWN'::text
        END, 'valor', (n_notas_texto || ' notas con texto'::text), 'fuente', 'notas_simples.raw_pdf_text'), jsonb_build_object('key', 'min_owner', 'label', 'Al menos un propietario', 'estado',
        CASE
            WHEN ck_min_owner THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor', (n_owners || ' propietarios'::text), 'fuente', 'building_owners'), jsonb_build_object('key', 'cuotas_completas', 'label', 'Todos los propietarios con porcentaje', 'estado',
        CASE
            WHEN ck_cuotas_completas THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor', (((n_con_cuota || ' de '::text) || n_owners) || ' con porcentaje'::text), 'fuente', 'building_owners.cuota'), jsonb_build_object('key', 'sin_aprox', 'label', 'Ningún porcentaje aproximado', 'estado',
        CASE
            WHEN ck_sin_aprox THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor', (n_aprox || ' porcentajes aproximados'::text), 'fuente', 'building_owners.metadatos.cuota_match'), jsonb_build_object('key', 'suma_ok', 'label', 'Suma de porcentajes operativos entre 99 y 101', 'estado',
        CASE
            WHEN ck_suma_ok THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor', (to_char(suma_cuotas, 'FM990D00'::text) || ' %'::text), 'fuente', 'building_owners.cuota (normalizado)'), jsonb_build_object('key', 'suma_nota', 'label', 'Suma de porcentajes de nota simple entre 99 y 101', 'estado',
        CASE
            WHEN ck_suma_nota_ok THEN 'PASS'::text
            WHEN coherencia_desconocida THEN 'UNKNOWN'::text
            ELSE 'FAIL'::text
        END, 'valor', (((to_char(suma_nota, 'FM990D00'::text) || ' % ('::text) || n_pct_nota) || ' relaciones con % de nota)'::text), 'fuente', 'v_owner_score.pct_propiedad (pct_origen = nota_simple)'), jsonb_build_object('key', 'coherencia_cuota_nota', 'label', 'Cuota operativa coherente con la nota simple', 'estado',
        CASE
            WHEN ck_coherencia THEN 'PASS'::text
            WHEN coherencia_desconocida THEN 'UNKNOWN'::text
            ELSE 'FAIL'::text
        END, 'valor',
        CASE
            WHEN coherencia_desconocida THEN 'Sin porcentajes de nota simple'::text
            ELSE (((((((n_incoherentes || ' de '::text) || n_pct_nota) || ' relaciones discrepantes · operativo '::text) || to_char(suma_cuotas, 'FM990D00'::text)) || ' % vs nota '::text) || to_char(suma_nota, 'FM990D00'::text)) || ' %'::text)
        END, 'fuente', 'building_owners.cuota vs v_owner_score.pct_propiedad'), jsonb_build_object('key', 'trazabilidad', 'label', 'Porcentaje con trazabilidad registral (nota simple)', 'estado',
        CASE
            WHEN ck_trazabilidad THEN 'PASS'::text
            WHEN trazabilidad_desconocida THEN 'UNKNOWN'::text
            ELSE 'FAIL'::text
        END, 'valor', (((n_rel_nota || ' de '::text) || n_rel) || ' relaciones con origen nota simple'::text), 'fuente', 'v_owner_score.pct_origen'), jsonb_build_object('key', 'telefono', 'label', 'Propietario con teléfono', 'estado',
        CASE
            WHEN ck_telefono THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor',
        CASE
            WHEN ck_telefono THEN 'Teléfono disponible'::text
            ELSE 'Sin teléfono'::text
        END, 'fuente', 'owners.telefono'), jsonb_build_object('key', 'deal', 'label', 'Mapeo del negocio de HubSpot del edificio', 'estado',
        CASE
            WHEN (deal_estado = 'ok'::text) THEN 'PASS'::text
            WHEN (deal_estado = 'sin_mapa'::text) THEN 'UNKNOWN'::text
            ELSE 'FAIL'::text
        END, 'valor',
        CASE
            WHEN (deal_estado = 'sin_deal'::text) THEN 'El edificio no tiene hs_deal_id'::text
            WHEN (deal_estado = 'sin_mapa'::text) THEN (('Sin fila en external_ids para este edificio (hs_deal_id '::text || COALESCE(hs_deal_id, ''::text)) || ')'::text)
            WHEN (deal_estado = 'conflicto'::text) THEN (((('external_ids apunta al negocio '::text || COALESCE(deal_ext_provider_id, '?'::text)) || ' y la ficha al '::text) || COALESCE(hs_deal_id, '?'::text)) ||
            CASE
                WHEN (deal_map_building_id IS NULL) THEN ' (el hs_deal_id no está mapeado a ningún edificio)'::text
                WHEN (deal_map_building_id <> building_id) THEN ((' (el hs_deal_id pertenece al edificio '::text || (deal_map_building_id)::text) || ')'::text)
                ELSE ''::text
            END)
            ELSE (('Negocio '::text || COALESCE(hs_deal_id, ''::text)) || ' coherente'::text)
        END, 'fuente', 'external_ids(provider=hubspot, entity_type=building, provider_object_type=deal, entity_id=buildings.id).provider_id vs buildings.hs_deal_id'), jsonb_build_object('key', 'sin_dh', 'label', 'Sin división horizontal', 'estado',
        CASE
            WHEN (division_horizontal IS NULL) THEN 'UNKNOWN'::text
            WHEN ck_sin_dh THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor',
        CASE
            WHEN (division_horizontal IS NULL) THEN 'desconocido'::text
            WHEN division_horizontal THEN 'Con división horizontal'::text
            ELSE 'Sin división horizontal'::text
        END, 'fuente', 'buildings.division_horizontal'), jsonb_build_object('key', 'sin_gemelo', 'label', 'Sin negocio gemelo detectado', 'estado',
        CASE
            WHEN ck_sin_gemelo THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor', (n_gemelos || ' gemelos'::text), 'fuente', 'deals_gemelos'), jsonb_build_object('key', 'sin_guardas', 'label', 'Sin guardas pendientes', 'estado',
        CASE
            WHEN ck_sin_guardas THEN 'PASS'::text
            ELSE 'FAIL'::text
        END, 'valor', (n_guardas || ' propuestas pendientes'::text), 'fuente', 'guard_proposals')) AS checkpoints,
    array_remove(ARRAY[
        CASE
            WHEN (NOT ck_nota_lista) THEN 'Sin nota simple en estado listo'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (ck_nota_lista AND (NOT ck_nota_texto)) THEN 'La nota simple no tiene texto extraído'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_min_owner) THEN 'Sin propietarios'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_cuotas_completas) THEN (((n_con_cuota || ' de '::text) || n_owners) || ' propietarios con porcentaje'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_sin_aprox) THEN (n_aprox || ' porcentajes marcados como aproximados'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_suma_ok) THEN (('Suma de porcentajes operativos '::text || to_char(suma_cuotas, 'FM990D00'::text)) || ' %'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN ((NOT ck_suma_nota_ok) AND (NOT coherencia_desconocida)) THEN (('Suma de porcentajes de nota simple '::text || to_char(suma_nota, 'FM990D00'::text)) || ' %'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN coherencia_desconocida THEN 'Sin porcentajes de nota simple para contrastar'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (n_incoherentes > 0) THEN (((('cuota_operativa_incoherente_con_nota ('::text || to_char(suma_cuotas, 'FM990D00'::text)) || ' % vs '::text) || to_char(suma_nota, 'FM990D00'::text)) || ' %)'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_telefono) THEN 'Propietario sin teléfono'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_sin_guardas) THEN (n_guardas || ' guardas pendientes'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_trazabilidad) THEN 'porcentaje_sin_trazabilidad_nota'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (deal_estado = 'sin_deal'::text) THEN 'Sin negocio de HubSpot en la ficha'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (deal_estado = 'sin_mapa'::text) THEN 'Edificio sin fila de negocio en external_ids'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (deal_estado = 'conflicto'::text) THEN (((('Mapeo de negocio incoherente (external_ids '::text || COALESCE(deal_ext_provider_id, '?'::text)) || ' vs ficha '::text) || COALESCE(hs_deal_id, '?'::text)) || ')'::text)
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_sin_dh) THEN 'Edificio con división horizontal'::text
            ELSE NULL::text
        END,
        CASE
            WHEN (NOT ck_sin_gemelo) THEN 'Negocio gemelo sin resolver'::text
            ELSE NULL::text
        END], NULL::text) AS bloqueos,
    round(((GREATEST(score_activo_raw, (10)::numeric) * GREATEST(score_owner, (1)::numeric)) * ((1)::numeric + (dias_cadencia_vencida / 30.0))), 2) AS prioridad,
    (((((('Se propone porque el activo puntúa '::text || round(score_activo_raw)) || ' (score_raw, sin propietarios), el propietario '::text) || round(score_owner)) || ' y lleva '::text) || round(dias_cadencia_vencida)) || ' días de cadencia vencida. La prioridad multiplica score del activo por score del propietario y suma un 3,3 % por cada día de cadencia vencida.'::text) AS prioridad_explicacion
   FROM flags f;


--
-- Name: v_company_graph; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_company_graph WITH (security_invoker='true') AS
 SELECT c.id AS company_id,
    c.nombre,
    c.cif,
    c.buyer_persona,
    COALESCE(oc.owners_count, 0) AS owners_count,
    COALESCE(bc.buildings_count, 0) AS buildings_count,
    COALESCE(n.notas_count, 0) AS notas_count
   FROM (((public.companies c
     LEFT JOIN ( SELECT owner_companies.company_id,
            (count(*))::integer AS owners_count
           FROM public.owner_companies
          GROUP BY owner_companies.company_id) oc ON ((oc.company_id = c.id)))
     LEFT JOIN ( SELECT building_companies.company_id,
            (count(*))::integer AS buildings_count
           FROM public.building_companies
          GROUP BY building_companies.company_id) bc ON ((bc.company_id = c.id)))
     LEFT JOIN ( SELECT nota_simple_titulares.company_id,
            (count(*))::integer AS notas_count
           FROM public.nota_simple_titulares
          WHERE (nota_simple_titulares.company_id IS NOT NULL)
          GROUP BY nota_simple_titulares.company_id) n ON ((n.company_id = c.id)));


--
-- Name: v_contraste_nota_simple; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_contraste_nota_simple AS
 WITH mapa AS (
         SELECT b.id AS building_id,
            b.direccion,
            b.grupo_barrio,
            e.provider_id AS hs_deal_id
           FROM (public.buildings b
             LEFT JOIN public.external_ids e ON (((e.entity_type = 'building'::text) AND (e.provider = 'hubspot'::text) AND (e.entity_id = b.id))))
        ), hs AS (
         SELECT m.building_id,
            m.direccion,
            m.grupo_barrio,
            m.hs_deal_id,
            d.dealname,
            NULLIF(((d.raw -> 'properties'::text) ->> 'tenemos_la_nota_simple_'::text), ''::text) AS hs_nota
           FROM (mapa m
             LEFT JOIN public.hubspot_deals d ON ((d.hs_id = m.hs_deal_id)))
        ), tenemos AS (
         SELECT h.building_id,
            h.direccion,
            h.grupo_barrio,
            h.hs_deal_id,
            h.dealname,
            h.hs_nota,
            (EXISTS ( SELECT 1
                   FROM public.notas_simples n
                  WHERE (n.building_id = h.building_id))) AS tenemos_nota
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
            WHEN ((hs_nota = 'Sí'::text) AND (NOT tenemos_nota)) THEN 'hubspot_si_no_tenemos'::text
            WHEN ((hs_nota = 'No'::text) AND tenemos_nota) THEN 'hubspot_no_si_tenemos'::text
            WHEN ((hs_nota IS NULL) AND tenemos_nota) THEN 'sin_dato_hubspot_tenemos'::text
            WHEN ((hs_nota IS NULL) AND (NOT tenemos_nota)) THEN 'sin_dato_hubspot_sin_nota'::text
            ELSE 'coherente'::text
        END AS discrepancia
   FROM tenemos;


--
-- Name: v_dashboard_buildings_worked; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_dashboard_buildings_worked AS
 SELECT (( SELECT count(*) AS count
           FROM public.buildings))::integer AS total,
    (( SELECT count(DISTINCT building_owners.building_id) AS count
           FROM public.building_owners))::integer AS con_propietarios,
    (( SELECT count(DISTINCT notas_simples.building_id) AS count
           FROM public.notas_simples
          WHERE (notas_simples.building_id IS NOT NULL)))::integer AS con_nota_simple;


--
-- Name: v_dashboard_call_heatmap; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_dashboard_call_heatmap AS
 SELECT (EXTRACT(dow FROM fecha))::integer AS dow,
    (EXTRACT(hour FROM fecha))::integer AS hr,
    (count(*))::integer AS calls
   FROM public.calls
  WHERE (fecha > (now() - '180 days'::interval))
  GROUP BY ((EXTRACT(dow FROM fecha))::integer), ((EXTRACT(hour FROM fecha))::integer);


--
-- Name: v_dashboard_city_conversion; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_dashboard_city_conversion AS
 SELECT b.ciudad,
    (count(*))::integer AS total,
    (count(DISTINCT bo.building_id))::integer AS trabajados
   FROM (public.buildings b
     LEFT JOIN public.building_owners bo ON ((bo.building_id = b.id)))
  GROUP BY b.ciudad;


--
-- Name: v_hubspot_calls_huerfanas; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_hubspot_calls_huerfanas WITH (security_invoker='on') AS
 SELECT hc.hs_id,
    hc.hs_timestamp,
    hc.hs_call_direction,
    hc.hs_call_to_number,
    hc.hs_call_from_number,
    hc.associated_contact_ids,
    hc.associated_deal_ids,
        CASE
            WHEN ((COALESCE(array_length(hc.associated_contact_ids, 1), 0) = 0) AND (COALESCE(array_length(hc.associated_deal_ids, 1), 0) = 0)) THEN 'sin_asociaciones'::text
            WHEN (COALESCE(array_length(hc.associated_contact_ids, 1), 0) > 0) THEN 'contact_sin_external_id'::text
            ELSE 'deal_sin_building'::text
        END AS motivo
   FROM (public.hubspot_calls hc
     LEFT JOIN public.calls c ON ((c.resumen ~~ (('[hs:'::text || hc.hs_id) || ']%'::text))))
  WHERE (c.id IS NULL);


--
-- Name: v_kpis_comercial_semana; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_kpis_comercial_semana AS
 WITH base AS (
         SELECT COALESCE(c.comercial_hs_id, c.comercial_email, 'desconocido'::text) AS comercial_key,
            COALESCE(c.comercial_nombre, c.comercial_email, 'Sin nombre'::text) AS comercial_nombre,
            (date_trunc('week'::text, c.fecha))::date AS semana,
            c.id,
            c.duracion_seg,
            c.tecnica_score,
            c.outcome,
            c.metadatos
           FROM public.calls c
          WHERE (c.fecha >= (now() - '84 days'::interval))
        )
 SELECT comercial_key,
    max(comercial_nombre) AS comercial_nombre,
    semana,
    count(*) AS llamadas_total,
    count(*) FILTER (WHERE (duracion_seg > 60)) AS llamadas_mayor_1min,
    round(((100.0 * (count(*) FILTER (WHERE (duracion_seg > 60)))::numeric) / (NULLIF(count(*), 0))::numeric), 1) AS pct_mayor_1min,
    round(avg(duracion_seg), 0) AS duracion_media_seg,
    round(avg(tecnica_score), 2) AS calidad_media,
    count(*) FILTER (WHERE (outcome = 'interesado'::text)) AS interesados,
    count(*) FILTER (WHERE (outcome = 'volver'::text)) AS seguimientos,
    count(*) FILTER (WHERE (((metadatos ->> 'whatsapp_enviado'::text))::boolean IS TRUE)) AS whatsapp_enviados,
    count(*) FILTER (WHERE (((metadatos ->> 'pixel_enviado'::text))::boolean IS TRUE)) AS pixels_enviados,
    count(*) FILTER (WHERE (((metadatos ->> 'reunion_cerrada'::text))::boolean IS TRUE)) AS reuniones_cerradas
   FROM base
  GROUP BY comercial_key, semana;


--
-- Name: v_owner_calls_enriched; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_owner_calls_enriched AS
 WITH owner_contacts AS (
         SELECT external_ids.entity_id AS owner_id,
            external_ids.provider_id AS hs_contact_id
           FROM public.external_ids
          WHERE ((external_ids.entity_type = 'owner'::text) AND (external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'contact'::text))
        ), building_deals AS (
         SELECT external_ids.entity_id AS building_id,
            external_ids.provider_id AS hs_deal_id
           FROM public.external_ids
          WHERE ((external_ids.entity_type = 'building'::text) AND (external_ids.provider = 'hubspot'::text) AND (external_ids.provider_object_type = 'deal'::text))
        ), owner_deals AS (
         SELECT DISTINCT bo.owner_id,
            bd.building_id,
            bd.hs_deal_id
           FROM (public.building_owners bo
             JOIN building_deals bd ON ((bd.building_id = bo.building_id)))
        ), via_contact AS (
         SELECT DISTINCT oc.owner_id,
            hc_1.hs_id
           FROM (public.hubspot_calls hc_1
             JOIN owner_contacts oc ON ((oc.hs_contact_id = ANY (hc_1.associated_contact_ids))))
        ), via_deal_phone AS (
         SELECT DISTINCT od.owner_id,
            hc_1.hs_id
           FROM ((public.hubspot_calls hc_1
             JOIN owner_deals od ON ((od.hs_deal_id = ANY (hc_1.associated_deal_ids))))
             JOIN public.owners o ON ((o.id = od.owner_id)))
          WHERE ((public.norm_phone(o.telefono) IS NOT NULL) AND ((public.norm_phone(o.telefono) = public.norm_phone(hc_1.hs_call_to_number)) OR (public.norm_phone(o.telefono) = public.norm_phone(hc_1.hs_call_from_number))) AND (NOT (EXISTS ( SELECT 1
                   FROM via_contact vc
                  WHERE ((vc.hs_id = hc_1.hs_id) AND (vc.owner_id = od.owner_id))))))
        ), owner_calls AS (
         SELECT via_contact.owner_id,
            via_contact.hs_id
           FROM via_contact
        UNION
         SELECT via_deal_phone.owner_id,
            via_deal_phone.hs_id
           FROM via_deal_phone
        ), owner_bldg_agg AS (
         SELECT building_owners.owner_id,
            count(DISTINCT building_owners.building_id) AS n_bldgs,
            (array_agg(DISTINCT building_owners.building_id))[1] AS solo_building_id
           FROM public.building_owners
          GROUP BY building_owners.owner_id
        ), attrib AS (
         SELECT oc.owner_id,
            oc.hs_id,
            COALESCE(( SELECT ov.building_id
                   FROM public.owner_call_building_assignment ov
                  WHERE ((ov.hs_id = oc.hs_id) AND (ov.owner_id = oc.owner_id))
                 LIMIT 1), ( SELECT od.building_id
                   FROM (owner_deals od
                     JOIN public.hubspot_calls hc2 ON ((hc2.hs_id = oc.hs_id)))
                  WHERE ((od.owner_id = oc.owner_id) AND (od.hs_deal_id = ANY (hc2.associated_deal_ids)))
                 LIMIT 1), ( SELECT obc.solo_building_id
                   FROM owner_bldg_agg obc
                  WHERE ((obc.owner_id = oc.owner_id) AND (obc.n_bldgs = 1)))) AS building_id
           FROM owner_calls oc
        )
 SELECT a.owner_id,
    hc.hs_id,
    hc.hs_timestamp,
    hc.hs_call_direction AS direccion,
        CASE hc.hs_call_disposition
            WHEN 'f240bbac-87c9-4f6e-bf70-924b57d47db7'::text THEN 'Conectado'::text
            WHEN '55428849-9fbc-4038-92d6-7c4f2b850974'::text THEN 'Conectado seguimiento'::text
            WHEN '371c7887-c871-4c38-b0e7-77bafc4de124'::text THEN 'Conectado'::text
            WHEN 'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'::text THEN 'Conectado'::text
            WHEN '73a0d17f-1163-4015-bdd5-ec830791da20'::text THEN 'Sin respuesta'::text
            WHEN '17b47fee-58de-441e-a44c-c6300d46f273'::text THEN 'Número equivocado'::text
            WHEN '9d9162e7-6cf3-4944-bf63-4dff82258764'::text THEN 'Ocupado'::text
            WHEN 'b2cf5968-551e-4856-9783-52b3da59a7d0'::text THEN 'Buzón de voz'::text
            WHEN 'a4c4c377-d246-4b32-a13b-75a56a4cd0ff'::text THEN 'Mensaje en vivo'::text
            ELSE 'Sin resultado'::text
        END AS resultado,
    (round(((COALESCE(hc.hs_call_duration, 0))::numeric / 1000.0)))::integer AS duracion_seg,
    public.strip_html_to_text(hc.hs_call_body) AS nota,
    public.strip_html_to_text(hc.hs_call_summary) AS resumen_ia,
    (COALESCE(hc.hs_call_recording_url, ''::text) <> ''::text) AS tiene_grabacion,
    a.building_id,
    (a.building_id IS NULL) AS sin_edificio,
    ((hc.hs_call_disposition = ANY (ARRAY['f240bbac-87c9-4f6e-bf70-924b57d47db7'::text, '55428849-9fbc-4038-92d6-7c4f2b850974'::text, '371c7887-c871-4c38-b0e7-77bafc4de124'::text, 'ea9e4795-50e0-4c7b-8b97-3c0bb743dbf7'::text])) AND (COALESCE(hc.hs_call_duration, 0) >= 30000)) AS conectada
   FROM (attrib a
     JOIN public.hubspot_calls hc ON ((hc.hs_id = a.hs_id)));


--
-- Name: v_owner_call_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_owner_call_stats AS
 SELECT owner_id,
    (count(*))::integer AS intentos_totales,
    (count(*) FILTER (WHERE conectada))::integer AS veces_conectado,
    (count(*) FILTER (WHERE (direccion = 'OUTBOUND'::text)))::integer AS salientes,
    (count(*) FILTER (WHERE (direccion = 'INBOUND'::text)))::integer AS entrantes,
    max(hs_timestamp) AS ultima_llamada,
    max(hs_timestamp) FILTER (WHERE conectada) AS ultima_vez_conectado,
    (CURRENT_DATE - (max(hs_timestamp))::date) AS dias_desde_ultima_llamada,
    (count(*) FILTER (WHERE sin_edificio))::integer AS llamadas_sin_edificio
   FROM public.v_owner_calls_enriched
  GROUP BY owner_id;


--
-- Name: v_owner_graph; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_owner_graph WITH (security_invoker='true') AS
 SELECT o.id AS owner_id,
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
   FROM (((((public.owners o
     LEFT JOIN ( SELECT building_owners.owner_id,
            (count(*))::integer AS buildings_count
           FROM public.building_owners
          GROUP BY building_owners.owner_id) b ON ((b.owner_id = o.id)))
     LEFT JOIN ( SELECT owner_companies.owner_id,
            (count(*))::integer AS companies_count
           FROM public.owner_companies
          GROUP BY owner_companies.owner_id) c ON ((c.owner_id = o.id)))
     LEFT JOIN ( SELECT nota_simple_titulares.owner_id,
            (count(*))::integer AS notas_count
           FROM public.nota_simple_titulares
          WHERE (nota_simple_titulares.owner_id IS NOT NULL)
          GROUP BY nota_simple_titulares.owner_id) n ON ((n.owner_id = o.id)))
     LEFT JOIN ( SELECT owner_relations.owner_a_id AS owner_id,
            (count(*))::integer AS relations_count
           FROM public.owner_relations
          GROUP BY owner_relations.owner_a_id) r ON ((r.owner_id = o.id)))
     LEFT JOIN ( SELECT calls.owner_id,
            (count(*))::integer AS calls_count
           FROM public.calls
          WHERE (calls.owner_id IS NOT NULL)
          GROUP BY calls.owner_id) ca ON ((ca.owner_id = o.id)));


--
-- Name: v_productividad_comercial; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_productividad_comercial AS
 WITH base AS (
         SELECT COALESCE(NULLIF(c.comercial_email, ''::text), '(sin_comercial)'::text) AS comercial,
            (c.metadatos -> 'post_call_scoring'::text) AS s,
            (c.metadatos ->> 'duration_bucket'::text) AS db
           FROM public.calls c
        )
 SELECT comercial,
    count(*) AS llamadas_total,
    count(*) FILTER (WHERE (s IS NOT NULL)) AS llamadas_scoreadas,
    round(avg(((s ->> 'hits_total'::text))::numeric) FILTER (WHERE (s IS NOT NULL)), 2) AS hitos_medios,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'tipologia'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_tipologia,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'que_le_mueve'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_que_le_mueve,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'info_edificio'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_info_edificio,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'canal_abierto'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_canal_abierto,
    round(avg(NULLIF(((s ->> 'score_post_call'::text))::numeric, NULL::numeric)), 1) AS score_post_call_medio,
    count(*) FILTER (WHERE (db = 'lt_30'::text)) AS dur_lt_30,
    count(*) FILTER (WHERE (db = '30_60'::text)) AS dur_30_60,
    count(*) FILTER (WHERE (db = '60_90'::text)) AS dur_60_90,
    count(*) FILTER (WHERE (db = 'gt_90'::text)) AS dur_gt_90,
    count(*) FILTER (WHERE (db = 'desconocida'::text)) AS dur_desconocida
   FROM base
  GROUP BY comercial;


--
-- Name: v_productividad_comercial_semana; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_productividad_comercial_semana AS
 WITH base AS (
         SELECT COALESCE(NULLIF(c.comercial_email, ''::text), '(sin_comercial)'::text) AS comercial,
            (date_trunc('week'::text, c.fecha))::date AS semana,
            (c.metadatos -> 'post_call_scoring'::text) AS s,
            (c.metadatos ->> 'duration_bucket'::text) AS db
           FROM public.calls c
        )
 SELECT comercial,
    semana,
    count(*) AS llamadas_total,
    count(*) FILTER (WHERE (s IS NOT NULL)) AS llamadas_scoreadas,
    round(avg(((s ->> 'hits_total'::text))::numeric) FILTER (WHERE (s IS NOT NULL)), 2) AS hitos_medios,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'tipologia'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_tipologia,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'que_le_mueve'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_que_le_mueve,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'info_edificio'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_info_edificio,
    round(((100.0 * (count(*) FILTER (WHERE (((s -> 'canal_abierto'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (s IS NOT NULL)), 0))::numeric), 1) AS pct_canal_abierto,
    count(*) FILTER (WHERE (db = 'lt_30'::text)) AS dur_lt_30,
    count(*) FILTER (WHERE (db = '30_60'::text)) AS dur_30_60,
    count(*) FILTER (WHERE (db = '60_90'::text)) AS dur_60_90,
    count(*) FILTER (WHERE (db = 'gt_90'::text)) AS dur_gt_90
   FROM base
  GROUP BY comercial, semana;


--
-- Name: v_productividad_global; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_productividad_global AS
 SELECT count(*) AS llamadas_total,
    count(*) FILTER (WHERE (metadatos ? 'post_call_scoring'::text)) AS llamadas_scoreadas,
    round(avg((((metadatos -> 'post_call_scoring'::text) ->> 'hits_total'::text))::numeric) FILTER (WHERE (metadatos ? 'post_call_scoring'::text)), 2) AS hitos_medios,
    round(((100.0 * (count(*) FILTER (WHERE ((((metadatos -> 'post_call_scoring'::text) -> 'tipologia'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (metadatos ? 'post_call_scoring'::text)), 0))::numeric), 1) AS pct_tipologia,
    round(((100.0 * (count(*) FILTER (WHERE ((((metadatos -> 'post_call_scoring'::text) -> 'que_le_mueve'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (metadatos ? 'post_call_scoring'::text)), 0))::numeric), 1) AS pct_que_le_mueve,
    round(((100.0 * (count(*) FILTER (WHERE ((((metadatos -> 'post_call_scoring'::text) -> 'info_edificio'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (metadatos ? 'post_call_scoring'::text)), 0))::numeric), 1) AS pct_info_edificio,
    round(((100.0 * (count(*) FILTER (WHERE ((((metadatos -> 'post_call_scoring'::text) -> 'canal_abierto'::text) ->> 'conseguido'::text) = 'true'::text)))::numeric) / (NULLIF(count(*) FILTER (WHERE (metadatos ? 'post_call_scoring'::text)), 0))::numeric), 1) AS pct_canal_abierto,
    count(*) FILTER (WHERE ((metadatos ->> 'duration_bucket'::text) = 'lt_30'::text)) AS dur_lt_30,
    count(*) FILTER (WHERE ((metadatos ->> 'duration_bucket'::text) = '30_60'::text)) AS dur_30_60,
    count(*) FILTER (WHERE ((metadatos ->> 'duration_bucket'::text) = '60_90'::text)) AS dur_60_90,
    count(*) FILTER (WHERE ((metadatos ->> 'duration_bucket'::text) = 'gt_90'::text)) AS dur_gt_90
   FROM public.calls c;


--
-- Name: v_propietarios; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_propietarios WITH (security_invoker='true') AS
 SELECT o.id,
    o.nombre,
    o.email,
    o.telefono,
    (o.buyer_persona)::text AS buyer_persona,
    o.consentimiento,
    o.updated_at,
    'persona_fisica'::text AS tipo,
    NULL::text AS cif
   FROM public.owners o
UNION ALL
 SELECT c.id,
    c.nombre,
    c.email,
    c.telefono,
    (c.buyer_persona)::text AS buyer_persona,
    c.consentimiento,
    c.updated_at,
    'persona_juridica'::text AS tipo,
    c.cif
   FROM public.companies c;


--
-- Name: v_retro_audit_queue; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_retro_audit_queue AS
 SELECT hs_id,
    hs_timestamp,
    hs_call_duration,
    hs_owner_id,
    hs_call_disposition,
    associated_contact_ids,
    (EXISTS ( SELECT 1
           FROM (public.external_ids e
             JOIN public.building_owners bo ON ((bo.owner_id = e.entity_id)))
          WHERE ((e.entity_type = 'owner'::text) AND (e.provider = 'hubspot'::text) AND (e.provider_id = ANY (hc.associated_contact_ids))))) AS tiene_edificio
   FROM public.hubspot_calls hc
  WHERE ((hs_call_transcription IS NOT NULL) AND (hs_call_transcription <> ''::text) AND (NOT (EXISTS ( SELECT 1
           FROM public.call_sessions cs
          WHERE (cs.hubspot_call_id = hc.hs_id)))));


--
-- Name: v_retro_audit_progress; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_retro_audit_progress AS
 WITH universe AS (
         SELECT (count(*))::integer AS total
           FROM public.hubspot_calls hc
          WHERE ((hc.hs_call_transcription IS NOT NULL) AND (hc.hs_call_transcription <> ''::text))
        ), audited AS (
         SELECT (count(*))::integer AS n
           FROM public.call_sessions
          WHERE ((call_sessions.voss_post IS NOT NULL) AND (call_sessions.hubspot_call_id IS NOT NULL))
        ), pending AS (
         SELECT (count(*))::integer AS n,
            (count(*) FILTER (WHERE v_retro_audit_queue.tiene_edificio))::integer AS n_con_edificio
           FROM public.v_retro_audit_queue
        )
 SELECT ( SELECT universe.total
           FROM universe) AS total_universo,
    ( SELECT audited.n
           FROM audited) AS auditadas,
    ( SELECT pending.n
           FROM pending) AS pendientes,
    ( SELECT pending.n_con_edificio
           FROM pending) AS pendientes_con_edificio,
        CASE
            WHEN (( SELECT universe.total
               FROM universe) > 0) THEN round(((100.0 * (( SELECT audited.n
               FROM audited))::numeric) / (( SELECT universe.total
               FROM universe))::numeric), 1)
            ELSE (0)::numeric
        END AS pct;


--
-- Name: v_rights_audit_1to1; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_rights_audit_1to1 AS
 SELECT r.id AS right_id,
    r.building_id,
    b.direccion,
    r.note_simple_id,
    r.titular_id,
    r.titular_nombre,
    r.titular_dni,
    r.right_type,
    r.percentage,
    r.coownership_regime,
    r.identity_match,
    r.right_literal,
    (t.rol)::text AS rol_nota,
    t.porcentaje AS pct_nota,
    t.nombre_extraido AS nombre_nota,
    ((r.evidence_ref ->> 'encontrado'::text))::boolean AS evidencia_localizada,
    "left"(COALESCE((r.evidence_ref ->> 'cita'::text), r.evidence), 400) AS evidencia,
    r.review_flag,
    r.review_reason,
    r.feeds_cuota,
        CASE
            WHEN (t.id IS NULL) THEN 'huerfano'::text
            WHEN (r.right_type = 'otro'::text) THEN 'review'::text
            WHEN (r.right_type = 'ganancial'::text) THEN 'review'::text
            WHEN (r.percentage IS DISTINCT FROM t.porcentaje) THEN 'conflicto_pct'::text
            WHEN (public.norm_person_name(r.titular_nombre) IS DISTINCT FROM public.norm_person_name(t.nombre_extraido)) THEN 'conflicto_nombre'::text
            WHEN r.review_flag THEN 'review'::text
            ELSE 'ok'::text
        END AS estado_auditoria
   FROM ((public.building_property_rights r
     LEFT JOIN public.nota_simple_titulares t ON ((t.id = r.titular_id)))
     LEFT JOIN public.buildings b ON ((b.id = r.building_id)))
  WHERE (r.status = 'active'::text);


--
-- Name: v_rights_cuota_eligible; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_rights_cuota_eligible AS
 SELECT r.building_id,
    r.owner_id,
    r.percentage AS pct_pleno,
    r.note_simple_id,
    r.titular_id,
    r.evidence
   FROM (public.building_property_rights r
     JOIN public.v_building_rights_status s ON ((s.building_id = r.building_id)))
  WHERE ((r.status = 'active'::text) AND (r.right_type = 'pleno_dominio'::text) AND (r.identity_match = 'dni'::text) AND (r.owner_id IS NOT NULL) AND (NOT r.review_flag) AND (((r.evidence_ref ->> 'encontrado'::text))::boolean IS TRUE) AND (r.percentage IS NOT NULL) AND s.apto_para_cuota);


--
-- Name: v_titularidad_registral; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_titularidad_registral AS
 WITH nota_principal AS (
         SELECT DISTINCT ON (n.building_id) n.building_id,
            n.id AS nota_id,
            n.structured_json,
            n.created_at
           FROM public.notas_simples n
          WHERE ((n.building_id IS NOT NULL) AND (n.status = 'listo'::text))
          ORDER BY n.building_id, ( SELECT count(*) AS count
                   FROM public.nota_simple_titulares t1
                  WHERE ((t1.nota_simple_id = n.id) AND (t1.porcentaje IS NOT NULL))) DESC, n.created_at DESC
        ), tit AS (
         SELECT np.building_id,
            np.nota_id,
            (np.structured_json ->> 'fecha_emision_nota'::text) AS fecha_emision_nota,
            t_1.id AS titular_id,
            t_1.nombre_extraido,
            t_1.cif_dni,
            t_1.porcentaje,
            COALESCE(NULLIF((t_1.rol)::text, ''::text), 'otro'::text) AS rol,
            ((COALESCE(t_1.company_id, NULL::uuid) IS NOT NULL) OR (t_1.cif_dni ~* '^[ABCDEFGHJNPQRSUVW]'::text) OR (public.normalize_person_name(t_1.nombre_extraido) ~ '(^| )(SL|SA|SLU|SAU|SOCIEDAD|INVERSIONES|PATRIMONIO|PATRIMONIAL|INMOBILIARIA)( |$)'::text)) AS es_sociedad,
            (EXISTS ( SELECT 1
                   FROM public.building_owners bo
                  WHERE ((bo.building_id = np.building_id) AND ((bo.owner_name_norm = public.normalize_person_name(t_1.nombre_extraido)) OR ((public.person_match_key(t_1.nombre_extraido) IS NOT NULL) AND (public.person_match_key(bo.owner_name_norm) = public.person_match_key(t_1.nombre_extraido))))))) AS tiene_contacto_crm
           FROM (nota_principal np
             JOIN public.nota_simple_titulares t_1 ON ((t_1.nota_simple_id = np.nota_id)))
        ), capa AS (
         SELECT tit.building_id,
            tit.nota_id,
            tit.rol,
            sum(tit.porcentaje) AS suma_capa,
            (count(*))::integer AS n_capa,
            (count(*) FILTER (WHERE (tit.porcentaje IS NOT NULL)))::integer AS n_capa_con_pct
           FROM tit
          GROUP BY tit.building_id, tit.nota_id, tit.rol
        )
 SELECT t.building_id,
    t.nota_id,
    t.fecha_emision_nota,
    t.titular_id,
    t.nombre_extraido,
    t.cif_dni,
    t.porcentaje,
    t.rol,
    t.es_sociedad,
    t.tiene_contacto_crm,
    c.suma_capa,
    c.n_capa,
    c.n_capa_con_pct,
    ((c.n_capa_con_pct > 0) AND (c.suma_capa >= (99)::numeric) AND (c.suma_capa <= (101)::numeric)) AS capa_completa
   FROM (tit t
     JOIN capa c ON (((c.building_id = t.building_id) AND (c.nota_id = t.nota_id) AND (c.rol = t.rol))));


--
-- Name: wa_consent_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_consent_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    hs_call_id text NOT NULL,
    veredicto text NOT NULL,
    cita_textual text,
    telefono text,
    confianza numeric,
    fecha_llamada timestamp with time zone,
    detectado_at timestamp with time zone DEFAULT now(),
    escrito_en_hubspot boolean DEFAULT false,
    review_status text,
    review_reason text,
    review_updated_at timestamp with time zone
);


--
-- Name: whatsapp_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.whatsapp_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    owner_id uuid,
    cuerpo text NOT NULL,
    status public.whatsapp_status DEFAULT 'borrador'::public.whatsapp_status NOT NULL,
    programado_para timestamp with time zone,
    enviado_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    hs_id text,
    direccion text,
    metadatos jsonb DEFAULT '{}'::jsonb NOT NULL,
    building_id uuid,
    hubspot_owner_id text
);


--
-- Name: v_v5_task_candidates; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_v5_task_candidates AS
 WITH base AS (
         SELECT bo.building_id,
            bo.owner_id,
            o.nombre,
            o.telefono,
            o.email,
            (o.rol)::text AS rol,
            (o.buyer_persona)::text AS buyer_persona,
            o.fecha_nacimiento,
            o.edad_anios,
            COALESCE(o.estado_vital, 'activo'::text) AS estado_vital,
            o.consentimiento,
            bo.cuota,
            bo.rol_notas,
            b.direccion,
            b.comercial,
            COALESCE(b.score_total, b.score, (0)::numeric) AS score
           FROM ((public.building_owners bo
             JOIN public.owners o ON (((o.id = bo.owner_id) AND (o.merged_into IS NULL))))
             JOIN public.buildings b ON ((b.id = bo.building_id)))
        ), cl AS (
         SELECT calls.owner_id,
            (count(*))::integer AS n_calls,
            max(calls.fecha) AS last_fecha
           FROM public.calls
          GROUP BY calls.owner_id
        ), lo AS (
         SELECT DISTINCT ON (calls.owner_id) calls.owner_id,
            calls.outcome AS last_outcome,
            calls.fecha AS last_outcome_fecha
           FROM public.calls
          WHERE (calls.outcome IS NOT NULL)
          ORDER BY calls.owner_id, calls.fecha DESC
        ), cons AS (
         SELECT DISTINCT ON (wa_consent_signals.owner_id) wa_consent_signals.owner_id,
            wa_consent_signals.veredicto,
            wa_consent_signals.cita_textual,
            COALESCE(wa_consent_signals.fecha_llamada, wa_consent_signals.detectado_at) AS senal_fecha
           FROM public.wa_consent_signals
          ORDER BY wa_consent_signals.owner_id, COALESCE(wa_consent_signals.fecha_llamada, wa_consent_signals.detectado_at) DESC
        ), wa AS (
         SELECT whatsapp_messages.owner_id,
            max(COALESCE(whatsapp_messages.enviado_at, whatsapp_messages.created_at)) AS last_wa
           FROM public.whatsapp_messages
          GROUP BY whatsapp_messages.owner_id
        ), na AS (
         SELECT next_actions.owner_id,
            min(next_actions.vencimiento) AS venc,
            min(next_actions.titulo) AS titulo
           FROM public.next_actions
          WHERE ((next_actions.estado = 'pendiente'::public.next_action_status) AND (next_actions.owner_id IS NOT NULL))
          GROUP BY next_actions.owner_id
        ), gp AS (
         SELECT guard_proposals.edificio_id,
            (count(*))::integer AS n,
            min(guard_proposals.titulo) AS titulo,
            min(guard_proposals.detalle) AS detalle
           FROM public.guard_proposals
          WHERE ((guard_proposals.estado = 'pendiente'::text) AND (guard_proposals.edificio_id IS NOT NULL))
          GROUP BY guard_proposals.edificio_id
        ), pleno AS (
         SELECT v_rights_cuota_eligible.building_id,
            sum(v_rights_cuota_eligible.pct_pleno) AS suma_pleno,
            (count(*))::integer AS n_pleno
           FROM public.v_rights_cuota_eligible
          GROUP BY v_rights_cuota_eligible.building_id
        ), rg AS (
         SELECT s.building_id,
            s.apto_para_cuota,
            s.bloqueos,
            COALESCE(p.suma_pleno, (0)::numeric) AS suma_pleno,
            COALESCE(p.n_pleno, 0) AS n_pleno,
            (s.apto_para_cuota AND (COALESCE(p.n_pleno, 0) > 0) AND (COALESCE(p.suma_pleno, (0)::numeric) >= (99)::numeric) AND (COALESCE(p.suma_pleno, (0)::numeric) <= (101)::numeric)) AS rights_ok
           FROM (public.v_building_rights_status s
             LEFT JOIN pleno p ON ((p.building_id = s.building_id)))
        ), cob AS (
         SELECT bo.building_id,
            (count(*) FILTER (WHERE ((o.telefono IS NOT NULL) AND (o.telefono <> ''::text))))::integer AS n_con_tel,
            (count(*) FILTER (WHERE (c2.n_calls > 0)))::integer AS n_contactados,
            max(c2.last_fecha) AS last_activity
           FROM ((public.building_owners bo
             JOIN public.owners o ON (((o.id = bo.owner_id) AND (o.merged_into IS NULL))))
             LEFT JOIN cl c2 ON ((c2.owner_id = bo.owner_id)))
          GROUP BY bo.building_id
        ), enr AS (
         SELECT b.building_id,
            b.owner_id,
            b.nombre,
            b.telefono,
            b.email,
            b.rol,
            b.buyer_persona,
            b.fecha_nacimiento,
            b.edad_anios,
            b.estado_vital,
            b.consentimiento,
            b.cuota,
            b.rol_notas,
            b.direccion,
            b.comercial,
            b.score,
            COALESCE(cl.n_calls, 0) AS n_calls,
            cl.last_fecha,
            lo.last_outcome,
            lo.last_outcome_fecha,
            cons.veredicto,
            cons.cita_textual,
            cons.senal_fecha,
            wa.last_wa,
            na.venc AS na_venc,
            na.titulo AS na_titulo,
            gp.n AS n_guardas,
            gp.titulo AS guarda_titulo,
            gp.detalle AS guarda_detalle,
            COALESCE(rg.rights_ok, false) AS rights_ok,
            rg.suma_pleno,
            rg.n_pleno,
            rg.bloqueos AS bloqueos_derechos,
            cob.n_con_tel,
            cob.n_contactados,
            cob.last_activity,
            (length(regexp_replace(COALESCE(b.telefono, ''::text), '\D'::text, ''::text, 'g'::text)) >= 9) AS tel_valido,
            GREATEST(0, ((EXTRACT(epoch FROM (now() - COALESCE(lo.last_outcome_fecha, cl.last_fecha))) / (86400)::numeric))::integer) AS dias_ultima,
            array_remove(ARRAY[
                CASE
                    WHEN ((b.rol IS NULL) OR (b.rol = 'desconocido'::text)) THEN 'rol/tipología'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN (b.cuota IS NULL) THEN 'cuota de propiedad'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((b.email IS NULL) OR (b.email = ''::text)) THEN 'email'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((b.buyer_persona IS NULL) OR (b.buyer_persona = 'sin_clasificar'::text)) THEN 'buyer persona'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN ((b.fecha_nacimiento IS NULL) AND (b.edad_anios IS NULL)) THEN 'edad / fecha de nacimiento'::text
                    ELSE NULL::text
                END], NULL::text) AS huecos
           FROM ((((((((base b
             LEFT JOIN cl ON ((cl.owner_id = b.owner_id)))
             LEFT JOIN lo ON ((lo.owner_id = b.owner_id)))
             LEFT JOIN cons ON ((cons.owner_id = b.owner_id)))
             LEFT JOIN wa ON ((wa.owner_id = b.owner_id)))
             LEFT JOIN na ON ((na.owner_id = b.owner_id)))
             LEFT JOIN gp ON ((gp.edificio_id = b.building_id)))
             LEFT JOIN rg ON ((rg.building_id = b.building_id)))
             LEFT JOIN cob ON ((cob.building_id = b.building_id)))
        )
 SELECT e.building_id,
    e.owner_id,
    e.nombre,
    e.direccion,
    e.comercial,
    e.score,
    e.telefono,
    e.tel_valido,
    e.n_calls,
    e.last_fecha,
    e.last_outcome,
    e.last_outcome_fecha,
    e.dias_ultima,
    e.huecos,
    e.estado_vital,
    e.rights_ok,
    e.suma_pleno,
    e.n_pleno,
    e.bloqueos_derechos,
    t.task_code,
    t.motivo,
    t.evidencia,
    t.objetivo,
    round((t.peso * GREATEST(e.score, (5)::numeric)), 2) AS prioridad
   FROM (enr e
     CROSS JOIN LATERAL ( SELECT v.task_code,
            v.peso,
            v.motivo,
            v.evidencia,
            v.objetivo,
            v.aplica
           FROM ( VALUES ('T-01'::text,(60)::numeric,'Propietario asociado al edificio sin teléfono válido en el CRM.'::text,jsonb_build_object('telefono', e.telefono, 'llamadas', e.n_calls),'Localizar y verificar un teléfono válido y el contexto del propietario. No llamar todavía.'::text,((NOT e.tel_valido) AND e.rights_ok)), ('T-02'::text,(90)::numeric,'Teléfono válido y cero llamadas registradas.'::text,jsonb_build_object('telefono', e.telefono, 'llamadas', 0),'Primera llamada de contacto y cualificación inicial.'::text,(e.tel_valido AND (e.n_calls = 0) AND (e.estado_vital = 'activo'::text) AND e.rights_ok)), ('T-03'::text,(70)::numeric,'Consentimiento de WhatsApp detectado y sin envío posterior a la señal.'::text,jsonb_build_object('veredicto', e.veredicto, 'cita', e.cita_textual, 'senal_fecha', e.senal_fecha, 'ultimo_whatsapp', e.last_wa),'Enviar el contenido acordado por WhatsApp y dejar registro.'::text,(((e.veredicto = 'autorizado'::text) OR (e.consentimiento IS TRUE)) AND (e.senal_fecha IS NOT NULL) AND ((e.last_wa IS NULL) OR (e.last_wa < e.senal_fecha)) AND (e.estado_vital = 'activo'::text) AND e.rights_ok)), ('T-04'::text,(65)::numeric,'Cadencia vencida según la última señal del propietario.'::text,jsonb_build_object('ultimo_outcome', e.last_outcome, 'fecha', e.last_outcome_fecha, 'dias', e.dias_ultima, 'accion_vencida', e.na_titulo, 'vencimiento', e.na_venc),'Retomar el contacto y fijar próxima acción con fecha.'::text,((e.estado_vital = 'activo'::text) AND (COALESCE(e.last_outcome, ''::text) <> 'interesado'::text) AND e.rights_ok AND (((e.na_venc IS NOT NULL) AND (e.na_venc < CURRENT_DATE)) OR ((e.last_outcome = 'no_contestado'::text) AND (e.dias_ultima >= 30)) OR ((e.last_outcome = ANY (ARRAY['dudoso'::text, 'otro'::text, 'no_interesado'::text])) AND (e.dias_ultima >= 45))))), ('T-05'::text,(40)::numeric,'Propietario ya contactado con huecos en la ficha (Nivel A/B).'::text,jsonb_build_object('faltan', to_jsonb(e.huecos), 'llamadas', e.n_calls, 'ultima_llamada', e.last_fecha),'Completar los campos que faltan en la ficha del propietario.'::text,((e.n_calls > 0) AND (array_length(e.huecos, 1) >= 2) AND e.rights_ok)), ('T-06'::text,(55)::numeric,'Datos del edificio pendientes de verificación (guardas o derechos registrales sin capa verificada).'::text,jsonb_build_object('guardas_pendientes', e.n_guardas, 'guarda', e.guarda_titulo, 'detalle', e.guarda_detalle, 'derechos_verificados', e.n_pleno, 'suma_pleno_verificado', e.suma_pleno, 'bloqueos_derechos', to_jsonb(e.bloqueos_derechos)),'Verificar y corregir los derechos registrales del edificio antes de operar sobre él.'::text,((COALESCE(e.n_guardas, 0) > 0) OR (NOT e.rights_ok))), ('T-08'::text,(100)::numeric,'La última llamada del propietario terminó como interesado.'::text,jsonb_build_object('ultimo_outcome', e.last_outcome, 'fecha', e.last_outcome_fecha, 'dias', e.dias_ultima),'Confirmar cita y dejar próxima acción con fecha.'::text,((e.last_outcome = 'interesado'::text) AND (e.estado_vital = 'activo'::text) AND e.rights_ok)), ('T-09'::text,(30)::numeric,'Edificio con cobertura completa de titulares y sin novedad reciente.'::text,jsonb_build_object('titulares_con_telefono', e.n_con_tel, 'contactados', e.n_contactados, 'ultima_actividad', e.last_activity),'Revisar si procede aparcar o reactivar el edificio. No es un cierre automático.'::text,((COALESCE(e.n_con_tel, 0) > 0) AND (e.n_contactados >= e.n_con_tel) AND (e.last_activity IS NOT NULL) AND (e.last_activity < (now() - '90 days'::interval)) AND e.rights_ok))) v(task_code, peso, motivo, evidencia, objetivo, aplica)
          WHERE v.aplica) t);


--
-- Name: wa_ai_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_ai_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    run_after timestamp with time zone DEFAULT now() NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wa_bot_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_bot_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    persona text DEFAULT 'Eres Lucía, asesora inmobiliaria de Afflux. Hablas natural, cercana, sin sonar a bot. Frases cortas, alguna pausa con puntos suspensivos, emoji ocasional muy puntual. Nunca te identificas como IA.'::text NOT NULL,
    tone text DEFAULT 'cercano'::text NOT NULL,
    goals jsonb DEFAULT '["cualificar interes", "obtener presupuesto", "obtener zona preferida", "obtener tipologia", "cerrar visita o llamada"]'::jsonb NOT NULL,
    extract_fields jsonb DEFAULT '["presupuesto", "zona", "tipologia", "plazo", "motivacion", "decisor"]'::jsonb NOT NULL,
    forbidden jsonb DEFAULT '["soy un bot", "inteligencia artificial", "modelo de lenguaje"]'::jsonb NOT NULL,
    reply_delay_min integer DEFAULT 4 NOT NULL,
    reply_delay_max integer DEFAULT 22 NOT NULL,
    active_hours jsonb DEFAULT '{"to": "21:00", "tz": "Europe/Madrid", "from": "09:00"}'::jsonb NOT NULL,
    off_hours_message text DEFAULT 'Te respondo mañana sin falta 🙌'::text,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    stop_words jsonb DEFAULT jsonb_build_array('quedamos así', 'cerrado', 'gracias, hablamos') NOT NULL
);


--
-- Name: wa_campaign_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_campaign_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    contact_id uuid,
    phone text NOT NULL,
    name text,
    status text DEFAULT 'pending'::text NOT NULL,
    sent_at timestamp with time zone,
    replied_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wa_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    template text NOT NULL,
    status text DEFAULT 'draft'::text NOT NULL,
    target_count integer DEFAULT 0 NOT NULL,
    sent_count integer DEFAULT 0 NOT NULL,
    replied_count integer DEFAULT 0 NOT NULL,
    qualified_count integer DEFAULT 0 NOT NULL,
    scheduled_at timestamp with time zone,
    created_by uuid,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wa_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    phone text NOT NULL,
    jid text,
    name text,
    lead_id uuid,
    stage text DEFAULT 'nuevo'::text NOT NULL,
    sentiment text,
    tags jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_message_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_human_agent_id uuid,
    last_human_contact_at timestamp with time zone,
    last_bot_contact_at timestamp with time zone
);


--
-- Name: wa_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    contact_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    summary text,
    qualification jsonb DEFAULT '{}'::jsonb NOT NULL,
    ai_enabled boolean DEFAULT true NOT NULL,
    unread_count integer DEFAULT 0 NOT NULL,
    last_message_at timestamp with time zone,
    campaign_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    summary_updated_at timestamp with time zone,
    summary_msg_count integer DEFAULT 0 NOT NULL,
    handoff_reason text,
    rol_owner public.owner_role,
    subrol_owner public.owner_subrole,
    rol_source text,
    rol_confianza numeric,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    bot_paused_until timestamp with time zone,
    assigned_email text,
    assigned_name text,
    assignment_source text,
    assigned_at timestamp with time zone,
    discarded_at timestamp with time zone,
    discarded_by uuid,
    discard_reason text,
    CONSTRAINT wa_conversations_rol_source_check CHECK ((rol_source = ANY (ARRAY['ia'::text, 'manual'::text])))
);


--
-- Name: wa_instances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_instances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    instance_name text NOT NULL,
    status text DEFAULT 'disconnected'::text NOT NULL,
    qr_base64 text,
    phone_number text,
    owner_jid text,
    last_seen_at timestamp with time zone,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: wa_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.wa_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    direction text NOT NULL,
    type text DEFAULT 'text'::text NOT NULL,
    content text,
    media_url text,
    evolution_message_id text,
    ai_generated boolean DEFAULT false NOT NULL,
    status text DEFAULT 'sent'::text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    sender_type text,
    agent_user_id uuid,
    campaign_id uuid,
    CONSTRAINT wa_messages_direction_check CHECK ((direction = ANY (ARRAY['in'::text, 'out'::text]))),
    CONSTRAINT wa_messages_sender_type_check CHECK (((sender_type IS NULL) OR (sender_type = ANY (ARRAY['contact'::text, 'bot'::text, 'human_agent'::text, 'system'::text]))))
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text,
    public boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: _a1_dangling_review _a1_dangling_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._a1_dangling_review
    ADD CONSTRAINT _a1_dangling_review_pkey PRIMARY KEY (hs_deal);


--
-- Name: _fn_backups _fn_backups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._fn_backups
    ADD CONSTRAINT _fn_backups_pkey PRIMARY KEY (id);


--
-- Name: _wave1a_drift_marks _wave1a_drift_marks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._wave1a_drift_marks
    ADD CONSTRAINT _wave1a_drift_marks_pkey PRIMARY KEY (mark);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: app_settings app_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (key);


--
-- Name: assets assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);


--
-- Name: building_analysis building_analysis_building_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_analysis
    ADD CONSTRAINT building_analysis_building_id_key UNIQUE (building_id);


--
-- Name: building_analysis building_analysis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_analysis
    ADD CONSTRAINT building_analysis_pkey PRIMARY KEY (id);


--
-- Name: building_assignments building_assignments_building_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_assignments
    ADD CONSTRAINT building_assignments_building_id_user_id_key UNIQUE (building_id, user_id);


--
-- Name: building_assignments building_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_assignments
    ADD CONSTRAINT building_assignments_pkey PRIMARY KEY (id);


--
-- Name: building_companies building_companies_building_id_company_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_companies
    ADD CONSTRAINT building_companies_building_id_company_id_role_key UNIQUE (building_id, company_id, role);


--
-- Name: building_companies building_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_companies
    ADD CONSTRAINT building_companies_pkey PRIMARY KEY (id);


--
-- Name: building_feedback building_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_feedback
    ADD CONSTRAINT building_feedback_pkey PRIMARY KEY (id);


--
-- Name: building_hs_deal_link_audit building_hs_deal_link_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_hs_deal_link_audit
    ADD CONSTRAINT building_hs_deal_link_audit_pkey PRIMARY KEY (id);


--
-- Name: building_imagery building_imagery_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_imagery
    ADD CONSTRAINT building_imagery_pkey PRIMARY KEY (id);


--
-- Name: building_overrides building_overrides_building_id_dimension_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_overrides
    ADD CONSTRAINT building_overrides_building_id_dimension_key UNIQUE (building_id, dimension);


--
-- Name: building_overrides building_overrides_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_overrides
    ADD CONSTRAINT building_overrides_pkey PRIMARY KEY (id);


--
-- Name: building_owners building_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_owners
    ADD CONSTRAINT building_owners_pkey PRIMARY KEY (building_id, owner_id);


--
-- Name: building_processing_status building_processing_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_processing_status
    ADD CONSTRAINT building_processing_status_pkey PRIMARY KEY (building_id);


--
-- Name: building_property_rights_archive building_property_rights_archive_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights_archive
    ADD CONSTRAINT building_property_rights_archive_pkey PRIMARY KEY (archive_id);


--
-- Name: building_property_rights_history building_property_rights_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights_history
    ADD CONSTRAINT building_property_rights_history_pkey PRIMARY KEY (id);


--
-- Name: building_property_rights building_property_rights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights
    ADD CONSTRAINT building_property_rights_pkey PRIMARY KEY (id);


--
-- Name: building_sanitation_history building_sanitation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sanitation_history
    ADD CONSTRAINT building_sanitation_history_pkey PRIMARY KEY (id);


--
-- Name: building_sanitation_reviews building_sanitation_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sanitation_reviews
    ADD CONSTRAINT building_sanitation_reviews_pkey PRIMARY KEY (building_id);


--
-- Name: building_tasks building_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_tasks
    ADD CONSTRAINT building_tasks_pkey PRIMARY KEY (id);


--
-- Name: buildings buildings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.buildings
    ADD CONSTRAINT buildings_pkey PRIMARY KEY (id);


--
-- Name: cadence_steps cadence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadence_steps
    ADD CONSTRAINT cadence_steps_pkey PRIMARY KEY (id);


--
-- Name: call_playbook call_playbook_perfil_tipologia_tactica_tipo_tactica_texto_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_playbook
    ADD CONSTRAINT call_playbook_perfil_tipologia_tactica_tipo_tactica_texto_key UNIQUE (perfil_tipologia, tactica_tipo, tactica_texto);


--
-- Name: call_playbook call_playbook_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_playbook
    ADD CONSTRAINT call_playbook_pkey PRIMARY KEY (id);


--
-- Name: call_sessions call_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_pkey PRIMARY KEY (id);


--
-- Name: calls calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_pkey PRIMARY KEY (id);


--
-- Name: catastro_authority_cache catastro_authority_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catastro_authority_cache
    ADD CONSTRAINT catastro_authority_cache_pkey PRIMARY KEY (id);


--
-- Name: catastro_authority_cache catastro_authority_cache_refcatastral_14_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catastro_authority_cache
    ADD CONSTRAINT catastro_authority_cache_refcatastral_14_key UNIQUE (refcatastral_14);


--
-- Name: catastro_data catastro_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catastro_data
    ADD CONSTRAINT catastro_data_pkey PRIMARY KEY (refcatastral);


--
-- Name: coach_reports coach_reports_owner_id_week_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_reports
    ADD CONSTRAINT coach_reports_owner_id_week_start_key UNIQUE (owner_id, week_start);


--
-- Name: coach_reports coach_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coach_reports
    ADD CONSTRAINT coach_reports_pkey PRIMARY KEY (id);


--
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- Name: compliance_cases compliance_cases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_cases
    ADD CONSTRAINT compliance_cases_pkey PRIMARY KEY (id);


--
-- Name: deals_gemelos deals_gemelos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals_gemelos
    ADD CONSTRAINT deals_gemelos_pkey PRIMARY KEY (id);


--
-- Name: enrichment_config enrichment_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_config
    ADD CONSTRAINT enrichment_config_pkey PRIMARY KEY (id);


--
-- Name: enrichment_jobs enrichment_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT enrichment_jobs_pkey PRIMARY KEY (id);


--
-- Name: enrichment_verifications enrichment_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_verifications
    ADD CONSTRAINT enrichment_verifications_pkey PRIMARY KEY (id);


--
-- Name: escaleras_control_set escaleras_control_set_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_control_set
    ADD CONSTRAINT escaleras_control_set_pkey PRIMARY KEY (id);


--
-- Name: escaleras_control_set escaleras_control_set_set_name_building_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_control_set
    ADD CONSTRAINT escaleras_control_set_set_name_building_id_key UNIQUE (set_name, building_id);


--
-- Name: escaleras_eval_results escaleras_eval_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_eval_results
    ADD CONSTRAINT escaleras_eval_results_pkey PRIMARY KEY (id);


--
-- Name: escaleras_eval_results escaleras_eval_results_set_name_version_building_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_eval_results
    ADD CONSTRAINT escaleras_eval_results_set_name_version_building_id_key UNIQUE (set_name, version, building_id);


--
-- Name: escaleras_validation_queue escaleras_validation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_validation_queue
    ADD CONSTRAINT escaleras_validation_queue_pkey PRIMARY KEY (id);


--
-- Name: esquina_validation_queue esquina_validation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esquina_validation_queue
    ADD CONSTRAINT esquina_validation_queue_pkey PRIMARY KEY (id);


--
-- Name: external_ids external_ids_entity_type_entity_id_provider_provider_object_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_ids
    ADD CONSTRAINT external_ids_entity_type_entity_id_provider_provider_object_key UNIQUE (entity_type, entity_id, provider, provider_object_type);


--
-- Name: external_ids external_ids_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_ids
    ADD CONSTRAINT external_ids_pkey PRIMARY KEY (id);


--
-- Name: external_ids external_ids_provider_provider_object_type_provider_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_ids
    ADD CONSTRAINT external_ids_provider_provider_object_type_provider_id_key UNIQUE (provider, provider_object_type, provider_id);


--
-- Name: facade_window_counts facade_window_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facade_window_counts
    ADD CONSTRAINT facade_window_counts_pkey PRIMARY KEY (id);


--
-- Name: facade_window_ground_truth facade_window_ground_truth_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facade_window_ground_truth
    ADD CONSTRAINT facade_window_ground_truth_pkey PRIMARY KEY (id);


--
-- Name: guard_proposals guard_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.guard_proposals
    ADD CONSTRAINT guard_proposals_pkey PRIMARY KEY (id);


--
-- Name: hubspot_calls hubspot_calls_hs_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_calls
    ADD CONSTRAINT hubspot_calls_hs_id_key UNIQUE (hs_id);


--
-- Name: hubspot_calls hubspot_calls_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_calls
    ADD CONSTRAINT hubspot_calls_pkey PRIMARY KEY (id);


--
-- Name: hubspot_changes_log hubspot_changes_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_changes_log
    ADD CONSTRAINT hubspot_changes_log_pkey PRIMARY KEY (id);


--
-- Name: hubspot_communications hubspot_communications_hs_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_communications
    ADD CONSTRAINT hubspot_communications_hs_id_key UNIQUE (hs_id);


--
-- Name: hubspot_communications hubspot_communications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_communications
    ADD CONSTRAINT hubspot_communications_pkey PRIMARY KEY (id);


--
-- Name: hubspot_deals hubspot_deals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_deals
    ADD CONSTRAINT hubspot_deals_pkey PRIMARY KEY (hs_id);


--
-- Name: hubspot_emails hubspot_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_emails
    ADD CONSTRAINT hubspot_emails_pkey PRIMARY KEY (hs_id);


--
-- Name: hubspot_link_review hubspot_link_review_hs_contact_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_link_review
    ADD CONSTRAINT hubspot_link_review_hs_contact_id_key UNIQUE (hs_contact_id);


--
-- Name: hubspot_link_review hubspot_link_review_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_link_review
    ADD CONSTRAINT hubspot_link_review_pkey PRIMARY KEY (id);


--
-- Name: hubspot_list_memberships hubspot_list_memberships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_list_memberships
    ADD CONSTRAINT hubspot_list_memberships_pkey PRIMARY KEY (hs_list_id, record_id);


--
-- Name: hubspot_lists hubspot_lists_hs_list_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_lists
    ADD CONSTRAINT hubspot_lists_hs_list_id_key UNIQUE (hs_list_id);


--
-- Name: hubspot_lists hubspot_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_lists
    ADD CONSTRAINT hubspot_lists_pkey PRIMARY KEY (id);


--
-- Name: hubspot_meetings hubspot_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_meetings
    ADD CONSTRAINT hubspot_meetings_pkey PRIMARY KEY (hs_id);


--
-- Name: hubspot_notes hubspot_notes_hs_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_notes
    ADD CONSTRAINT hubspot_notes_hs_id_key UNIQUE (hs_id);


--
-- Name: hubspot_notes hubspot_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_notes
    ADD CONSTRAINT hubspot_notes_pkey PRIMARY KEY (id);


--
-- Name: hubspot_owners hubspot_owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_owners
    ADD CONSTRAINT hubspot_owners_pkey PRIMARY KEY (hs_owner_id);


--
-- Name: hubspot_snapshots hubspot_snapshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_snapshots
    ADD CONSTRAINT hubspot_snapshots_pkey PRIMARY KEY (id);


--
-- Name: hubspot_sync_log hubspot_sync_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_sync_log
    ADD CONSTRAINT hubspot_sync_log_pkey PRIMARY KEY (id);


--
-- Name: hubspot_sync_state hubspot_sync_state_entity_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_sync_state
    ADD CONSTRAINT hubspot_sync_state_entity_key UNIQUE (entity);


--
-- Name: hubspot_sync_state hubspot_sync_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_sync_state
    ADD CONSTRAINT hubspot_sync_state_pkey PRIMARY KEY (id);


--
-- Name: hubspot_tasks hubspot_tasks_hs_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_tasks
    ADD CONSTRAINT hubspot_tasks_hs_id_key UNIQUE (hs_id);


--
-- Name: hubspot_tasks hubspot_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_tasks
    ADD CONSTRAINT hubspot_tasks_pkey PRIMARY KEY (id);


--
-- Name: hubspot_whatsapp hubspot_whatsapp_hs_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_whatsapp
    ADD CONSTRAINT hubspot_whatsapp_hs_id_key UNIQUE (hs_id);


--
-- Name: hubspot_whatsapp hubspot_whatsapp_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_whatsapp
    ADD CONSTRAINT hubspot_whatsapp_pkey PRIMARY KEY (id);


--
-- Name: investors investors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.investors
    ADD CONSTRAINT investors_pkey PRIMARY KEY (id);


--
-- Name: knowledge_chunks knowledge_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_pkey PRIMARY KEY (id);


--
-- Name: knowledge_documents knowledge_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_pkey PRIMARY KEY (id);


--
-- Name: madrid_barrio_clusters madrid_barrio_clusters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.madrid_barrio_clusters
    ADD CONSTRAINT madrid_barrio_clusters_pkey PRIMARY KEY (barrio_norm);


--
-- Name: madrid_calles_comerciales madrid_calles_comerciales_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.madrid_calles_comerciales
    ADD CONSTRAINT madrid_calles_comerciales_pkey PRIMARY KEY (calle_norm);


--
-- Name: madrid_calles_subzona madrid_calles_subzona_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.madrid_calles_subzona
    ADD CONSTRAINT madrid_calles_subzona_pkey PRIMARY KEY (id);


--
-- Name: madrid_edificios_protegidos madrid_edificios_protegidos_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.madrid_edificios_protegidos
    ADD CONSTRAINT madrid_edificios_protegidos_pkey PRIMARY KEY (id);


--
-- Name: match_candidates match_candidates_asset_id_investor_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_candidates
    ADD CONSTRAINT match_candidates_asset_id_investor_id_key UNIQUE (asset_id, investor_id);


--
-- Name: match_candidates match_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_candidates
    ADD CONSTRAINT match_candidates_pkey PRIMARY KEY (id);


--
-- Name: next_actions next_actions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_pkey PRIMARY KEY (id);


--
-- Name: nota_simple_titulares nota_simple_titulares_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_simple_titulares
    ADD CONSTRAINT nota_simple_titulares_pkey PRIMARY KEY (id);


--
-- Name: notas_fuera_universo notas_fuera_universo_nota_simple_id_hs_deal_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fuera_universo
    ADD CONSTRAINT notas_fuera_universo_nota_simple_id_hs_deal_id_key UNIQUE (nota_simple_id, hs_deal_id);


--
-- Name: notas_fuera_universo notas_fuera_universo_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fuera_universo
    ADD CONSTRAINT notas_fuera_universo_pkey PRIMARY KEY (id);


--
-- Name: notas_simples notas_simples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_simples
    ADD CONSTRAINT notas_simples_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: org_settings org_settings_clave_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_clave_key UNIQUE (clave);


--
-- Name: org_settings org_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_pkey PRIMARY KEY (id);


--
-- Name: owner_call_building_assignment owner_call_building_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_call_building_assignment
    ADD CONSTRAINT owner_call_building_assignment_pkey PRIMARY KEY (hs_id, owner_id);


--
-- Name: owner_call_prep_cache owner_call_prep_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_call_prep_cache
    ADD CONSTRAINT owner_call_prep_cache_pkey PRIMARY KEY (owner_id);


--
-- Name: owner_companies owner_companies_owner_id_company_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_companies
    ADD CONSTRAINT owner_companies_owner_id_company_id_role_key UNIQUE (owner_id, company_id, role);


--
-- Name: owner_companies owner_companies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_companies
    ADD CONSTRAINT owner_companies_pkey PRIMARY KEY (id);


--
-- Name: owner_merge_audit owner_merge_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_merge_audit
    ADD CONSTRAINT owner_merge_audit_pkey PRIMARY KEY (id);


--
-- Name: owner_relations owner_relations_owner_a_id_owner_b_id_relation_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_relations
    ADD CONSTRAINT owner_relations_owner_a_id_owner_b_id_relation_type_key UNIQUE (owner_a_id, owner_b_id, relation_type);


--
-- Name: owner_relations owner_relations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_relations
    ADD CONSTRAINT owner_relations_pkey PRIMARY KEY (id);


--
-- Name: owners owners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owners
    ADD CONSTRAINT owners_pkey PRIMARY KEY (id);


--
-- Name: parcel_geometry_cache parcel_geometry_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_geometry_cache
    ADD CONSTRAINT parcel_geometry_cache_pkey PRIMARY KEY (id);


--
-- Name: parcel_geometry_cache parcel_geometry_cache_refcatastral_14_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.parcel_geometry_cache
    ADD CONSTRAINT parcel_geometry_cache_refcatastral_14_key UNIQUE (refcatastral_14);


--
-- Name: patio_window_counts patio_window_counts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patio_window_counts
    ADD CONSTRAINT patio_window_counts_pkey PRIMARY KEY (id);


--
-- Name: pending_conversation_emails pending_conversation_emails_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pending_conversation_emails
    ADD CONSTRAINT pending_conversation_emails_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: proteccion_validation_queue proteccion_validation_queue_building_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proteccion_validation_queue
    ADD CONSTRAINT proteccion_validation_queue_building_id_key UNIQUE (building_id);


--
-- Name: proteccion_validation_queue proteccion_validation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proteccion_validation_queue
    ADD CONSTRAINT proteccion_validation_queue_pkey PRIMARY KEY (id);


--
-- Name: qa_ground_truth qa_ground_truth_lista_direccion_norm_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_ground_truth
    ADD CONSTRAINT qa_ground_truth_lista_direccion_norm_key UNIQUE (lista, direccion_norm);


--
-- Name: qa_ground_truth qa_ground_truth_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_ground_truth
    ADD CONSTRAINT qa_ground_truth_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_queue reconciliation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_queue
    ADD CONSTRAINT reconciliation_queue_pkey PRIMARY KEY (id);


--
-- Name: scoring_v2_feedback scoring_v2_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_v2_feedback
    ADD CONSTRAINT scoring_v2_feedback_pkey PRIMARY KEY (id);


--
-- Name: scoring_v2_jobs scoring_v2_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_v2_jobs
    ADD CONSTRAINT scoring_v2_jobs_pkey PRIMARY KEY (id);


--
-- Name: scoring_v2_seed scoring_v2_seed_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_v2_seed
    ADD CONSTRAINT scoring_v2_seed_pkey PRIMARY KEY (edificio);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);


--
-- Name: wa_ai_jobs wa_ai_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_ai_jobs
    ADD CONSTRAINT wa_ai_jobs_pkey PRIMARY KEY (id);


--
-- Name: wa_bot_config wa_bot_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_bot_config
    ADD CONSTRAINT wa_bot_config_pkey PRIMARY KEY (id);


--
-- Name: wa_campaign_targets wa_campaign_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_campaign_targets
    ADD CONSTRAINT wa_campaign_targets_pkey PRIMARY KEY (id);


--
-- Name: wa_campaigns wa_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_campaigns
    ADD CONSTRAINT wa_campaigns_pkey PRIMARY KEY (id);


--
-- Name: wa_consent_signals wa_consent_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_consent_signals
    ADD CONSTRAINT wa_consent_signals_pkey PRIMARY KEY (id);


--
-- Name: wa_contacts wa_contacts_phone_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_contacts
    ADD CONSTRAINT wa_contacts_phone_key UNIQUE (phone);


--
-- Name: wa_contacts wa_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_contacts
    ADD CONSTRAINT wa_contacts_pkey PRIMARY KEY (id);


--
-- Name: wa_conversations wa_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversations
    ADD CONSTRAINT wa_conversations_pkey PRIMARY KEY (id);


--
-- Name: wa_instances wa_instances_instance_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_instances
    ADD CONSTRAINT wa_instances_instance_name_key UNIQUE (instance_name);


--
-- Name: wa_instances wa_instances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_instances
    ADD CONSTRAINT wa_instances_pkey PRIMARY KEY (id);


--
-- Name: wa_messages wa_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_messages
    ADD CONSTRAINT wa_messages_pkey PRIMARY KEY (id);


--
-- Name: whatsapp_messages whatsapp_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: building_feedback_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX building_feedback_building_idx ON public.building_feedback USING btree (building_id, created_at DESC);


--
-- Name: building_feedback_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX building_feedback_estado_idx ON public.building_feedback USING btree (estado);


--
-- Name: building_imagery_building_file_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX building_imagery_building_file_unique ON public.building_imagery USING btree (building_id, file_path);


--
-- Name: building_imagery_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX building_imagery_building_idx ON public.building_imagery USING btree (building_id);


--
-- Name: building_owners_unique_by_norm_name; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX building_owners_unique_by_norm_name ON public.building_owners USING btree (building_id, owner_name_norm) WHERE (owner_name_norm IS NOT NULL);


--
-- Name: buildings_refcatastral_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX buildings_refcatastral_uniq ON public.buildings USING btree (refcatastral) WHERE (refcatastral IS NOT NULL);


--
-- Name: buildings_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX buildings_score_idx ON public.buildings USING btree (score DESC NULLS LAST);


--
-- Name: call_sessions_comercial_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_comercial_email_idx ON public.call_sessions USING btree (comercial_email);


--
-- Name: call_sessions_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_estado_idx ON public.call_sessions USING btree (estado);


--
-- Name: call_sessions_hubspot_call_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_hubspot_call_idx ON public.call_sessions USING btree (hubspot_call_id);


--
-- Name: call_sessions_owner_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_owner_open_idx ON public.call_sessions USING btree (owner_id) WHERE (finalizada_at IS NULL);


--
-- Name: call_sessions_retroactiva_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX call_sessions_retroactiva_idx ON public.call_sessions USING btree (retroactiva) WHERE (retroactiva = true);


--
-- Name: catastro_data_building_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX catastro_data_building_id_unique ON public.catastro_data USING btree (building_id) WHERE (building_id IS NOT NULL);


--
-- Name: catastro_data_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX catastro_data_building_idx ON public.catastro_data USING btree (building_id);


--
-- Name: deals_gemelos_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX deals_gemelos_building_idx ON public.deals_gemelos USING btree (building_id);


--
-- Name: deals_gemelos_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX deals_gemelos_uniq ON public.deals_gemelos USING btree (building_id, hs_deal_gemelo);


--
-- Name: external_ids_owner_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX external_ids_owner_contact_idx ON public.external_ids USING btree (entity_id) WHERE ((provider = 'hubspot'::text) AND (entity_type = 'owner'::text) AND (provider_object_type = 'contact'::text));


--
-- Name: facade_gt_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facade_gt_building_idx ON public.facade_window_ground_truth USING btree (building_id);


--
-- Name: facade_window_counts_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facade_window_counts_building_idx ON public.facade_window_counts USING btree (building_id, created_at DESC);


--
-- Name: facade_window_counts_rc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX facade_window_counts_rc_idx ON public.facade_window_counts USING btree (refcatastral_14);


--
-- Name: guard_proposals_guarda_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX guard_proposals_guarda_estado_idx ON public.guard_proposals USING btree (guarda, estado, creado_at DESC);


--
-- Name: guard_proposals_pendiente_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX guard_proposals_pendiente_uniq ON public.guard_proposals USING btree (guarda, entity_id) WHERE (estado = 'pendiente'::text);


--
-- Name: hubspot_calls_contacts_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hubspot_calls_contacts_gin ON public.hubspot_calls USING gin (associated_contact_ids);


--
-- Name: hubspot_calls_deals_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hubspot_calls_deals_gin ON public.hubspot_calls USING gin (associated_deal_ids);


--
-- Name: hubspot_deals_contacts_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hubspot_deals_contacts_gin ON public.hubspot_deals USING gin (associated_contact_ids);


--
-- Name: hubspot_deals_lastmod_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hubspot_deals_lastmod_idx ON public.hubspot_deals USING btree (hs_lastmodifieddate DESC);


--
-- Name: hubspot_deals_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hubspot_deals_owner_idx ON public.hubspot_deals USING btree (hs_owner_id);


--
-- Name: hubspot_tasks_contacts_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX hubspot_tasks_contacts_gin ON public.hubspot_tasks USING gin (associated_contact_ids);


--
-- Name: idx_a1_dangling_review_candidato; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_a1_dangling_review_candidato ON public._a1_dangling_review USING btree (candidato);


--
-- Name: idx_assets_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_building_id ON public.assets USING btree (building_id);


--
-- Name: idx_assets_ciudad_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_ciudad_trgm ON public.assets USING gin (ciudad public.gin_trgm_ops);


--
-- Name: idx_assets_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_created_at ON public.assets USING btree (created_at DESC);


--
-- Name: idx_assets_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_estado ON public.assets USING btree (estado);


--
-- Name: idx_assets_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_owner_id ON public.assets USING btree (owner_id);


--
-- Name: idx_assets_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_tipo ON public.assets USING btree (tipo);


--
-- Name: idx_assets_ubicacion_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_ubicacion_trgm ON public.assets USING gin (ubicacion public.gin_trgm_ops);


--
-- Name: idx_assets_valoracion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_assets_valoracion ON public.assets USING btree (valoracion_estimada DESC NULLS LAST);


--
-- Name: idx_bc_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_building ON public.building_companies USING btree (building_id);


--
-- Name: idx_bc_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_building_id ON public.building_companies USING btree (building_id);


--
-- Name: idx_bc_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_company ON public.building_companies USING btree (company_id);


--
-- Name: idx_bc_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_company_id ON public.building_companies USING btree (company_id);


--
-- Name: idx_bc_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bc_role ON public.building_companies USING btree (role);


--
-- Name: idx_bo_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bo_building_id ON public.building_owners USING btree (building_id);


--
-- Name: idx_bo_cuota_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bo_cuota_estado ON public.building_owners USING btree (cuota_estado);


--
-- Name: idx_bo_es_influencer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bo_es_influencer ON public.building_owners USING btree (es_influencer) WHERE (es_influencer = true);


--
-- Name: idx_bo_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bo_owner_id ON public.building_owners USING btree (owner_id);


--
-- Name: idx_bo_subrole; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bo_subrole ON public.building_owners USING btree (subrole);


--
-- Name: idx_bpr_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bpr_building ON public.building_property_rights USING btree (building_id);


--
-- Name: idx_bpr_building_layer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bpr_building_layer ON public.building_property_rights USING btree (building_id, right_type);


--
-- Name: idx_bpr_building_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bpr_building_type ON public.building_property_rights USING btree (building_id, right_type);


--
-- Name: idx_bpr_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bpr_company ON public.building_property_rights USING btree (company_id);


--
-- Name: idx_bpr_nota; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bpr_nota ON public.building_property_rights USING btree (note_simple_id);


--
-- Name: idx_bpr_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_bpr_owner ON public.building_property_rights USING btree (owner_id);


--
-- Name: idx_building_analysis_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_analysis_building_id ON public.building_analysis USING btree (building_id);


--
-- Name: idx_building_analysis_metricas_extra_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_analysis_metricas_extra_gin ON public.building_analysis USING gin (metricas_extra jsonb_path_ops);


--
-- Name: idx_building_assignments_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_assignments_building ON public.building_assignments USING btree (building_id);


--
-- Name: idx_building_assignments_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_assignments_user ON public.building_assignments USING btree (user_id);


--
-- Name: idx_building_assignments_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_assignments_user_status ON public.building_assignments USING btree (user_id, status);


--
-- Name: idx_building_companies_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_companies_building_id ON public.building_companies USING btree (building_id);


--
-- Name: idx_building_owners_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_owners_building ON public.building_owners USING btree (building_id);


--
-- Name: idx_building_owners_influencer; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_owners_influencer ON public.building_owners USING btree (building_id, es_influencer);


--
-- Name: idx_building_owners_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_owners_owner ON public.building_owners USING btree (owner_id);


--
-- Name: idx_building_tasks_auto_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_building_tasks_auto_unique ON public.building_tasks USING btree (building_id, user_id, task_key) WHERE (task_key IS NOT NULL);


--
-- Name: idx_building_tasks_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_tasks_building ON public.building_tasks USING btree (building_id);


--
-- Name: idx_building_tasks_user_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_building_tasks_user_status ON public.building_tasks USING btree (user_id, status);


--
-- Name: idx_buildings_cartera_demo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_cartera_demo ON public.buildings USING btree (cartera_demo_seed) WHERE (cartera_demo_seed = true);


--
-- Name: idx_buildings_catastro_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_catastro_norm ON public.buildings USING btree (public.normalize_catastro(catastro_ref));


--
-- Name: idx_buildings_catastro_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_catastro_trgm ON public.buildings USING gin (catastro_ref public.gin_trgm_ops);


--
-- Name: idx_buildings_ciudad_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_ciudad_trgm ON public.buildings USING gin (ciudad public.gin_trgm_ops);


--
-- Name: idx_buildings_cluster; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_cluster ON public.buildings USING btree (cluster_asignado);


--
-- Name: idx_buildings_comercial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_comercial ON public.buildings USING btree (comercial);


--
-- Name: idx_buildings_cp_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_cp_trgm ON public.buildings USING gin (codigo_postal public.gin_trgm_ops);


--
-- Name: idx_buildings_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_created_at ON public.buildings USING btree (created_at DESC);


--
-- Name: idx_buildings_direccion_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_direccion_trgm ON public.buildings USING gin (direccion public.gin_trgm_ops);


--
-- Name: idx_buildings_es_estrella; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_es_estrella ON public.buildings USING btree (es_estrella) WHERE (es_estrella = true);


--
-- Name: idx_buildings_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_estado ON public.buildings USING btree (estado);


--
-- Name: idx_buildings_grupo_barrio; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_grupo_barrio ON public.buildings USING btree (grupo_barrio);


--
-- Name: idx_buildings_last_synced_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_last_synced_at ON public.buildings USING btree (last_synced_at DESC NULLS LAST);


--
-- Name: idx_buildings_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_buildings_updated_at ON public.buildings USING btree (updated_at DESC NULLS LAST);


--
-- Name: idx_call_sessions_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_building ON public.call_sessions USING btree (building_id);


--
-- Name: idx_call_sessions_comercial; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_comercial ON public.call_sessions USING btree (comercial_id, iniciada_at DESC);


--
-- Name: idx_call_sessions_hs_call; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_hs_call ON public.call_sessions USING btree (hubspot_call_id) WHERE (hubspot_call_id IS NOT NULL);


--
-- Name: idx_call_sessions_next_retry; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_next_retry ON public.call_sessions USING btree (next_retry_at) WHERE ((next_retry_at IS NOT NULL) AND (estado <> 'finalizada'::text));


--
-- Name: idx_call_sessions_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_owner ON public.call_sessions USING btree (owner_id);


--
-- Name: idx_call_sessions_owner_finalizada; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_call_sessions_owner_finalizada ON public.call_sessions USING btree (owner_id, finalizada_at DESC) WHERE (estado = 'finalizada'::text);


--
-- Name: idx_calles_subzona_calle_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calles_subzona_calle_norm ON public.madrid_calles_subzona USING btree (calle_norm);


--
-- Name: idx_calls_analyzed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_analyzed_at ON public.calls USING btree (analyzed_at);


--
-- Name: idx_calls_comercial_hs_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_comercial_hs_id ON public.calls USING btree (comercial_hs_id);


--
-- Name: idx_calls_comercial_hs_id_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_comercial_hs_id_fecha ON public.calls USING btree (comercial_hs_id, fecha);


--
-- Name: idx_calls_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_created_at ON public.calls USING btree (created_at DESC);


--
-- Name: idx_calls_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_fecha ON public.calls USING btree (fecha DESC);


--
-- Name: idx_calls_metadatos_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_metadatos_gin ON public.calls USING gin (metadatos);


--
-- Name: idx_calls_outcome; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_outcome ON public.calls USING btree (outcome);


--
-- Name: idx_calls_owner_fecha; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_owner_fecha ON public.calls USING btree (owner_id, fecha DESC);


--
-- Name: idx_calls_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_owner_id ON public.calls USING btree (owner_id);


--
-- Name: idx_calls_pivot_moments; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_pivot_moments ON public.calls USING gin (pivot_moments jsonb_path_ops);


--
-- Name: idx_calls_resumen_null; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_resumen_null ON public.calls USING btree (id) WHERE (resumen IS NULL);


--
-- Name: idx_calls_resumen_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_resumen_trgm ON public.calls USING gin (resumen public.gin_trgm_ops);


--
-- Name: idx_calls_sentiment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_sentiment ON public.calls USING btree (sentiment);


--
-- Name: idx_calls_tacticas_usadas; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_tacticas_usadas ON public.calls USING gin (tacticas_usadas);


--
-- Name: idx_calls_transcripcion_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_calls_transcripcion_source ON public.calls USING btree (transcripcion_source);


--
-- Name: idx_catastro_authority_cache_ref20; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catastro_authority_cache_ref20 ON public.catastro_authority_cache USING btree (refcatastral_20);


--
-- Name: idx_catastro_authority_rc14; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_catastro_authority_rc14 ON public.catastro_authority_cache USING btree (refcatastral_14);


--
-- Name: idx_coach_reports_comercial_week; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_coach_reports_comercial_week ON public.coach_reports USING btree (comercial_hs_id, week_start) WHERE (comercial_hs_id IS NOT NULL);


--
-- Name: idx_coach_reports_owner_week; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_coach_reports_owner_week ON public.coach_reports USING btree (owner_id, week_start DESC);


--
-- Name: idx_companies_buyer_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_buyer_persona ON public.companies USING btree (buyer_persona);


--
-- Name: idx_companies_cif_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_cif_trgm ON public.companies USING gin (cif public.gin_trgm_ops);


--
-- Name: idx_companies_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_created_at ON public.companies USING btree (created_at DESC);


--
-- Name: idx_companies_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_email_trgm ON public.companies USING gin (email public.gin_trgm_ops);


--
-- Name: idx_companies_last_synced; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_last_synced ON public.companies USING btree (last_synced_at DESC NULLS LAST);


--
-- Name: idx_companies_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_companies_nombre_trgm ON public.companies USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_eid_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eid_entity ON public.external_ids USING btree (entity_type, entity_id);


--
-- Name: idx_eid_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eid_provider ON public.external_ids USING btree (provider, provider_id);


--
-- Name: idx_enrichment_jobs_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_jobs_building ON public.enrichment_jobs USING btree (building_id);


--
-- Name: idx_enrichment_jobs_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_jobs_queue ON public.enrichment_jobs USING btree (estado, fase, next_attempt_at);


--
-- Name: idx_enrichment_verifications_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_verifications_job ON public.enrichment_verifications USING btree (job_id);


--
-- Name: idx_escaleras_vq_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escaleras_vq_building ON public.escaleras_validation_queue USING btree (building_id);


--
-- Name: idx_escaleras_vq_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_escaleras_vq_estado ON public.escaleras_validation_queue USING btree (estado);


--
-- Name: idx_esquina_vq_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_esquina_vq_building ON public.esquina_validation_queue USING btree (building_id);


--
-- Name: idx_esquina_vq_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_esquina_vq_estado ON public.esquina_validation_queue USING btree (estado);


--
-- Name: idx_eval_results_set_version; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_eval_results_set_version ON public.escaleras_eval_results USING btree (set_name, version);


--
-- Name: idx_external_ids_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_ids_entity ON public.external_ids USING btree (entity_type, entity_id);


--
-- Name: idx_external_ids_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_external_ids_provider ON public.external_ids USING btree (provider, provider_object_type, provider_id);


--
-- Name: idx_hs_calls_assoc_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_calls_assoc_contacts ON public.hubspot_calls USING gin (associated_contact_ids);


--
-- Name: idx_hs_calls_assoc_deals; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_calls_assoc_deals ON public.hubspot_calls USING gin (associated_deal_ids);


--
-- Name: idx_hs_calls_hs_lastmod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_calls_hs_lastmod ON public.hubspot_calls USING btree (hs_lastmodifieddate DESC);


--
-- Name: idx_hs_calls_hs_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_calls_hs_owner_id ON public.hubspot_calls USING btree (hs_owner_id);


--
-- Name: idx_hs_calls_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_calls_hs_timestamp ON public.hubspot_calls USING btree (hs_timestamp DESC);


--
-- Name: idx_hs_comms_assoc_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_comms_assoc_contacts ON public.hubspot_communications USING gin (associated_contact_ids);


--
-- Name: idx_hs_comms_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_comms_channel ON public.hubspot_communications USING btree (hs_communication_channel_type);


--
-- Name: idx_hs_comms_hs_lastmod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_comms_hs_lastmod ON public.hubspot_communications USING btree (hs_lastmodifieddate DESC);


--
-- Name: idx_hs_comms_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_comms_hs_timestamp ON public.hubspot_communications USING btree (hs_timestamp DESC);


--
-- Name: idx_hs_link_audit_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_link_audit_building ON public.building_hs_deal_link_audit USING btree (building_id);


--
-- Name: idx_hs_meetings_assoc_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_meetings_assoc_contacts ON public.hubspot_meetings USING gin (associated_contact_ids);


--
-- Name: idx_hs_meetings_hs_lastmod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_meetings_hs_lastmod ON public.hubspot_meetings USING btree (hs_lastmodifieddate DESC);


--
-- Name: idx_hs_notes_assoc_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_notes_assoc_contacts ON public.hubspot_notes USING gin (associated_contact_ids);


--
-- Name: idx_hs_notes_hs_lastmod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_notes_hs_lastmod ON public.hubspot_notes USING btree (hs_lastmodifieddate DESC);


--
-- Name: idx_hs_notes_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_notes_hs_timestamp ON public.hubspot_notes USING btree (hs_timestamp DESC);


--
-- Name: idx_hs_owners_archived; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_owners_archived ON public.hubspot_owners USING btree (archived);


--
-- Name: idx_hs_owners_synced_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_owners_synced_at ON public.hubspot_owners USING btree (synced_at DESC);


--
-- Name: idx_hs_tasks_assoc_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_tasks_assoc_contacts ON public.hubspot_tasks USING gin (associated_contact_ids);


--
-- Name: idx_hs_tasks_hs_lastmod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_tasks_hs_lastmod ON public.hubspot_tasks USING btree (hs_lastmodifieddate DESC);


--
-- Name: idx_hs_tasks_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_tasks_hs_timestamp ON public.hubspot_tasks USING btree (hs_timestamp DESC);


--
-- Name: idx_hs_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_tasks_status ON public.hubspot_tasks USING btree (hs_task_status);


--
-- Name: idx_hs_wa_hs_lastmod; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_wa_hs_lastmod ON public.hubspot_whatsapp USING btree (hs_lastmodifieddate DESC);


--
-- Name: idx_hs_wa_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_wa_hs_timestamp ON public.hubspot_whatsapp USING btree (hs_timestamp DESC);


--
-- Name: idx_hs_whatsapp_assoc_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hs_whatsapp_assoc_contacts ON public.hubspot_whatsapp USING gin (associated_contact_ids);


--
-- Name: idx_hubspot_calls_hs_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_calls_hs_owner_id ON public.hubspot_calls USING btree (hs_owner_id);


--
-- Name: idx_hubspot_calls_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_calls_timestamp ON public.hubspot_calls USING btree (hs_timestamp DESC);


--
-- Name: idx_hubspot_changes_log_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_changes_log_entity ON public.hubspot_changes_log USING btree (entity_type, hs_id, observed_at DESC);


--
-- Name: idx_hubspot_changes_log_observed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_changes_log_observed ON public.hubspot_changes_log USING btree (observed_at DESC);


--
-- Name: idx_hubspot_communications_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_communications_channel ON public.hubspot_communications USING btree (hs_communication_channel_type);


--
-- Name: idx_hubspot_communications_hs_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_communications_hs_owner ON public.hubspot_communications USING btree (hs_owner_id);


--
-- Name: idx_hubspot_communications_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_communications_hs_timestamp ON public.hubspot_communications USING btree (hs_timestamp DESC);


--
-- Name: idx_hubspot_emails_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_emails_contacts ON public.hubspot_emails USING gin (associated_contact_ids);


--
-- Name: idx_hubspot_emails_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_emails_ts ON public.hubspot_emails USING btree (hs_timestamp DESC);


--
-- Name: idx_hubspot_link_review_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_link_review_status ON public.hubspot_link_review USING btree (status, updated_at DESC);


--
-- Name: idx_hubspot_list_memberships_record; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_list_memberships_record ON public.hubspot_list_memberships USING btree (record_id, object_type);


--
-- Name: idx_hubspot_meetings_contacts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_meetings_contacts ON public.hubspot_meetings USING gin (associated_contact_ids);


--
-- Name: idx_hubspot_meetings_ts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_meetings_ts ON public.hubspot_meetings USING btree (hs_timestamp DESC);


--
-- Name: idx_hubspot_notes_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_notes_timestamp ON public.hubspot_notes USING btree (hs_timestamp DESC);


--
-- Name: idx_hubspot_snapshots_taken; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_snapshots_taken ON public.hubspot_snapshots USING btree (taken_at DESC);


--
-- Name: idx_hubspot_sync_log_entity_started; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_sync_log_entity_started ON public.hubspot_sync_log USING btree (entity, started_at DESC);


--
-- Name: idx_hubspot_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_tasks_status ON public.hubspot_tasks USING btree (hs_task_status);


--
-- Name: idx_hubspot_tasks_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_tasks_timestamp ON public.hubspot_tasks USING btree (hs_timestamp DESC);


--
-- Name: idx_hubspot_whatsapp_hs_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_whatsapp_hs_owner ON public.hubspot_whatsapp USING btree (hs_owner_id);


--
-- Name: idx_hubspot_whatsapp_hs_timestamp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_hubspot_whatsapp_hs_timestamp ON public.hubspot_whatsapp USING btree (hs_timestamp DESC);


--
-- Name: idx_kc_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kc_origen ON public.knowledge_chunks USING btree (origen);


--
-- Name: idx_kc_scope_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kc_scope_id ON public.knowledge_chunks USING btree (scope_id);


--
-- Name: idx_kc_scope_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kc_scope_type ON public.knowledge_chunks USING btree (scope_type);


--
-- Name: idx_knowledge_chunks_document_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_chunks_document_id ON public.knowledge_chunks USING btree (document_id);


--
-- Name: idx_knowledge_chunks_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_chunks_embedding ON public.knowledge_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: idx_knowledge_chunks_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_knowledge_chunks_scope ON public.knowledge_chunks USING btree (scope_type, scope_id);


--
-- Name: idx_madrid_protegidos_direccion_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_madrid_protegidos_direccion_trgm ON public.madrid_edificios_protegidos USING gin (direccion_norm public.gin_trgm_ops);


--
-- Name: idx_match_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_asset_id ON public.match_candidates USING btree (asset_id);


--
-- Name: idx_match_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_estado ON public.match_candidates USING btree (estado);


--
-- Name: idx_match_investor_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_investor_id ON public.match_candidates USING btree (investor_id);


--
-- Name: idx_match_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_match_score ON public.match_candidates USING btree (score DESC);


--
-- Name: idx_na_asset_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_na_asset_id ON public.next_actions USING btree (asset_id) WHERE (asset_id IS NOT NULL);


--
-- Name: idx_na_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_na_estado ON public.next_actions USING btree (estado);


--
-- Name: idx_na_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_na_owner_id ON public.next_actions USING btree (owner_id) WHERE (owner_id IS NOT NULL);


--
-- Name: idx_na_scope; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_na_scope ON public.next_actions USING btree (scope_type, scope_id);


--
-- Name: idx_next_actions_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_created_at ON public.next_actions USING btree (created_at DESC);


--
-- Name: idx_next_actions_detalle_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_detalle_trgm ON public.next_actions USING gin (detalle public.gin_trgm_ops);


--
-- Name: idx_next_actions_estado; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_estado ON public.next_actions USING btree (estado);


--
-- Name: idx_next_actions_origen; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_origen ON public.next_actions USING btree (origen);


--
-- Name: idx_next_actions_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_owner_id ON public.next_actions USING btree (owner_id);


--
-- Name: idx_next_actions_titulo_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_titulo_trgm ON public.next_actions USING gin (titulo public.gin_trgm_ops);


--
-- Name: idx_next_actions_vencimiento; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_next_actions_vencimiento ON public.next_actions USING btree (vencimiento);


--
-- Name: idx_notas_fuera_universo_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_fuera_universo_deal ON public.notas_fuera_universo USING btree (hs_deal_id);


--
-- Name: idx_notas_reparse_queue; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_reparse_queue ON public.notas_simples USING btree (next_retry_at) WHERE (dead_letter = false);


--
-- Name: idx_notas_simples_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_simples_building_id ON public.notas_simples USING btree (building_id);


--
-- Name: idx_notas_simples_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_simples_created_at ON public.notas_simples USING btree (created_at DESC);


--
-- Name: idx_notas_simples_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_simples_owner_id ON public.notas_simples USING btree (owner_id);


--
-- Name: idx_notas_simples_riesgo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_simples_riesgo ON public.notas_simples USING btree (riesgo);


--
-- Name: idx_notas_simples_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notas_simples_status ON public.notas_simples USING btree (status);


--
-- Name: idx_ns_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ns_building_id ON public.notas_simples USING btree (building_id) WHERE (building_id IS NOT NULL);


--
-- Name: idx_ns_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ns_owner_id ON public.notas_simples USING btree (owner_id) WHERE (owner_id IS NOT NULL);


--
-- Name: idx_ns_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ns_status ON public.notas_simples USING btree (status);


--
-- Name: idx_nst_cif; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_cif ON public.nota_simple_titulares USING btree (cif_dni);


--
-- Name: idx_nst_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_company ON public.nota_simple_titulares USING btree (company_id);


--
-- Name: idx_nst_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_company_id ON public.nota_simple_titulares USING btree (company_id) WHERE (company_id IS NOT NULL);


--
-- Name: idx_nst_nota; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_nota ON public.nota_simple_titulares USING btree (nota_simple_id);


--
-- Name: idx_nst_nota_simple_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_nota_simple_id ON public.nota_simple_titulares USING btree (nota_simple_id);


--
-- Name: idx_nst_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_owner ON public.nota_simple_titulares USING btree (owner_id);


--
-- Name: idx_nst_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_owner_id ON public.nota_simple_titulares USING btree (owner_id) WHERE (owner_id IS NOT NULL);


--
-- Name: idx_nst_rol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nst_rol ON public.nota_simple_titulares USING btree (rol);


--
-- Name: idx_oc_company; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oc_company ON public.owner_companies USING btree (company_id);


--
-- Name: idx_oc_company_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oc_company_id ON public.owner_companies USING btree (company_id);


--
-- Name: idx_oc_owner; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oc_owner ON public.owner_companies USING btree (owner_id);


--
-- Name: idx_oc_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oc_owner_id ON public.owner_companies USING btree (owner_id);


--
-- Name: idx_oc_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oc_role ON public.owner_companies USING btree (role);


--
-- Name: idx_oma_canonical; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oma_canonical ON public.owner_merge_audit USING btree (canonical_owner_id);


--
-- Name: idx_oma_merged; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_oma_merged ON public.owner_merge_audit USING btree (merged_owner_id);


--
-- Name: idx_or_a; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_or_a ON public.owner_relations USING btree (owner_a_id);


--
-- Name: idx_or_b; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_or_b ON public.owner_relations USING btree (owner_b_id);


--
-- Name: idx_or_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_or_type ON public.owner_relations USING btree (relation_type);


--
-- Name: idx_owners_buyer_persona; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_buyer_persona ON public.owners USING btree (buyer_persona);


--
-- Name: idx_owners_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_created_at ON public.owners USING btree (created_at DESC);


--
-- Name: idx_owners_email_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_email_trgm ON public.owners USING gin (email public.gin_trgm_ops);


--
-- Name: idx_owners_last_synced_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_last_synced_at ON public.owners USING btree (last_synced_at DESC NULLS LAST);


--
-- Name: idx_owners_merged_into; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_merged_into ON public.owners USING btree (merged_into) WHERE (merged_into IS NOT NULL);


--
-- Name: idx_owners_metadatos_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_metadatos_gin ON public.owners USING gin (metadatos);


--
-- Name: idx_owners_nombre_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_nombre_trgm ON public.owners USING gin (nombre public.gin_trgm_ops);


--
-- Name: idx_owners_rol; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_rol ON public.owners USING btree (rol);


--
-- Name: idx_owners_subrole; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_subrole ON public.owners USING btree (subrole);


--
-- Name: idx_owners_telefono_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_telefono_trgm ON public.owners USING gin (telefono public.gin_trgm_ops);


--
-- Name: idx_owners_updated_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_owners_updated_at ON public.owners USING btree (updated_at DESC NULLS LAST);


--
-- Name: idx_playbook_perfil; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playbook_perfil ON public.call_playbook USING btree (perfil_tipologia, tasa_exito DESC);


--
-- Name: idx_playbook_tipo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_playbook_tipo ON public.call_playbook USING btree (tactica_tipo);


--
-- Name: idx_protegidos_refcat_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_protegidos_refcat_norm ON public.madrid_edificios_protegidos USING btree (refcat_norm);


--
-- Name: idx_qa_gt_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_gt_building ON public.qa_ground_truth USING btree (building_id);


--
-- Name: idx_qa_gt_deal; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_gt_deal ON public.qa_ground_truth USING btree (deal_id);


--
-- Name: idx_qa_gt_dir_norm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_qa_gt_dir_norm ON public.qa_ground_truth USING btree (direccion_norm);


--
-- Name: idx_recq_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_recq_building ON public.reconciliation_queue USING btree (building_id);


--
-- Name: idx_sanitation_hist_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sanitation_hist_building ON public.building_sanitation_history USING btree (building_id, changed_at DESC);


--
-- Name: idx_scoring_v2_feedback_building; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scoring_v2_feedback_building ON public.scoring_v2_feedback USING btree (building_id);


--
-- Name: idx_wa_building_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_building_id ON public.whatsapp_messages USING btree (building_id);


--
-- Name: idx_wa_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_created_at ON public.whatsapp_messages USING btree (created_at DESC);


--
-- Name: idx_wa_direccion; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_direccion ON public.whatsapp_messages USING btree (direccion);


--
-- Name: idx_wa_owner_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_owner_id ON public.whatsapp_messages USING btree (owner_id);


--
-- Name: idx_wa_programado_para; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_programado_para ON public.whatsapp_messages USING btree (programado_para);


--
-- Name: idx_wa_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_wa_status ON public.whatsapp_messages USING btree (status);


--
-- Name: knowledge_chunks_embedding_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_embedding_idx ON public.knowledge_chunks USING ivfflat (embedding public.vector_cosine_ops) WITH (lists='100');


--
-- Name: knowledge_chunks_fts_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_fts_idx ON public.knowledge_chunks USING gin (to_tsvector('spanish'::regconfig, COALESCE(contenido, ''::text)));


--
-- Name: knowledge_chunks_origen_ref_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX knowledge_chunks_origen_ref_idx ON public.knowledge_chunks USING btree (origen, referencia_id);


--
-- Name: next_actions_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX next_actions_dedupe_idx ON public.next_actions USING btree (scope_type, scope_id, origen);


--
-- Name: next_actions_owner_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX next_actions_owner_estado_idx ON public.next_actions USING btree (owner_id, estado);


--
-- Name: next_actions_scope_estado_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX next_actions_scope_estado_idx ON public.next_actions USING btree (scope_id, estado);


--
-- Name: next_actions_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX next_actions_scope_idx ON public.next_actions USING btree (scope_type, scope_id);


--
-- Name: owners_buyer_persona_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX owners_buyer_persona_idx ON public.owners USING btree (buyer_persona);


--
-- Name: parcel_geometry_cache_expires_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parcel_geometry_cache_expires_idx ON public.parcel_geometry_cache USING btree (expires_at);


--
-- Name: parcel_geometry_cache_refcat_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX parcel_geometry_cache_refcat_idx ON public.parcel_geometry_cache USING btree (refcatastral_14);


--
-- Name: patio_window_counts_building_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patio_window_counts_building_idx ON public.patio_window_counts USING btree (building_id, created_at DESC);


--
-- Name: patio_window_counts_refcatastral_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patio_window_counts_refcatastral_idx ON public.patio_window_counts USING btree (refcatastral_14);


--
-- Name: pending_conv_emails_conv_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX pending_conv_emails_conv_kind_idx ON public.pending_conversation_emails USING btree (conversation_id, kind);


--
-- Name: pending_conv_emails_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pending_conv_emails_due_idx ON public.pending_conversation_emails USING btree (status, send_at);


--
-- Name: uq_enrichment_jobs_building_name_nota; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_enrichment_jobs_building_name_nota ON public.enrichment_jobs USING btree (building_id, lower(titular_nombre), nota_simple_id) WHERE ((building_id IS NOT NULL) AND (estado <> 'descartado'::text));


--
-- Name: uq_enrichment_jobs_building_nif; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_enrichment_jobs_building_nif ON public.enrichment_jobs USING btree (building_id, titular_nif) WHERE ((building_id IS NOT NULL) AND (titular_nif IS NOT NULL) AND (estado <> 'descartado'::text));


--
-- Name: uq_enrichment_verifications_job_final; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_enrichment_verifications_job_final ON public.enrichment_verifications USING btree (job_id) WHERE (decision = ANY (ARRAY['aprobada'::text, 'rechazada'::text]));


--
-- Name: uq_recq_titular; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_recq_titular ON public.reconciliation_queue USING btree (titular_id);


--
-- Name: wa_ai_jobs_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wa_ai_jobs_pending_idx ON public.wa_ai_jobs USING btree (status, run_after);


--
-- Name: wa_campaign_targets_camp_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wa_campaign_targets_camp_idx ON public.wa_campaign_targets USING btree (campaign_id);


--
-- Name: wa_conversations_contact_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wa_conversations_contact_idx ON public.wa_conversations USING btree (contact_id);


--
-- Name: wa_messages_conv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX wa_messages_conv_idx ON public.wa_messages USING btree (conversation_id, created_at DESC);


--
-- Name: whatsapp_messages_hs_id_uniq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX whatsapp_messages_hs_id_uniq ON public.whatsapp_messages USING btree (hs_id) WHERE (hs_id IS NOT NULL);


--
-- Name: whatsapp_messages_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX whatsapp_messages_owner_idx ON public.whatsapp_messages USING btree (owner_id);


--
-- Name: users on_auth_user_created; Type: TRIGGER; Schema: auth; Owner: -
--

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


--
-- Name: building_analysis analysis_recompute_score; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER analysis_recompute_score AFTER INSERT OR UPDATE ON public.building_analysis FOR EACH ROW EXECUTE FUNCTION public.trg_recompute_score();


--
-- Name: building_analysis analysis_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER analysis_set_updated BEFORE UPDATE ON public.building_analysis FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: building_feedback building_feedback_to_qa_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER building_feedback_to_qa_trg AFTER UPDATE ON public.building_feedback FOR EACH ROW EXECUTE FUNCTION public.building_feedback_to_qa();


--
-- Name: building_feedback building_feedback_touch_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER building_feedback_touch_trg BEFORE UPDATE ON public.building_feedback FOR EACH ROW EXECUTE FUNCTION public.building_feedback_touch();


--
-- Name: building_tasks building_tasks_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER building_tasks_set_updated_at BEFORE UPDATE ON public.building_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: buildings buildings_iee_maintain; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER buildings_iee_maintain BEFORE INSERT OR UPDATE OF iee_estado, iee_fecha_inspeccion ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.tg_iee_maintain();


--
-- Name: catastro_data catastro_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER catastro_set_updated BEFORE UPDATE ON public.catastro_data FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: building_processing_status procstatus_set_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER procstatus_set_updated BEFORE UPDATE ON public.building_processing_status FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: profiles profiles_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER profiles_set_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hubspot_emails set_hubspot_emails_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_hubspot_emails_updated_at BEFORE UPDATE ON public.hubspot_emails FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hubspot_meetings set_hubspot_meetings_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_hubspot_meetings_updated_at BEFORE UPDATE ON public.hubspot_meetings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hubspot_communications set_updated_at_hubspot_communications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_hubspot_communications BEFORE UPDATE ON public.hubspot_communications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hubspot_whatsapp set_updated_at_hubspot_whatsapp; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_updated_at_hubspot_whatsapp BEFORE UPDATE ON public.hubspot_whatsapp FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: assets trg_assets_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: building_companies trg_bc_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bc_updated_at BEFORE UPDATE ON public.building_companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: building_property_rights trg_bpr_audit_d; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bpr_audit_d BEFORE DELETE ON public.building_property_rights FOR EACH ROW EXECUTE FUNCTION public.trg_bpr_audit();


--
-- Name: building_property_rights trg_bpr_audit_iu; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_bpr_audit_iu BEFORE INSERT OR UPDATE ON public.building_property_rights FOR EACH ROW EXECUTE FUNCTION public.trg_bpr_audit();


--
-- Name: building_owners trg_building_owners_set_name_norm; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_building_owners_set_name_norm BEFORE INSERT OR UPDATE OF owner_id ON public.building_owners FOR EACH ROW EXECUTE FUNCTION public.trg_building_owners_set_name_norm();


--
-- Name: buildings trg_buildings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_buildings_updated BEFORE UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: call_sessions trg_call_session_score; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_call_session_score AFTER UPDATE OF voss_post, puntuacion ON public.call_sessions FOR EACH ROW WHEN (((old.voss_post IS DISTINCT FROM new.voss_post) OR (old.puntuacion IS DISTINCT FROM new.puntuacion))) EXECUTE FUNCTION public.tg_call_session_recompute_score();


--
-- Name: call_sessions trg_call_sessions_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_call_sessions_updated_at BEFORE UPDATE ON public.call_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: catastro_authority_cache trg_catastro_authority_cache_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_catastro_authority_cache_updated_at BEFORE UPDATE ON public.catastro_authority_cache FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: deals_gemelos trg_deals_gemelos_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_deals_gemelos_updated_at BEFORE UPDATE ON public.deals_gemelos FOR EACH ROW EXECUTE FUNCTION public.touch_deals_gemelos_updated_at();


--
-- Name: enrichment_config trg_enrichment_config_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enrichment_config_updated_at BEFORE UPDATE ON public.enrichment_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: enrichment_jobs trg_enrichment_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enrichment_jobs_updated_at BEFORE UPDATE ON public.enrichment_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: enrichment_verifications trg_enrichment_verifications_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enrichment_verifications_updated_at BEFORE UPDATE ON public.enrichment_verifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: external_ids trg_external_ids_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_external_ids_updated BEFORE UPDATE ON public.external_ids FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: hubspot_deals trg_hubspot_deals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hubspot_deals_updated_at BEFORE UPDATE ON public.hubspot_deals FOR EACH ROW EXECUTE FUNCTION public.touch_hubspot_deals_updated_at();


--
-- Name: hubspot_sync_state trg_hubspot_sync_state_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_hubspot_sync_state_updated BEFORE UPDATE ON public.hubspot_sync_state FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: investors trg_investors_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_investors_updated BEFORE UPDATE ON public.investors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: nota_simple_titulares trg_nst_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_nst_updated_at BEFORE UPDATE ON public.nota_simple_titulares FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: owner_companies trg_oc_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_oc_updated_at BEFORE UPDATE ON public.owner_companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: owner_relations trg_or_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_or_updated_at BEFORE UPDATE ON public.owner_relations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: owners trg_owners_maintain_display; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_owners_maintain_display BEFORE INSERT OR UPDATE OF nombre, fecha_nacimiento, estado_vital ON public.owners FOR EACH ROW EXECUTE FUNCTION public.owners_maintain_display_and_estado();


--
-- Name: owners trg_owners_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_owners_updated BEFORE UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: owner_call_prep_cache trg_prep_cache_score; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_prep_cache_score AFTER INSERT OR UPDATE OF kpis_json ON public.owner_call_prep_cache FOR EACH ROW EXECUTE FUNCTION public.tg_prep_cache_recompute_score();


--
-- Name: qa_ground_truth trg_qa_gt_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_qa_gt_updated BEFORE UPDATE ON public.qa_ground_truth FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: building_sanitation_reviews trg_sanitation_audit; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sanitation_audit BEFORE INSERT OR UPDATE ON public.building_sanitation_reviews FOR EACH ROW EXECUTE FUNCTION public.trg_sanitation_audit();


--
-- Name: org_settings trg_settings_updated; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.org_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: owner_call_prep_cache trg_touch_owner_call_prep_cache; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_touch_owner_call_prep_cache BEFORE UPDATE ON public.owner_call_prep_cache FOR EACH ROW EXECUTE FUNCTION public._touch_owner_call_prep_cache();


--
-- Name: wa_messages trg_wa_pause_bot_on_human_outbound; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_wa_pause_bot_on_human_outbound AFTER INSERT ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION public.wa_pause_bot_on_human_outbound();


--
-- Name: wa_ai_jobs wa_ai_jobs_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_ai_jobs_set_updated_at BEFORE UPDATE ON public.wa_ai_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wa_bot_config wa_bot_config_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_bot_config_set_updated_at BEFORE UPDATE ON public.wa_bot_config FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wa_campaigns wa_campaigns_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_campaigns_set_updated_at BEFORE UPDATE ON public.wa_campaigns FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wa_contacts wa_contacts_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_contacts_set_updated_at BEFORE UPDATE ON public.wa_contacts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wa_conversations wa_conversations_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_conversations_set_updated_at BEFORE UPDATE ON public.wa_conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wa_instances wa_instances_set_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_instances_set_updated_at BEFORE UPDATE ON public.wa_instances FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: wa_messages wa_messages_touch_contact_origin_trg; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER wa_messages_touch_contact_origin_trg AFTER INSERT ON public.wa_messages FOR EACH ROW EXECUTE FUNCTION public.wa_messages_touch_contact_origin();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: _a1_dangling_review _a1_dangling_review_candidato_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public._a1_dangling_review
    ADD CONSTRAINT _a1_dangling_review_candidato_fkey FOREIGN KEY (candidato) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: assets assets_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: assets assets_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: building_analysis building_analysis_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_analysis
    ADD CONSTRAINT building_analysis_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_companies building_companies_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_companies
    ADD CONSTRAINT building_companies_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_companies building_companies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_companies
    ADD CONSTRAINT building_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: building_feedback building_feedback_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_feedback
    ADD CONSTRAINT building_feedback_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_hs_deal_link_audit building_hs_deal_link_audit_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_hs_deal_link_audit
    ADD CONSTRAINT building_hs_deal_link_audit_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_imagery building_imagery_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_imagery
    ADD CONSTRAINT building_imagery_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_owners building_owners_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_owners
    ADD CONSTRAINT building_owners_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_owners building_owners_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_owners
    ADD CONSTRAINT building_owners_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: building_processing_status building_processing_status_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_processing_status
    ADD CONSTRAINT building_processing_status_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_property_rights building_property_rights_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights
    ADD CONSTRAINT building_property_rights_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_property_rights building_property_rights_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights
    ADD CONSTRAINT building_property_rights_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: building_property_rights building_property_rights_note_simple_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights
    ADD CONSTRAINT building_property_rights_note_simple_id_fkey FOREIGN KEY (note_simple_id) REFERENCES public.notas_simples(id) ON DELETE SET NULL;


--
-- Name: building_property_rights building_property_rights_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights
    ADD CONSTRAINT building_property_rights_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: building_property_rights building_property_rights_titular_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_property_rights
    ADD CONSTRAINT building_property_rights_titular_id_fkey FOREIGN KEY (titular_id) REFERENCES public.nota_simple_titulares(id) ON DELETE SET NULL;


--
-- Name: building_sanitation_reviews building_sanitation_reviews_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_sanitation_reviews
    ADD CONSTRAINT building_sanitation_reviews_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_tasks building_tasks_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_tasks
    ADD CONSTRAINT building_tasks_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: building_tasks building_tasks_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.building_tasks
    ADD CONSTRAINT building_tasks_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: cadence_steps cadence_steps_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cadence_steps
    ADD CONSTRAINT cadence_steps_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: call_sessions call_sessions_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: call_sessions call_sessions_call_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_call_id_fkey FOREIGN KEY (call_id) REFERENCES public.calls(id) ON DELETE SET NULL;


--
-- Name: call_sessions call_sessions_comercial_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_comercial_id_fkey FOREIGN KEY (comercial_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: call_sessions call_sessions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.call_sessions
    ADD CONSTRAINT call_sessions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: calls calls_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calls
    ADD CONSTRAINT calls_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: catastro_data catastro_data_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.catastro_data
    ADD CONSTRAINT catastro_data_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: deals_gemelos deals_gemelos_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deals_gemelos
    ADD CONSTRAINT deals_gemelos_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: enrichment_jobs enrichment_jobs_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT enrichment_jobs_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: enrichment_jobs enrichment_jobs_nota_simple_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT enrichment_jobs_nota_simple_id_fkey FOREIGN KEY (nota_simple_id) REFERENCES public.notas_simples(id) ON DELETE SET NULL;


--
-- Name: enrichment_verifications enrichment_verifications_aprobado_por_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_verifications
    ADD CONSTRAINT enrichment_verifications_aprobado_por_fkey FOREIGN KEY (aprobado_por) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: enrichment_verifications enrichment_verifications_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_verifications
    ADD CONSTRAINT enrichment_verifications_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.enrichment_jobs(id) ON DELETE CASCADE;


--
-- Name: escaleras_control_set escaleras_control_set_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_control_set
    ADD CONSTRAINT escaleras_control_set_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: escaleras_eval_results escaleras_eval_results_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_eval_results
    ADD CONSTRAINT escaleras_eval_results_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: escaleras_validation_queue escaleras_validation_queue_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escaleras_validation_queue
    ADD CONSTRAINT escaleras_validation_queue_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: esquina_validation_queue esquina_validation_queue_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.esquina_validation_queue
    ADD CONSTRAINT esquina_validation_queue_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: facade_window_counts facade_window_counts_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facade_window_counts
    ADD CONSTRAINT facade_window_counts_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: facade_window_ground_truth facade_window_ground_truth_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.facade_window_ground_truth
    ADD CONSTRAINT facade_window_ground_truth_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: hubspot_link_review hubspot_link_review_resolved_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.hubspot_link_review
    ADD CONSTRAINT hubspot_link_review_resolved_owner_id_fkey FOREIGN KEY (resolved_owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: knowledge_chunks knowledge_chunks_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_chunks
    ADD CONSTRAINT knowledge_chunks_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.knowledge_documents(id) ON DELETE CASCADE;


--
-- Name: knowledge_documents knowledge_documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_documents
    ADD CONSTRAINT knowledge_documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: match_candidates match_candidates_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_candidates
    ADD CONSTRAINT match_candidates_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE CASCADE;


--
-- Name: match_candidates match_candidates_investor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.match_candidates
    ADD CONSTRAINT match_candidates_investor_id_fkey FOREIGN KEY (investor_id) REFERENCES public.investors(id) ON DELETE CASCADE;


--
-- Name: next_actions next_actions_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: next_actions next_actions_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.next_actions
    ADD CONSTRAINT next_actions_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: nota_simple_titulares nota_simple_titulares_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_simple_titulares
    ADD CONSTRAINT nota_simple_titulares_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- Name: nota_simple_titulares nota_simple_titulares_nota_simple_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_simple_titulares
    ADD CONSTRAINT nota_simple_titulares_nota_simple_id_fkey FOREIGN KEY (nota_simple_id) REFERENCES public.notas_simples(id) ON DELETE CASCADE;


--
-- Name: nota_simple_titulares nota_simple_titulares_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nota_simple_titulares
    ADD CONSTRAINT nota_simple_titulares_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: notas_fuera_universo notas_fuera_universo_nota_simple_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_fuera_universo
    ADD CONSTRAINT notas_fuera_universo_nota_simple_id_fkey FOREIGN KEY (nota_simple_id) REFERENCES public.notas_simples(id) ON DELETE CASCADE;


--
-- Name: notas_simples notas_simples_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_simples
    ADD CONSTRAINT notas_simples_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: notas_simples notas_simples_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notas_simples
    ADD CONSTRAINT notas_simples_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: notes notes_asset_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE SET NULL;


--
-- Name: notes notes_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owner_call_building_assignment owner_call_building_assignment_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_call_building_assignment
    ADD CONSTRAINT owner_call_building_assignment_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: owner_call_building_assignment owner_call_building_assignment_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_call_building_assignment
    ADD CONSTRAINT owner_call_building_assignment_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owner_call_prep_cache owner_call_prep_cache_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_call_prep_cache
    ADD CONSTRAINT owner_call_prep_cache_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owner_companies owner_companies_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_companies
    ADD CONSTRAINT owner_companies_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- Name: owner_companies owner_companies_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_companies
    ADD CONSTRAINT owner_companies_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owner_merge_audit owner_merge_audit_canonical_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_merge_audit
    ADD CONSTRAINT owner_merge_audit_canonical_owner_id_fkey FOREIGN KEY (canonical_owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owner_relations owner_relations_owner_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_relations
    ADD CONSTRAINT owner_relations_owner_a_id_fkey FOREIGN KEY (owner_a_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owner_relations owner_relations_owner_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owner_relations
    ADD CONSTRAINT owner_relations_owner_b_id_fkey FOREIGN KEY (owner_b_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: owners owners_merged_into_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.owners
    ADD CONSTRAINT owners_merged_into_fkey FOREIGN KEY (merged_into) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: patio_window_counts patio_window_counts_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patio_window_counts
    ADD CONSTRAINT patio_window_counts_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: proteccion_validation_queue proteccion_validation_queue_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proteccion_validation_queue
    ADD CONSTRAINT proteccion_validation_queue_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: qa_ground_truth qa_ground_truth_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.qa_ground_truth
    ADD CONSTRAINT qa_ground_truth_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: reconciliation_queue reconciliation_queue_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_queue
    ADD CONSTRAINT reconciliation_queue_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: scoring_v2_feedback scoring_v2_feedback_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_v2_feedback
    ADD CONSTRAINT scoring_v2_feedback_building_id_fkey FOREIGN KEY (building_id) REFERENCES public.buildings(id) ON DELETE CASCADE;


--
-- Name: scoring_v2_seed scoring_v2_seed_matched_building_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scoring_v2_seed
    ADD CONSTRAINT scoring_v2_seed_matched_building_id_fkey FOREIGN KEY (matched_building_id) REFERENCES public.buildings(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: wa_ai_jobs wa_ai_jobs_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_ai_jobs
    ADD CONSTRAINT wa_ai_jobs_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.wa_conversations(id) ON DELETE CASCADE;


--
-- Name: wa_campaign_targets wa_campaign_targets_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_campaign_targets
    ADD CONSTRAINT wa_campaign_targets_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.wa_campaigns(id) ON DELETE CASCADE;


--
-- Name: wa_campaign_targets wa_campaign_targets_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_campaign_targets
    ADD CONSTRAINT wa_campaign_targets_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.wa_contacts(id) ON DELETE SET NULL;


--
-- Name: wa_contacts wa_contacts_last_human_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_contacts
    ADD CONSTRAINT wa_contacts_last_human_agent_id_fkey FOREIGN KEY (last_human_agent_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: wa_contacts wa_contacts_lead_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_contacts
    ADD CONSTRAINT wa_contacts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.owners(id) ON DELETE SET NULL;


--
-- Name: wa_conversations wa_conversations_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_conversations
    ADD CONSTRAINT wa_conversations_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.wa_contacts(id) ON DELETE CASCADE;


--
-- Name: wa_messages wa_messages_agent_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_messages
    ADD CONSTRAINT wa_messages_agent_user_id_fkey FOREIGN KEY (agent_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;


--
-- Name: wa_messages wa_messages_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_messages
    ADD CONSTRAINT wa_messages_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.wa_campaigns(id) ON DELETE SET NULL;


--
-- Name: wa_messages wa_messages_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_messages
    ADD CONSTRAINT wa_messages_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.wa_contacts(id) ON DELETE CASCADE;


--
-- Name: wa_messages wa_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.wa_messages
    ADD CONSTRAINT wa_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.wa_conversations(id) ON DELETE CASCADE;


--
-- Name: whatsapp_messages whatsapp_messages_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.whatsapp_messages
    ADD CONSTRAINT whatsapp_messages_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.owners(id) ON DELETE CASCADE;


--
-- Name: guard_proposals Admins gestionan propuestas de guardas; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Admins gestionan propuestas de guardas" ON public.guard_proposals TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR ((auth.jwt() ->> 'email'::text) = 'jesus.anzola@afflux.es'::text))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR ((auth.jwt() ->> 'email'::text) = 'jesus.anzola@afflux.es'::text)));


--
-- Name: notas_fuera_universo Auth read notas_fuera_universo; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Auth read notas_fuera_universo" ON public.notas_fuera_universo FOR SELECT TO authenticated USING (true);


--
-- Name: facade_window_ground_truth Authenticated can insert ground truth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can insert ground truth" ON public.facade_window_ground_truth FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: facade_window_ground_truth Authenticated can update ground truth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can update ground truth" ON public.facade_window_ground_truth FOR UPDATE TO authenticated USING (true);


--
-- Name: facade_window_counts Authenticated can view facade window counts; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can view facade window counts" ON public.facade_window_counts FOR SELECT TO authenticated USING (true);


--
-- Name: facade_window_ground_truth Authenticated can view ground truth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Authenticated can view ground truth" ON public.facade_window_ground_truth FOR SELECT TO authenticated USING (true);


--
-- Name: _a1_dangling_review; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public._a1_dangling_review ENABLE ROW LEVEL SECURITY;

--
-- Name: _a1_dangling_review _a1_dangling_review_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY _a1_dangling_review_admin_read ON public._a1_dangling_review FOR SELECT USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: _a1_dangling_review _a1_dangling_review_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY _a1_dangling_review_service_all ON public._a1_dangling_review TO service_role USING (true) WITH CHECK (true);


--
-- Name: enrichment_jobs admin_delete_enrichment_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_delete_enrichment_jobs ON public.enrichment_jobs FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: enrichment_config admin_write_enrichment_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admin_write_enrichment_config ON public.enrichment_config TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: escaleras_validation_queue admins manage escaleras queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage escaleras queue" ON public.escaleras_validation_queue TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: esquina_validation_queue admins manage esquina queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "admins manage esquina queue" ON public.esquina_validation_queue TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: knowledge_documents admins_manage_kdocs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY admins_manage_kdocs ON public.knowledge_documents TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: building_analysis analysis_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analysis_select_auth ON public.building_analysis FOR SELECT TO authenticated USING (true);


--
-- Name: app_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: assets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

--
-- Name: building_assignments assignments_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_admin_all ON public.building_assignments TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: building_assignments assignments_user_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY assignments_user_select_own ON public.building_assignments FOR SELECT TO authenticated USING ((user_id = auth.uid()));


--
-- Name: proteccion_validation_queue auth can read proteccion queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth can read proteccion queue" ON public.proteccion_validation_queue FOR SELECT TO authenticated USING (true);


--
-- Name: proteccion_validation_queue auth can update proteccion queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth can update proteccion queue" ON public.proteccion_validation_queue FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: owner_call_prep_cache auth delete prep cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth delete prep cache" ON public.owner_call_prep_cache FOR DELETE TO authenticated USING (true);


--
-- Name: building_feedback auth insert feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth insert feedback" ON public.building_feedback FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: escaleras_control_set auth read control set; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read control set" ON public.escaleras_control_set FOR SELECT TO authenticated USING (true);


--
-- Name: escaleras_eval_results auth read eval results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read eval results" ON public.escaleras_eval_results FOR SELECT TO authenticated USING (true);


--
-- Name: building_feedback auth read feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read feedback" ON public.building_feedback FOR SELECT TO authenticated USING (true);


--
-- Name: owner_call_prep_cache auth read prep cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth read prep cache" ON public.owner_call_prep_cache FOR SELECT TO authenticated USING (true);


--
-- Name: building_feedback auth update feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth update feedback" ON public.building_feedback FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: owner_call_prep_cache auth update prep cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth update prep cache" ON public.owner_call_prep_cache FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: owner_call_prep_cache auth write prep cache; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "auth write prep cache" ON public.owner_call_prep_cache FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: app_settings auth_manage_app_settings; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_app_settings ON public.app_settings TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: building_analysis auth_manage_building_analysis; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_building_analysis ON public.building_analysis TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: building_imagery auth_manage_building_imagery; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_building_imagery ON public.building_imagery TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: building_processing_status auth_manage_building_processing_status; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_building_processing_status ON public.building_processing_status TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: catastro_data auth_manage_catastro_data; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_catastro_data ON public.catastro_data TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: scoring_v2_feedback auth_manage_scoring_v2_feedback; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_scoring_v2_feedback ON public.scoring_v2_feedback TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: scoring_v2_jobs auth_manage_scoring_v2_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_scoring_v2_jobs ON public.scoring_v2_jobs TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: scoring_v2_seed auth_manage_scoring_v2_seed; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auth_manage_scoring_v2_seed ON public.scoring_v2_seed TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: parcel_geometry_cache authenticated read parcel geometry; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "authenticated read parcel geometry" ON public.parcel_geometry_cache FOR SELECT TO authenticated USING (true);


--
-- Name: enrichment_config authenticated_read_enrichment_config; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_enrichment_config ON public.enrichment_config FOR SELECT TO authenticated USING (true);


--
-- Name: enrichment_jobs authenticated_read_enrichment_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_enrichment_jobs ON public.enrichment_jobs FOR SELECT TO authenticated USING (true);


--
-- Name: enrichment_verifications authenticated_read_enrichment_verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_enrichment_verifications ON public.enrichment_verifications FOR SELECT TO authenticated USING (true);


--
-- Name: knowledge_documents authenticated_read_kdocs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_read_kdocs ON public.knowledge_documents FOR SELECT TO authenticated USING (true);


--
-- Name: enrichment_jobs authenticated_update_enrichment_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update_enrichment_jobs ON public.enrichment_jobs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: enrichment_verifications authenticated_update_enrichment_verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_update_enrichment_verifications ON public.enrichment_verifications FOR UPDATE TO authenticated USING (true) WITH CHECK (true);


--
-- Name: enrichment_jobs authenticated_write_enrichment_jobs; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_write_enrichment_jobs ON public.enrichment_jobs FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: enrichment_verifications authenticated_write_enrichment_verifications; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authenticated_write_enrichment_verifications ON public.enrichment_verifications FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: catastro_authority_cache authority_cache_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authority_cache_select_auth ON public.catastro_authority_cache FOR SELECT TO authenticated USING (true);


--
-- Name: catastro_authority_cache authority_cache_write_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY authority_cache_write_auth ON public.catastro_authority_cache TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: building_property_rights bpr_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bpr_admin_write ON public.building_property_rights TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));


--
-- Name: building_property_rights_history bpr_hist_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bpr_hist_read ON public.building_property_rights_history FOR SELECT TO authenticated USING (true);


--
-- Name: building_property_rights_history bpr_hist_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bpr_hist_write ON public.building_property_rights_history TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));


--
-- Name: building_property_rights bpr_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bpr_read ON public.building_property_rights FOR SELECT TO authenticated USING (true);


--
-- Name: building_property_rights_archive bpra_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY bpra_read ON public.building_property_rights_archive FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: building_analysis; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_analysis ENABLE ROW LEVEL SECURITY;

--
-- Name: building_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: building_companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_companies ENABLE ROW LEVEL SECURITY;

--
-- Name: building_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: building_hs_deal_link_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_hs_deal_link_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: building_imagery; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_imagery ENABLE ROW LEVEL SECURITY;

--
-- Name: building_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_owners ENABLE ROW LEVEL SECURITY;

--
-- Name: building_processing_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_processing_status ENABLE ROW LEVEL SECURITY;

--
-- Name: building_property_rights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_property_rights ENABLE ROW LEVEL SECURITY;

--
-- Name: building_property_rights_archive; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_property_rights_archive ENABLE ROW LEVEL SECURITY;

--
-- Name: building_property_rights_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_property_rights_history ENABLE ROW LEVEL SECURITY;

--
-- Name: building_sanitation_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_sanitation_history ENABLE ROW LEVEL SECURITY;

--
-- Name: building_sanitation_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_sanitation_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: building_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.building_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: buildings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;

--
-- Name: cadence_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cadence_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: call_playbook; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_playbook ENABLE ROW LEVEL SECURITY;

--
-- Name: call_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.call_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: madrid_calles_comerciales calles_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calles_admin_write ON public.madrid_calles_comerciales TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: madrid_calles_comerciales calles_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calles_select_auth ON public.madrid_calles_comerciales FOR SELECT TO authenticated USING (true);


--
-- Name: madrid_calles_subzona calles_subzona_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY calles_subzona_read ON public.madrid_calles_subzona FOR SELECT TO anon, authenticated USING (true);


--
-- Name: calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;

--
-- Name: catastro_authority_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.catastro_authority_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: catastro_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.catastro_data ENABLE ROW LEVEL SECURITY;

--
-- Name: catastro_data catastro_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY catastro_select_auth ON public.catastro_data FOR SELECT TO authenticated USING (true);


--
-- Name: madrid_barrio_clusters clusters_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clusters_admin_write ON public.madrid_barrio_clusters TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: madrid_barrio_clusters clusters_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY clusters_select_auth ON public.madrid_barrio_clusters FOR SELECT TO authenticated USING (true);


--
-- Name: coach_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coach_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_cases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_cases ENABLE ROW LEVEL SECURITY;

--
-- Name: deals_gemelos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deals_gemelos ENABLE ROW LEVEL SECURITY;

--
-- Name: deals_gemelos deals_gemelos_read_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_gemelos_read_auth ON public.deals_gemelos FOR SELECT TO authenticated USING (true);


--
-- Name: deals_gemelos deals_gemelos_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deals_gemelos_service_write ON public.deals_gemelos TO service_role USING (true) WITH CHECK (true);


--
-- Name: enrichment_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_config ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: escaleras_control_set; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escaleras_control_set ENABLE ROW LEVEL SECURITY;

--
-- Name: escaleras_eval_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escaleras_eval_results ENABLE ROW LEVEL SECURITY;

--
-- Name: escaleras_validation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escaleras_validation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: esquina_validation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.esquina_validation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: external_ids; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.external_ids ENABLE ROW LEVEL SECURITY;

--
-- Name: external_ids external_ids_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY external_ids_select_all ON public.external_ids FOR SELECT USING (true);


--
-- Name: external_ids external_ids_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY external_ids_service_write ON public.external_ids TO service_role USING (true) WITH CHECK (true);


--
-- Name: facade_window_counts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facade_window_counts ENABLE ROW LEVEL SECURITY;

--
-- Name: facade_window_ground_truth; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.facade_window_ground_truth ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_v2_feedback feedback_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_admin_all ON public.scoring_v2_feedback TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: scoring_v2_feedback feedback_insert_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_insert_auth ON public.scoring_v2_feedback FOR INSERT TO authenticated WITH CHECK (((user_id = auth.uid()) OR (user_id IS NULL)));


--
-- Name: scoring_v2_feedback feedback_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_select_auth ON public.scoring_v2_feedback FOR SELECT TO authenticated USING (true);


--
-- Name: scoring_v2_feedback feedback_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY feedback_select_own_or_admin ON public.scoring_v2_feedback FOR SELECT TO authenticated USING (((user_id = auth.uid()) OR (user_id IS NULL) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: guard_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.guard_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: building_hs_deal_link_audit hs_link_audit_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hs_link_audit_admin_write ON public.building_hs_deal_link_audit TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: building_hs_deal_link_audit hs_link_audit_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hs_link_audit_read ON public.building_hs_deal_link_audit FOR SELECT TO authenticated USING (true);


--
-- Name: hubspot_calls; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_calls ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_calls hubspot_calls_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_calls_select_all ON public.hubspot_calls FOR SELECT USING (true);


--
-- Name: hubspot_calls hubspot_calls_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_calls_service_write ON public.hubspot_calls TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_changes_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_changes_log ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_changes_log hubspot_changes_log_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_changes_log_select_all ON public.hubspot_changes_log FOR SELECT USING (true);


--
-- Name: hubspot_changes_log hubspot_changes_log_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_changes_log_service_write ON public.hubspot_changes_log TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_communications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_communications ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_communications hubspot_communications_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_communications_select_all ON public.hubspot_communications FOR SELECT USING (true);


--
-- Name: hubspot_communications hubspot_communications_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_communications_service_write ON public.hubspot_communications TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_deals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_deals ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_deals hubspot_deals_read_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_deals_read_auth ON public.hubspot_deals FOR SELECT TO authenticated USING (true);


--
-- Name: hubspot_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_emails hubspot_emails_read_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_emails_read_auth ON public.hubspot_emails FOR SELECT TO authenticated USING (true);


--
-- Name: hubspot_emails hubspot_emails_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_emails_service_all ON public.hubspot_emails TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_link_review; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_link_review ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_list_memberships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_list_memberships ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_list_memberships hubspot_list_memberships_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_list_memberships_select_all ON public.hubspot_list_memberships FOR SELECT USING (true);


--
-- Name: hubspot_list_memberships hubspot_list_memberships_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_list_memberships_service_write ON public.hubspot_list_memberships TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_lists hubspot_lists_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_lists_select_all ON public.hubspot_lists FOR SELECT USING (true);


--
-- Name: hubspot_lists hubspot_lists_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_lists_service_write ON public.hubspot_lists TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_meetings hubspot_meetings_read_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_meetings_read_auth ON public.hubspot_meetings FOR SELECT TO authenticated USING (true);


--
-- Name: hubspot_meetings hubspot_meetings_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_meetings_service_all ON public.hubspot_meetings TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_notes hubspot_notes_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_notes_select_all ON public.hubspot_notes FOR SELECT USING (true);


--
-- Name: hubspot_notes hubspot_notes_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_notes_service_write ON public.hubspot_notes TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_owners ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_owners hubspot_owners_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_owners_select_all ON public.hubspot_owners FOR SELECT USING (true);


--
-- Name: hubspot_owners hubspot_owners_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_owners_service_write ON public.hubspot_owners TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_snapshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_snapshots ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_snapshots hubspot_snapshots_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_snapshots_select_all ON public.hubspot_snapshots FOR SELECT USING (true);


--
-- Name: hubspot_snapshots hubspot_snapshots_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_snapshots_service_write ON public.hubspot_snapshots TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_sync_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_sync_log ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_sync_log hubspot_sync_log_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_sync_log_select_all ON public.hubspot_sync_log FOR SELECT USING (true);


--
-- Name: hubspot_sync_log hubspot_sync_log_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_sync_log_service_write ON public.hubspot_sync_log TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_sync_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_sync_state ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_sync_state hubspot_sync_state_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_sync_state_select_all ON public.hubspot_sync_state FOR SELECT USING (true);


--
-- Name: hubspot_sync_state hubspot_sync_state_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_sync_state_service_write ON public.hubspot_sync_state TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_tasks hubspot_tasks_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_tasks_select_all ON public.hubspot_tasks FOR SELECT USING (true);


--
-- Name: hubspot_tasks hubspot_tasks_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_tasks_service_write ON public.hubspot_tasks TO service_role USING (true) WITH CHECK (true);


--
-- Name: hubspot_whatsapp; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.hubspot_whatsapp ENABLE ROW LEVEL SECURITY;

--
-- Name: hubspot_whatsapp hubspot_whatsapp_select_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_whatsapp_select_all ON public.hubspot_whatsapp FOR SELECT USING (true);


--
-- Name: hubspot_whatsapp hubspot_whatsapp_service_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY hubspot_whatsapp_service_write ON public.hubspot_whatsapp TO service_role USING (true) WITH CHECK (true);


--
-- Name: building_imagery imagery_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY imagery_select_auth ON public.building_imagery FOR SELECT TO authenticated USING (true);


--
-- Name: investors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_v2_jobs jobs_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY jobs_select_auth ON public.scoring_v2_jobs FOR SELECT TO authenticated USING (true);


--
-- Name: knowledge_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: madrid_barrio_clusters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.madrid_barrio_clusters ENABLE ROW LEVEL SECURITY;

--
-- Name: madrid_calles_comerciales; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.madrid_calles_comerciales ENABLE ROW LEVEL SECURITY;

--
-- Name: madrid_calles_subzona; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.madrid_calles_subzona ENABLE ROW LEVEL SECURITY;

--
-- Name: madrid_edificios_protegidos; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.madrid_edificios_protegidos ENABLE ROW LEVEL SECURITY;

--
-- Name: match_candidates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.match_candidates ENABLE ROW LEVEL SECURITY;

--
-- Name: next_actions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.next_actions ENABLE ROW LEVEL SECURITY;

--
-- Name: nota_simple_titulares; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nota_simple_titulares ENABLE ROW LEVEL SECURITY;

--
-- Name: notas_fuera_universo; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas_fuera_universo ENABLE ROW LEVEL SECURITY;

--
-- Name: notas_simples; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notas_simples ENABLE ROW LEVEL SECURITY;

--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_call_building_assignment ocba_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ocba_read ON public.owner_call_building_assignment FOR SELECT TO authenticated USING (true);


--
-- Name: owner_call_building_assignment ocba_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ocba_write ON public.owner_call_building_assignment TO authenticated USING (true) WITH CHECK (true);


--
-- Name: org_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_call_building_assignment; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_call_building_assignment ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_call_prep_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_call_prep_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_companies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_companies ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_merge_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_merge_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: owner_merge_audit owner_merge_audit_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY owner_merge_audit_admin_read ON public.owner_merge_audit FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: owner_relations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owner_relations ENABLE ROW LEVEL SECURITY;

--
-- Name: owners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;

--
-- Name: parcel_geometry_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.parcel_geometry_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: patio_window_counts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.patio_window_counts ENABLE ROW LEVEL SECURITY;

--
-- Name: patio_window_counts patio_window_counts_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patio_window_counts_select_authenticated ON public.patio_window_counts FOR SELECT TO authenticated USING (true);


--
-- Name: patio_window_counts patio_window_counts_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY patio_window_counts_service_all ON public.patio_window_counts TO service_role USING (true) WITH CHECK (true);


--
-- Name: pending_conversation_emails; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pending_conversation_emails ENABLE ROW LEVEL SECURITY;

--
-- Name: call_playbook playbook_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY playbook_admin_write ON public.call_playbook TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: call_playbook playbook_read_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY playbook_read_all ON public.call_playbook FOR SELECT USING (true);


--
-- Name: agent_runs preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.agent_runs FOR DELETE USING (true);


--
-- Name: assets preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.assets FOR DELETE USING (true);


--
-- Name: building_companies preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.building_companies FOR DELETE USING (true);


--
-- Name: building_owners preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.building_owners FOR DELETE USING (true);


--
-- Name: buildings preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.buildings FOR DELETE USING (true);


--
-- Name: cadence_steps preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.cadence_steps FOR DELETE USING (true);


--
-- Name: calls preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.calls FOR DELETE USING (true);


--
-- Name: coach_reports preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.coach_reports FOR DELETE USING (true);


--
-- Name: companies preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.companies FOR DELETE USING (true);


--
-- Name: compliance_cases preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.compliance_cases FOR DELETE USING (true);


--
-- Name: investors preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.investors FOR DELETE USING (true);


--
-- Name: knowledge_chunks preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.knowledge_chunks FOR DELETE USING (true);


--
-- Name: match_candidates preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.match_candidates FOR DELETE USING (true);


--
-- Name: next_actions preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.next_actions FOR DELETE USING (true);


--
-- Name: nota_simple_titulares preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.nota_simple_titulares FOR DELETE USING (true);


--
-- Name: notas_simples preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.notas_simples FOR DELETE USING (true);


--
-- Name: notes preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.notes FOR DELETE USING (true);


--
-- Name: org_settings preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.org_settings FOR DELETE USING (true);


--
-- Name: owner_companies preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.owner_companies FOR DELETE USING (true);


--
-- Name: owner_relations preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.owner_relations FOR DELETE USING (true);


--
-- Name: owners preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.owners FOR DELETE USING (true);


--
-- Name: whatsapp_messages preview_all_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_delete ON public.whatsapp_messages FOR DELETE USING (true);


--
-- Name: agent_runs preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.agent_runs FOR INSERT WITH CHECK (true);


--
-- Name: assets preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.assets FOR INSERT WITH CHECK (true);


--
-- Name: building_companies preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.building_companies FOR INSERT WITH CHECK (true);


--
-- Name: building_owners preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.building_owners FOR INSERT WITH CHECK (true);


--
-- Name: buildings preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.buildings FOR INSERT WITH CHECK (true);


--
-- Name: cadence_steps preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.cadence_steps FOR INSERT WITH CHECK (true);


--
-- Name: calls preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.calls FOR INSERT WITH CHECK (true);


--
-- Name: coach_reports preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.coach_reports FOR INSERT WITH CHECK (true);


--
-- Name: companies preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.companies FOR INSERT WITH CHECK (true);


--
-- Name: compliance_cases preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.compliance_cases FOR INSERT WITH CHECK (true);


--
-- Name: investors preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.investors FOR INSERT WITH CHECK (true);


--
-- Name: knowledge_chunks preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.knowledge_chunks FOR INSERT WITH CHECK (true);


--
-- Name: match_candidates preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.match_candidates FOR INSERT WITH CHECK (true);


--
-- Name: next_actions preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.next_actions FOR INSERT WITH CHECK (true);


--
-- Name: nota_simple_titulares preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.nota_simple_titulares FOR INSERT WITH CHECK (true);


--
-- Name: notas_simples preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.notas_simples FOR INSERT WITH CHECK (true);


--
-- Name: notes preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.notes FOR INSERT WITH CHECK (true);


--
-- Name: org_settings preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.org_settings FOR INSERT WITH CHECK (true);


--
-- Name: owner_companies preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.owner_companies FOR INSERT WITH CHECK (true);


--
-- Name: owner_relations preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.owner_relations FOR INSERT WITH CHECK (true);


--
-- Name: owners preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.owners FOR INSERT WITH CHECK (true);


--
-- Name: whatsapp_messages preview_all_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_insert ON public.whatsapp_messages FOR INSERT WITH CHECK (true);


--
-- Name: agent_runs preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.agent_runs FOR SELECT USING (true);


--
-- Name: assets preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.assets FOR SELECT USING (true);


--
-- Name: building_companies preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.building_companies FOR SELECT USING (true);


--
-- Name: building_owners preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.building_owners FOR SELECT USING (true);


--
-- Name: buildings preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.buildings FOR SELECT USING (true);


--
-- Name: cadence_steps preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.cadence_steps FOR SELECT USING (true);


--
-- Name: calls preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.calls FOR SELECT USING (true);


--
-- Name: coach_reports preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.coach_reports FOR SELECT USING (true);


--
-- Name: companies preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.companies FOR SELECT USING (true);


--
-- Name: compliance_cases preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.compliance_cases FOR SELECT USING (true);


--
-- Name: investors preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.investors FOR SELECT USING (true);


--
-- Name: knowledge_chunks preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.knowledge_chunks FOR SELECT USING (true);


--
-- Name: match_candidates preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.match_candidates FOR SELECT USING (true);


--
-- Name: next_actions preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.next_actions FOR SELECT USING (true);


--
-- Name: nota_simple_titulares preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.nota_simple_titulares FOR SELECT USING (true);


--
-- Name: notas_simples preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.notas_simples FOR SELECT USING (true);


--
-- Name: notes preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.notes FOR SELECT USING (true);


--
-- Name: org_settings preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.org_settings FOR SELECT USING (true);


--
-- Name: owner_companies preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.owner_companies FOR SELECT USING (true);


--
-- Name: owner_relations preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.owner_relations FOR SELECT USING (true);


--
-- Name: owners preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.owners FOR SELECT USING (true);


--
-- Name: whatsapp_messages preview_all_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_select ON public.whatsapp_messages FOR SELECT USING (true);


--
-- Name: agent_runs preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.agent_runs FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: assets preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.assets FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: building_companies preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.building_companies FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: building_owners preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.building_owners FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: buildings preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.buildings FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: cadence_steps preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.cadence_steps FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: calls preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.calls FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: coach_reports preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.coach_reports FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: companies preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.companies FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: compliance_cases preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.compliance_cases FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: investors preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.investors FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: knowledge_chunks preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.knowledge_chunks FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: match_candidates preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.match_candidates FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: next_actions preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.next_actions FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: nota_simple_titulares preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.nota_simple_titulares FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: notas_simples preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.notas_simples FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: notes preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.notes FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: org_settings preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.org_settings FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: owner_companies preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.owner_companies FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: owner_relations preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.owner_relations FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: owners preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.owners FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: whatsapp_messages preview_all_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preview_all_update ON public.whatsapp_messages FOR UPDATE USING (true) WITH CHECK (true);


--
-- Name: building_processing_status procstatus_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY procstatus_select_auth ON public.building_processing_status FOR SELECT TO authenticated USING (true);


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_insert_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_insert_self ON public.profiles FOR INSERT TO authenticated WITH CHECK ((auth.uid() = id));


--
-- Name: profiles profiles_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_select_authenticated ON public.profiles FOR SELECT TO authenticated USING (true);


--
-- Name: profiles profiles_update_self; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated USING ((auth.uid() = id)) WITH CHECK ((auth.uid() = id));


--
-- Name: proteccion_validation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proteccion_validation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: madrid_edificios_protegidos protegidos_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY protegidos_read ON public.madrid_edificios_protegidos FOR SELECT TO anon, authenticated USING (true);


--
-- Name: qa_ground_truth; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.qa_ground_truth ENABLE ROW LEVEL SECURITY;

--
-- Name: qa_ground_truth qa_gt_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qa_gt_select_auth ON public.qa_ground_truth FOR SELECT TO authenticated USING (true);


--
-- Name: qa_ground_truth qa_gt_write_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY qa_gt_write_auth ON public.qa_ground_truth TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));


--
-- Name: hubspot_link_review read link review; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "read link review" ON public.hubspot_link_review FOR SELECT TO authenticated USING (true);


--
-- Name: reconciliation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconciliation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: reconciliation_queue recq_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recq_admin_write ON public.reconciliation_queue TO authenticated USING ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role))) WITH CHECK ((public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'manager'::public.app_role)));


--
-- Name: reconciliation_queue recq_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY recq_read ON public.reconciliation_queue FOR SELECT TO authenticated USING (true);


--
-- Name: building_sanitation_reviews sanitation_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sanitation_admin_write ON public.building_sanitation_reviews TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: building_sanitation_history sanitation_hist_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sanitation_hist_admin_write ON public.building_sanitation_history TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: building_sanitation_history sanitation_hist_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sanitation_hist_read ON public.building_sanitation_history FOR SELECT TO authenticated USING (true);


--
-- Name: building_sanitation_reviews sanitation_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sanitation_read ON public.building_sanitation_reviews FOR SELECT TO authenticated USING (true);


--
-- Name: scoring_v2_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scoring_v2_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_v2_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scoring_v2_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_v2_seed; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scoring_v2_seed ENABLE ROW LEVEL SECURITY;

--
-- Name: scoring_v2_seed seed_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY seed_select_auth ON public.scoring_v2_seed FOR SELECT TO authenticated USING (true);


--
-- Name: proteccion_validation_queue service can insert proteccion queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service can insert proteccion queue" ON public.proteccion_validation_queue FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: escaleras_validation_queue service role escaleras queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role escaleras queue" ON public.escaleras_validation_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: esquina_validation_queue service role esquina queue; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role esquina queue" ON public.esquina_validation_queue TO service_role USING (true) WITH CHECK (true);


--
-- Name: pending_conversation_emails service role manages pending emails; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service role manages pending emails" ON public.pending_conversation_emails TO service_role USING (true) WITH CHECK (true);


--
-- Name: escaleras_control_set service write control set; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service write control set" ON public.escaleras_control_set TO service_role USING (true) WITH CHECK (true);


--
-- Name: escaleras_eval_results service write eval results; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "service write eval results" ON public.escaleras_eval_results TO service_role USING (true) WITH CHECK (true);


--
-- Name: call_sessions sessions_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_delete_own ON public.call_sessions FOR DELETE TO authenticated USING (((comercial_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: call_sessions sessions_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_insert_own ON public.call_sessions FOR INSERT TO authenticated WITH CHECK ((comercial_id = auth.uid()));


--
-- Name: call_sessions sessions_select_own_or_admin; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_select_own_or_admin ON public.call_sessions FOR SELECT TO authenticated USING (((comercial_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: call_sessions sessions_select_retroactiva_public; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_select_retroactiva_public ON public.call_sessions FOR SELECT TO authenticated USING ((retroactiva = true));


--
-- Name: call_sessions sessions_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_update_own ON public.call_sessions FOR UPDATE TO authenticated USING (((comercial_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))) WITH CHECK (((comercial_id = auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: app_settings settings_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_admin_write ON public.app_settings TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: app_settings settings_select_auth; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY settings_select_auth ON public.app_settings FOR SELECT TO authenticated USING (true);


--
-- Name: building_tasks tasks_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_admin_all ON public.building_tasks TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: building_tasks tasks_delete_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_delete_own ON public.building_tasks FOR DELETE TO authenticated USING ((auth.uid() = user_id));


--
-- Name: building_tasks tasks_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_insert_own ON public.building_tasks FOR INSERT TO authenticated WITH CHECK ((auth.uid() = user_id));


--
-- Name: building_tasks tasks_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_select_own ON public.building_tasks FOR SELECT TO authenticated USING ((auth.uid() = user_id));


--
-- Name: building_tasks tasks_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY tasks_update_own ON public.building_tasks FOR UPDATE TO authenticated USING ((auth.uid() = user_id)) WITH CHECK ((auth.uid() = user_id));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles user_roles_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_admin_all ON public.user_roles TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));


--
-- Name: user_roles user_roles_select_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_select_authenticated ON public.user_roles FOR SELECT TO authenticated USING (true);


--
-- Name: wa_ai_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_ai_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_ai_jobs wa_ai_jobs all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_ai_jobs all access" ON public.wa_ai_jobs TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_bot_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_bot_config ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_bot_config wa_bot_config all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_bot_config all access" ON public.wa_bot_config TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_campaign_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_campaign_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_campaign_targets wa_campaign_targets all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_campaign_targets all access" ON public.wa_campaign_targets TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_campaigns wa_campaigns all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_campaigns all access" ON public.wa_campaigns TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_contacts wa_contacts all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_contacts all access" ON public.wa_contacts TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_contacts wa_contacts oportunidades read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_contacts oportunidades read" ON public.wa_contacts FOR SELECT TO authenticated USING (public.has_oportunidades_access(auth.uid()));


--
-- Name: wa_conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_conversations wa_conversations all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_conversations all access" ON public.wa_conversations TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_conversations wa_conversations oportunidades read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_conversations oportunidades read" ON public.wa_conversations FOR SELECT TO authenticated USING (public.has_oportunidades_access(auth.uid()));


--
-- Name: wa_conversations wa_conversations oportunidades update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_conversations oportunidades update" ON public.wa_conversations FOR UPDATE TO authenticated USING (public.has_oportunidades_access(auth.uid())) WITH CHECK (public.has_oportunidades_access(auth.uid()));


--
-- Name: wa_instances; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_instances ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_instances wa_instances all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_instances all access" ON public.wa_instances TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.wa_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: wa_messages wa_messages all access; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_messages all access" ON public.wa_messages TO authenticated USING (public.has_whatsapp_access(auth.uid())) WITH CHECK (public.has_whatsapp_access(auth.uid()));


--
-- Name: wa_messages wa_messages oportunidades read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "wa_messages oportunidades read" ON public.wa_messages FOR SELECT TO authenticated USING (public.has_oportunidades_access(auth.uid()));


--
-- Name: whatsapp_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: objects Authenticated can read street view captures; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "Authenticated can read street view captures" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'street-view-captures'::text));


--
-- Name: objects admins_delete_knowledge_bucket; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY admins_delete_knowledge_bucket ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'knowledge'::text) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: objects admins_read_knowledge_bucket; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY admins_read_knowledge_bucket ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'knowledge'::text) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: objects admins_write_knowledge_bucket; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY admins_write_knowledge_bucket ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'knowledge'::text) AND public.has_role(auth.uid(), 'admin'::public.app_role)));


--
-- Name: objects authenticated_read_enrichment_evidence; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY authenticated_read_enrichment_evidence ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'enrichment-evidence'::text));


--
-- Name: objects catastro_public_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY catastro_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'catastro'::text));


--
-- Name: objects feedback-audio auth insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "feedback-audio auth insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'feedback-audio'::text));


--
-- Name: objects feedback-audio auth read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY "feedback-audio auth read" ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = 'feedback-audio'::text));


--
-- Name: objects imagery_public_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY imagery_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'building_imagery'::text));


--
-- Name: objects notas_simples_read_all; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY notas_simples_read_all ON storage.objects FOR SELECT USING ((bucket_id = 'notas-simples'::text));


--
-- Name: objects notas_simples_write_all; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY notas_simples_write_all ON storage.objects FOR INSERT WITH CHECK ((bucket_id = 'notas-simples'::text));


--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: objects service_role_write_enrichment_evidence; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY service_role_write_enrichment_evidence ON storage.objects FOR INSERT TO service_role WITH CHECK ((bucket_id = 'enrichment-evidence'::text));


--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime wa_conversations; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.wa_conversations;


--
-- Name: supabase_realtime wa_instances; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.wa_instances;


--
-- Name: supabase_realtime wa_messages; Type: PUBLICATION TABLE; Schema: public; Owner: -
--

ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.wa_messages;


--
-- PostgreSQL database dump complete
--


