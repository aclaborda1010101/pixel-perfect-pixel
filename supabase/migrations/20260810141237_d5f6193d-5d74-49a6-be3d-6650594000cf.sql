ALTER TYPE nota_titular_rol ADD VALUE IF NOT EXISTS 'ganancial';

ALTER TABLE public.nota_simple_titulares
  ADD COLUMN IF NOT EXISTS rol_literal text,
  ADD COLUMN IF NOT EXISTS evidencia jsonb;

ALTER TABLE public.building_property_rights
  ADD COLUMN IF NOT EXISTS review_flag boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_reason text,
  ADD COLUMN IF NOT EXISTS right_literal text,
  ADD COLUMN IF NOT EXISTS evidence_ref jsonb;

ALTER TABLE public.building_owners
  ADD COLUMN IF NOT EXISTS cuota_estado text NOT NULL DEFAULT 'sin_auditar',
  ADD COLUMN IF NOT EXISTS cuota_estado_motivo text,
  ADD COLUMN IF NOT EXISTS cuota_auditada_at timestamptz;

DO $$ BEGIN
  ALTER TABLE public.building_owners
    ADD CONSTRAINT building_owners_cuota_estado_chk
    CHECK (cuota_estado IN ('sin_auditar','vigente','review','superseded'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.reconciliation_queue
  ADD COLUMN IF NOT EXISTS requisitos jsonb,
  ADD COLUMN IF NOT EXISTS apto_auto boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bpr_building_type ON public.building_property_rights(building_id, right_type);
CREATE INDEX IF NOT EXISTS idx_bo_cuota_estado ON public.building_owners(cuota_estado);