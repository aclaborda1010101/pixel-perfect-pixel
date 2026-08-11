-- =====================================================================
-- WAVE 1B · ESQUEMA DE FIXTURE DECLARADO (base desechable, nunca live)
-- =====================================================================
-- No es un shim de lógica: declara EXACTAMENTE la DDL real de las tablas
-- de dominio que la cadena 1A.2 -> 1A.3 -> 1B necesita (mismos nombres,
-- tipos, defaults y nullability que producción). Ninguna función, vista
-- ni regla de negocio se declara aquí: todo eso lo crean las migraciones.
-- =====================================================================
DO $$ BEGIN
  IF current_database() NOT LIKE 'wave1b\_test\_%' THEN
    RAISE EXCEPTION 'ABORTADO: fixture sólo en base desechable wave1b_test_*, base actual = %', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='nota_titular_rol') THEN
    CREATE TYPE public.nota_titular_rol AS ENUM ('pleno','usufructo','nuda_propiedad','otro','ganancial');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='owner_role') THEN
    CREATE TYPE public.owner_role AS ENUM ('particular','heredero','inversor_pasivo','operador_profesional','institucional','desconocido');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='owner_subrole') THEN
    CREATE TYPE public.owner_subrole AS ENUM ('ninguno','heredero_operador','heredero_residente','heredero_ausente','heredero_conflictivo','arrendador','usufructuario','nudo_propietario','apoderado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='buyer_persona') THEN
    CREATE TYPE public.buyer_persona AS ENUM ('cansado','desplazado','controla','ego','no_traspasa','vive_edificio','no_primero','sin_clasificar');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='building_status') THEN
    CREATE TYPE public.building_status AS ENUM ('identificado','contactado','en_estudio','descartado');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='iee_estado') THEN
    CREATE TYPE public.iee_estado AS ENUM ('desconocido','no_procede','pendiente','favorable','caducada','desfavorable_leve','desfavorable_grave');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.buildings(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  direccion text NOT NULL,
  ciudad text NOT NULL DEFAULT 'Madrid',
  codigo_postal text,
  division_horizontal boolean NOT NULL DEFAULT false,
  numero_propietarios integer,
  catastro_ref text,
  estado public.building_status NOT NULL DEFAULT 'identificado',
  notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  refcatastral text,
  score numeric,
  score_breakdown jsonb,
  score_propietarios numeric,
  score_total numeric,
  iee_estado public.iee_estado NOT NULL DEFAULT 'desconocido'
);

CREATE TABLE IF NOT EXISTS public.owners(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  email text, telefono text,
  rol public.owner_role NOT NULL DEFAULT 'desconocido',
  subrole public.owner_subrole NOT NULL DEFAULT 'ninguno',
  buyer_persona public.buyer_persona NOT NULL DEFAULT 'sin_clasificar',
  consentimiento boolean NOT NULL DEFAULT false,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_into uuid REFERENCES public.owners(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.companies(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  cif text, email text, telefono text,
  buyer_persona public.buyer_persona NOT NULL DEFAULT 'sin_clasificar',
  consentimiento boolean NOT NULL DEFAULT false,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notas_simples(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid REFERENCES public.buildings(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  file_url text,
  status text NOT NULL DEFAULT 'pendiente',
  raw_pdf_text text,
  structured_json jsonb,
  riesgo text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  dead_letter boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.nota_simple_titulares(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_simple_id uuid NOT NULL REFERENCES public.notas_simples(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES public.owners(id) ON DELETE SET NULL,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  nombre_extraido text,
  cif_dni text,
  porcentaje numeric,
  rol public.nota_titular_rol NOT NULL DEFAULT 'pleno',
  rol_literal text,
  evidencia jsonb,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.building_owners(
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.owners(id) ON DELETE CASCADE,
  cuota numeric,
  subrole public.owner_subrole NOT NULL DEFAULT 'ninguno',
  rol_notas text,
  created_at timestamptz NOT NULL DEFAULT now(),
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  es_influencer boolean NOT NULL DEFAULT false,
  influencer_score numeric,
  influencer_reason text,
  owner_name_norm text,
  cuota_estado text NOT NULL DEFAULT 'sin_auditar',
  cuota_estado_motivo text,
  cuota_auditada_at timestamptz,
  PRIMARY KEY (building_id, owner_id),
  CONSTRAINT building_owners_cuota_estado_chk CHECK (cuota_estado = ANY (ARRAY['sin_auditar','vigente','review','superseded']))
);

CREATE TABLE IF NOT EXISTS public.building_property_rights(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid NOT NULL REFERENCES public.buildings(id) ON DELETE CASCADE,
  owner_id uuid,
  company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  note_simple_id uuid,
  right_type text NOT NULL DEFAULT 'pleno_dominio',
  percentage numeric,
  coownership_regime text,
  source_type text NOT NULL DEFAULT 'manual',
  source_ref text,
  evidence text,
  confidence numeric,
  valid_from date,
  valid_to date,
  verified_at timestamptz,
  verified_by uuid,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  titular_id uuid,
  titular_nombre text,
  titular_dni text,
  identity_match text NOT NULL DEFAULT 'ninguno',
  cotitulares text[],
  feeds_cuota boolean NOT NULL DEFAULT false,
  blocked_reason text,
  review_flag boolean NOT NULL DEFAULT false,
  review_reason text,
  right_literal text,
  evidence_ref jsonb,
  CONSTRAINT bpr_owner_xor_company CHECK (((owner_id IS NOT NULL)::int + (company_id IS NOT NULL)::int) = 1),
  CONSTRAINT building_property_rights_identity_match_check CHECK (identity_match = ANY (ARRAY['dni','nombre_exacto','aproximado','ninguno'])),
  CONSTRAINT building_property_rights_percentage_check CHECK (percentage IS NULL OR (percentage >= 0 AND percentage <= 100)),
  CONSTRAINT building_property_rights_right_type_check CHECK (right_type = ANY (ARRAY['pleno_dominio','nuda_propiedad','usufructo','ganancial','otro'])),
  CONSTRAINT building_property_rights_status_check CHECK (status = ANY (ARRAY['active','review','superseded']))
);

-- ---------------------------------------------------------------------
-- Helpers de normalización copiados BYTE A BYTE de producción
-- (pg_get_functiondef). No son stubs: son la definición real vigente.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.norm_person_name(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT nullif(
    regexp_replace(
      regexp_replace(
        upper(translate(coalesce(p,''),
          'ÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇáàäâãéèëêíìïîóòöôõúùüûñç',
          'AAAAAEEEEIIIIOOOOOUUUUNCAAAAAEEEEIIIIOOOOOUUUUNC')),
        '\m(DON|DONA|DOÑA|SR|SRA|D)\M\.?', ' ', 'g'),
      '[^A-Z0-9]+', ' ', 'g')
  , '');
$function$;

CREATE OR REPLACE FUNCTION public.clean_owner_name(p_name text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(
    regexp_replace(
      regexp_replace(
        coalesce(p_name, ''),
        '\s*[\(\[]?\s*(probable\s+)?(fallecid[oa]s?|difunt[oa]s?|e\.?\s*p\.?\s*d\.?|q\.?\s*e\.?\s*p\.?\s*d\.?)\s*[\)\]]?\s*',
        ' ',
        'gi'
      ),
      '\s{2,}', ' ', 'g'
    ),
    ''
  );
$function$;
