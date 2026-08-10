-- =====================================================================
-- MOTOR V5 — FASE A (migración FORWARD, PENDIENTE DE APLICAR)
-- =====================================================================
-- NO se ha aplicado. Es forward-only e idempotente: no reescribe
-- migraciones históricas ni borra datos. Compatible con
-- 20260811000000_sales_manager_phase_b.sql (started_at con IF NOT EXISTS).
--
-- Alcance: sólo el MODELO de building_tasks para el motor V5.
-- No genera, borra ni actualiza tareas. T7 queda prohibida a nivel de datos.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Columnas del modelo V5
-- ---------------------------------------------------------------------
ALTER TABLE public.building_tasks
  ADD COLUMN IF NOT EXISTS task_code            text NULL,
  ADD COLUMN IF NOT EXISTS subject_type         text NULL,
  ADD COLUMN IF NOT EXISTS subject_id           uuid NULL,
  ADD COLUMN IF NOT EXISTS generation_mode      text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS manual_subtype       text NULL,
  ADD COLUMN IF NOT EXISTS starts_at            timestamptz NULL,
  ADD COLUMN IF NOT EXISTS started_at           timestamptz NULL,
  ADD COLUMN IF NOT EXISTS eligibility_snapshot jsonb NULL,
  ADD COLUMN IF NOT EXISTS mode_snapshot        jsonb NULL,
  ADD COLUMN IF NOT EXISTS trigger_fingerprint  text NULL,
  ADD COLUMN IF NOT EXISTS superseded_reason    text NULL,
  ADD COLUMN IF NOT EXISTS created_by           uuid NULL,
  ADD COLUMN IF NOT EXISTS simulation_run_id    uuid NULL,
  ADD COLUMN IF NOT EXISTS rules_version        text NULL;

COMMENT ON COLUMN public.building_tasks.task_code IS
  'Código canónico V5: T1, T2_T3, T4, T5, T6, T8, T9. T7 está prohibida.';
COMMENT ON COLUMN public.building_tasks.generation_mode IS
  'production | demo | manual. Sólo production entra en la restricción de una tarea activa por comercial.';
COMMENT ON COLUMN public.building_tasks.started_at IS
  'Inicio REAL de la tarea. NULL en el histórico: esas tareas no computan duración.';

-- ---------------------------------------------------------------------
-- 2. Dominios / invariantes
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_generation_mode_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_generation_mode_chk
      CHECK (generation_mode IN ('production','demo','manual'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_subject_type_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_subject_type_chk
      CHECK (subject_type IS NULL OR subject_type IN ('owner','building'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_manual_subtype_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_manual_subtype_chk
      CHECK (manual_subtype IS NULL OR manual_subtype IN ('posible_interes','otro'));
  END IF;

  -- T7 no puede insertarse por ninguna vía (código ni clave).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_no_t7_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_no_t7_chk
      CHECK (
        (task_code IS NULL OR task_code IN ('T1','T2_T3','T4','T5','T6','T8','T9'))
        AND (task_key IS NULL OR task_key NOT LIKE 'v5:%:T7:%')
      );
  END IF;

  -- Ventana temporal coherente en tareas manuales.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_manual_window_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_manual_window_chk
      CHECK (starts_at IS NULL OR due_date IS NULL OR due_date >= starts_at::date);
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 3. Idempotencia de la clave V5 (no depende del día)
--    v5:<rules_version>:<code>:<building>:<subject>:<fingerprint>
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS building_tasks_v5_task_key_uidx
  ON public.building_tasks (task_key)
  WHERE task_key LIKE 'v5:%';

-- ---------------------------------------------------------------------
-- 4. Máximo UNA tarea production activa por comercial.
--    demo y manual quedan fuera de la restricción.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS building_tasks_one_active_production_uidx
  ON public.building_tasks (user_id)
  WHERE generation_mode = 'production'
    AND status IN ('pending','in_progress');

-- ---------------------------------------------------------------------
-- 5. Índices acotados de consulta
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS building_tasks_v5_subject_idx
  ON public.building_tasks (subject_type, subject_id)
  WHERE task_key LIKE 'v5:%';

CREATE INDEX IF NOT EXISTS building_tasks_v5_code_status_idx
  ON public.building_tasks (task_code, status)
  WHERE generation_mode = 'production';

CREATE INDEX IF NOT EXISTS building_tasks_simulation_idx
  ON public.building_tasks (simulation_run_id)
  WHERE simulation_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS building_tasks_fingerprint_idx
  ON public.building_tasks (trigger_fingerprint)
  WHERE trigger_fingerprint IS NOT NULL;

COMMIT;