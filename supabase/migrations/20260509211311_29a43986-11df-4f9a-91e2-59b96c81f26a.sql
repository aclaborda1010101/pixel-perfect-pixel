
-- =========================
-- companies
-- =========================
CREATE TABLE IF NOT EXISTS public.companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  cif text,
  email text,
  telefono text,
  buyer_persona public.buyer_persona NOT NULL DEFAULT 'sin_clasificar',
  consentimiento boolean NOT NULL DEFAULT false,
  notas text,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preview_all_select ON public.companies;
DROP POLICY IF EXISTS preview_all_insert ON public.companies;
DROP POLICY IF EXISTS preview_all_update ON public.companies;
DROP POLICY IF EXISTS preview_all_delete ON public.companies;

CREATE POLICY preview_all_select ON public.companies FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.companies FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.companies FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.companies FOR DELETE USING (true);

-- =========================
-- v_propietarios (union owners + companies)
-- =========================
CREATE OR REPLACE VIEW public.v_propietarios AS
  SELECT
    o.id,
    o.nombre,
    o.email,
    o.telefono,
    o.buyer_persona::text AS buyer_persona,
    o.consentimiento,
    o.updated_at,
    'persona_fisica'::text AS tipo,
    NULL::text             AS cif
  FROM public.owners o
  UNION ALL
  SELECT
    c.id,
    c.nombre,
    c.email,
    c.telefono,
    c.buyer_persona::text AS buyer_persona,
    c.consentimiento,
    c.updated_at,
    'persona_juridica'::text AS tipo,
    c.cif
  FROM public.companies c;

-- =========================
-- buildings backfill (division_horizontal + catastro_ref)
-- =========================
UPDATE public.buildings
SET division_horizontal = true
WHERE division_horizontal = false
  AND metadatos->>'dividido' = 'Con división horizontal';

UPDATE public.buildings
SET catastro_ref = metadatos->>'referencia_catastral'
WHERE (catastro_ref IS NULL OR catastro_ref = '')
  AND COALESCE(metadatos->>'referencia_catastral', '') <> '';

-- =========================
-- notas_simples
-- =========================
CREATE TABLE IF NOT EXISTS public.notas_simples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid,
  owner_id uuid,
  file_url text,
  status text NOT NULL DEFAULT 'pendiente', -- pendiente | procesando | ok | error
  raw_pdf_text text,
  structured_json jsonb,
  riesgo text, -- alto | medio | bajo
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

ALTER TABLE public.notas_simples ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preview_all_select ON public.notas_simples;
DROP POLICY IF EXISTS preview_all_insert ON public.notas_simples;
DROP POLICY IF EXISTS preview_all_update ON public.notas_simples;
DROP POLICY IF EXISTS preview_all_delete ON public.notas_simples;

CREATE POLICY preview_all_select ON public.notas_simples FOR SELECT USING (true);
CREATE POLICY preview_all_insert ON public.notas_simples FOR INSERT WITH CHECK (true);
CREATE POLICY preview_all_update ON public.notas_simples FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY preview_all_delete ON public.notas_simples FOR DELETE USING (true);

-- Storage bucket for nota simple PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('notas-simples', 'notas-simples', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "notas_simples_read_all" ON storage.objects;
DROP POLICY IF EXISTS "notas_simples_write_all" ON storage.objects;

CREATE POLICY "notas_simples_read_all"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'notas-simples');

CREATE POLICY "notas_simples_write_all"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'notas-simples');
