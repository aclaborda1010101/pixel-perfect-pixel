
-- ===== ENUMS =====
CREATE TYPE owner_role AS ENUM ('particular', 'heredero', 'inversor_pasivo', 'operador_profesional', 'institucional', 'desconocido');
CREATE TYPE asset_status AS ENUM ('prospecto', 'en_estudio', 'listo_para_matching', 'en_negociacion', 'cerrado', 'descartado');
CREATE TYPE asset_type AS ENUM ('vivienda', 'local', 'edificio', 'suelo', 'oficina', 'industrial', 'otro');
CREATE TYPE building_status AS ENUM ('identificado', 'contactado', 'en_estudio', 'descartado');
CREATE TYPE call_direction AS ENUM ('entrante', 'saliente');
CREATE TYPE next_action_status AS ENUM ('pendiente', 'completada', 'cancelada');
CREATE TYPE match_status AS ENUM ('propuesto', 'aprobado', 'rechazado', 'contactado');
CREATE TYPE compliance_status AS ENUM ('pendiente', 'aprobado', 'rechazado');
CREATE TYPE whatsapp_status AS ENUM ('borrador', 'mock_enviado', 'fallido');
CREATE TYPE cadence_step_kind AS ENUM ('llamada', 'whatsapp', 'email', 'visita');

-- ===== TABLES =====
CREATE TABLE public.owners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  rol owner_role NOT NULL DEFAULT 'desconocido',
  rol_confianza NUMERIC(3,2),
  rol_justificacion TEXT,
  consentimiento BOOLEAN NOT NULL DEFAULT false,
  notas_breves TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direccion TEXT NOT NULL,
  ciudad TEXT NOT NULL,
  codigo_postal TEXT,
  division_horizontal BOOLEAN NOT NULL DEFAULT false,
  numero_propietarios INT,
  catastro_ref TEXT,
  estado building_status NOT NULL DEFAULT 'identificado',
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  building_id UUID REFERENCES public.buildings(id) ON DELETE SET NULL,
  owner_id UUID REFERENCES public.owners(id) ON DELETE SET NULL,
  tipo asset_type NOT NULL DEFAULT 'vivienda',
  ubicacion TEXT NOT NULL,
  ciudad TEXT,
  superficie_m2 NUMERIC(10,2),
  valoracion_estimada NUMERIC(14,2),
  valoracion_fuente TEXT,
  valoracion_confianza NUMERIC(3,2),
  estado asset_status NOT NULL DEFAULT 'prospecto',
  descripcion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.investors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre TEXT NOT NULL,
  email TEXT,
  telefono TEXT,
  ticket_min NUMERIC(14,2),
  ticket_max NUMERIC(14,2),
  ciudades TEXT[] NOT NULL DEFAULT '{}',
  tipos_activo asset_type[] NOT NULL DEFAULT '{}',
  consentimiento BOOLEAN NOT NULL DEFAULT false,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
  fecha TIMESTAMPTZ NOT NULL DEFAULT now(),
  direccion call_direction NOT NULL DEFAULT 'saliente',
  duracion_seg INT,
  resumen TEXT,
  transcripcion TEXT,
  transcripcion_url TEXT,
  siguiente_accion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  texto TEXT NOT NULL,
  etiquetas TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.next_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
  asset_id UUID REFERENCES public.assets(id) ON DELETE SET NULL,
  titulo TEXT NOT NULL,
  detalle TEXT,
  vencimiento DATE,
  estado next_action_status NOT NULL DEFAULT 'pendiente',
  origen TEXT, -- 'agente_post_llamada' | 'matching' | 'manual'...
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.match_candidates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES public.assets(id) ON DELETE CASCADE,
  investor_id UUID NOT NULL REFERENCES public.investors(id) ON DELETE CASCADE,
  score NUMERIC(3,2) NOT NULL,
  evidencia TEXT,
  estado match_status NOT NULL DEFAULT 'propuesto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (asset_id, investor_id)
);

CREATE TABLE public.compliance_cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type TEXT NOT NULL, -- 'owner' | 'asset' | 'match' | 'whatsapp' | 'death_signal'
  scope_id UUID,
  estado compliance_status NOT NULL DEFAULT 'pendiente',
  dpia_ok BOOLEAN NOT NULL DEFAULT false,
  motivo TEXT NOT NULL,
  evidencia TEXT,
  owner_revisor TEXT,
  resuelto_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
  cuerpo TEXT NOT NULL,
  status whatsapp_status NOT NULL DEFAULT 'borrador',
  programado_para TIMESTAMPTZ,
  enviado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.cadence_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID REFERENCES public.owners(id) ON DELETE CASCADE,
  tipo cadence_step_kind NOT NULL,
  dia_offset INT NOT NULL DEFAULT 0,
  plantilla TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name TEXT NOT NULL,
  scope_type TEXT,
  scope_id UUID,
  modelo TEXT,
  latencia_ms INT,
  tokens_in INT,
  tokens_out INT,
  confianza NUMERIC(3,2),
  resultado JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.org_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clave TEXT NOT NULL UNIQUE,
  valor JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ===== updated_at trigger =====
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_owners_updated BEFORE UPDATE ON public.owners FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_buildings_updated BEFORE UPDATE ON public.buildings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_assets_updated BEFORE UPDATE ON public.assets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_investors_updated BEFORE UPDATE ON public.investors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.org_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ===== RLS (open for preview, no auth yet) =====
-- TODO: tighten when auth lands.
ALTER TABLE public.owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.next_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compliance_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cadence_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'owners','buildings','assets','investors','calls','notes',
    'next_actions','match_candidates','compliance_cases',
    'whatsapp_messages','cadence_steps','agent_runs','org_settings'
  ])
  LOOP
    EXECUTE format('CREATE POLICY "preview_all_select" ON public.%I FOR SELECT USING (true);', t);
    EXECUTE format('CREATE POLICY "preview_all_insert" ON public.%I FOR INSERT WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "preview_all_update" ON public.%I FOR UPDATE USING (true) WITH CHECK (true);', t);
    EXECUTE format('CREATE POLICY "preview_all_delete" ON public.%I FOR DELETE USING (true);', t);
  END LOOP;
END $$;

-- ===== Seed básico =====
INSERT INTO public.org_settings (clave, valor) VALUES
  ('umbral_confianza_default', '0.7'::jsonb),
  ('responsable_hitl', '"Operador AFFLUX"'::jsonb),
  ('idioma_default', '"es"'::jsonb);
