-- SHIM mínimo del esquema real necesario para P0.4/P0.5 en cluster efímero.
-- No sustituye lógica: sólo tablas y la RPC de matching que el ciclo invoca.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.notas_simples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id uuid,
  status text NOT NULL DEFAULT 'listo',
  raw_pdf_text text,
  structured_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt_count int NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  dead_letter boolean NOT NULL DEFAULT false,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.nota_simple_titulares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_simple_id uuid NOT NULL REFERENCES public.notas_simples(id) ON DELETE CASCADE,
  nombre_extraido text NOT NULL,
  cif_dni text,
  porcentaje numeric,
  rol text NOT NULL DEFAULT 'otro',
  rol_literal text,
  evidencia jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.hubspot_sync_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity text,
  started_at timestamptz,
  finished_at timestamptz,
  records_upserted int,
  records_failed int,
  status text,
  error_message text,
  metadatos jsonb
);

-- Interruptor de fallo para simular caída del matching REAL (no reimplementa SQL).
CREATE TABLE public.p05_switches (k text PRIMARY KEY, v boolean NOT NULL DEFAULT false);
INSERT INTO public.p05_switches(k, v) VALUES ('match_fail', false), ('log_fail', false);

CREATE OR REPLACE FUNCTION public.match_notas_pendientes()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (SELECT v FROM public.p05_switches WHERE k = 'match_fail') THEN
    RAISE EXCEPTION 'match_notas_pendientes: caída simulada';
  END IF;
  RETURN jsonb_build_object('matched', 0);
END $$;

CREATE OR REPLACE FUNCTION public.p05_set_switch(p_k text, p_v boolean)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.p05_switches SET v = p_v WHERE k = p_k RETURNING v;
$$;

GRANT SELECT, INSERT, UPDATE ON public.notas_simples, public.nota_simple_titulares, public.hubspot_sync_log TO service_role;
GRANT EXECUTE ON FUNCTION public.match_notas_pendientes() TO service_role;
GRANT EXECUTE ON FUNCTION public.p05_set_switch(text, boolean) TO service_role;
