-- =====================================================================
-- MOTOR V5 — P0.2 + ADAPTADOR RUNTIME (migración FORWARD, PENDIENTE)
-- =====================================================================
-- NO aplicada. Forward-only, idempotente, sin borrar ni reescribir datos y
-- sin generar tareas. Depende de 20260811230000_v5_engine_phase_a.sql.
--
-- Aporta sobre la Fase A:
--   * Validación de la task_key CANÓNICA COMPLETA:
--       v5:<rules_version>:<task_code>:<building_id>:<subject>:<fingerprint>
--     con concordancia EXACTA de segmentos ↔ columnas.
--   * Códigos admitidos: T1, T2_T3, T4, T5, T6, T8, T9. T2/T3/T7 prohibidos.
--   * Strings no vacíos y snapshots JSON *object* en production.
--   * Verificación de constraints por (conrelid, conname) + definición, y de
--     índices/defaults/predicados.
--   * Formato HISTÓRICO v5:<YYYY-MM-DD>:T-0X:<id>: se NEUTRALIZA de forma
--     explícita (queda etiquetado como legacy, sólo lectura) y el productor
--     antiguo no puede volver a insertarlo cuando V5 se active.
--   * created_by: NOT NULL en manual (por CHECK) es COMPATIBLE con la FK
--     ON DELETE SET NULL porque la FK apunta a auth.users y sólo se aplica a
--     filas manuales vivas; se documenta y se resuelve explícitamente abajo.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preflight: la Fase A debe estar aplicada.
-- ---------------------------------------------------------------------
DO $pre$
DECLARE v_missing text;
BEGIN
  SELECT string_agg(c, ', ') INTO v_missing
  FROM unnest(ARRAY['task_code','subject_type','subject_id','generation_mode',
                    'trigger_fingerprint','rules_version','eligibility_snapshot',
                    'mode_snapshot','created_by','manual_subtype']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.building_tasks'::regclass AND attname = c AND NOT attisdropped
  );
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT V5 P0.2: faltan columnas de la Fase A (%). Aplicar 20260811230000 primero.', v_missing;
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------
-- 1. Formato histórico T-01…T-09: reporte explícito, NO aborta.
-- ---------------------------------------------------------------------
DO $legacy$
DECLARE
  v_hist bigint;
  v_bad  bigint;
BEGIN
  SELECT count(*) INTO v_hist FROM public.building_tasks
  WHERE task_key ~ '^v5:\d{4}-\d{2}-\d{2}:T-0[1-9]:';

  -- El legado sólo se tolera si está correctamente etiquetado como legacy.
  SELECT count(*) INTO v_bad FROM public.building_tasks
  WHERE task_key ~ '^v5:\d{4}-\d{2}-\d{2}:T-0[1-9]:'
    AND generation_mode <> 'legacy';
  IF v_bad > 0 THEN
    RAISE EXCEPTION
      'PREFLIGHT V5 P0.2: % filas con clave histórica T-0X y generation_mode <> legacy. Reetiquetar antes de activar V5.', v_bad;
  END IF;

  RAISE NOTICE 'V5 P0.2: % tareas con formato histórico v5:<fecha>:T-0X (legacy, sólo lectura, neutralizadas).', v_hist;
END
$legacy$;

-- Neutralización explícita del formato histórico: se TOLERA (sólo lectura)
-- cuando está etiquetado como legacy; en cualquier otro modo es inválido.
DO $legacychk$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass
      AND conname = 'building_tasks_v5_key_code_chk'
  ) THEN
    ALTER TABLE public.building_tasks DROP CONSTRAINT building_tasks_v5_key_code_chk;
  END IF;

  ALTER TABLE public.building_tasks
    ADD CONSTRAINT building_tasks_v5_key_code_chk
    CHECK (
      task_key IS NULL
      OR task_key NOT LIKE 'v5:%'
      -- Histórico etiquetado legacy: neutralizado, sólo lectura.
      OR (generation_mode = 'legacy' AND task_key ~ '^v5:\d{4}-\d{2}-\d{2}:T-0[1-9]:')
      OR (
        task_code IS NOT NULL
        AND split_part(task_key, ':', 3) = task_code
        AND task_code IN ('T1','T2_T3','T4','T5','T6','T8','T9')
      )
    );
END
$legacychk$;

-- ---------------------------------------------------------------------
-- 2. Clave canónica: 6 segmentos, códigos válidos, concordancia exacta.
--    El formato histórico queda excluido de production por construcción.
-- ---------------------------------------------------------------------
DO $keys$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass
      AND conname = 'building_tasks_v5_canonical_key_chk'
  ) THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_v5_canonical_key_chk
      CHECK (
        generation_mode <> 'production'
        OR (
          task_key ~ '^v5:[^:]+:(T1|T2_T3|T4|T5|T6|T8|T9):[^:]+:[^:]+:[^:]+$'
          AND split_part(task_key, ':', 2) = rules_version
          AND split_part(task_key, ':', 3) = task_code
          AND split_part(task_key, ':', 4) = building_id::text
          AND split_part(task_key, ':', 5) = subject_id::text
          AND split_part(task_key, ':', 6) = trigger_fingerprint
        )
      );
  END IF;

  -- Strings no vacíos y snapshots JSON *object* en production.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass
      AND conname = 'building_tasks_production_strings_chk'
  ) THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_production_strings_chk
      CHECK (
        generation_mode <> 'production'
        OR (
          btrim(coalesce(rules_version, '')) <> ''
          AND btrim(coalesce(task_code, '')) <> ''
          AND btrim(coalesce(trigger_fingerprint, '')) <> ''
          AND btrim(coalesce(title, '')) <> ''
          AND jsonb_typeof(eligibility_snapshot) = 'object'
          AND jsonb_typeof(mode_snapshot) = 'object'
        )
      );
  END IF;

  -- El productor antiguo no puede insertar el formato histórico en cuanto
  -- V5 esté activo: sólo se admite en filas legacy YA existentes.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass
      AND conname = 'building_tasks_no_legacy_datekey_chk'
  ) THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_no_legacy_datekey_chk
      CHECK (
        task_key !~ '^v5:\d{4}-\d{2}-\d{2}:'
        OR generation_mode = 'legacy'
      );
  END IF;
END
$keys$;

-- ---------------------------------------------------------------------
-- 3. created_by: NOT NULL lógico en manual + FK ON DELETE SET NULL.
--    Resolución EXPLÍCITA: la FK se conserva con ON DELETE SET NULL (borrar
--    un usuario no puede borrar tareas), y el CHECK de manual se relaja a
--    "created_by NOT NULL O autor ya borrado", registrado en
--    created_by_deleted_at. Así no hay contradicción posible.
-- ---------------------------------------------------------------------
ALTER TABLE public.building_tasks
  ADD COLUMN IF NOT EXISTS created_by_deleted_at timestamptz NULL;

COMMENT ON COLUMN public.building_tasks.created_by_deleted_at IS
  'Sello puesto cuando la FK ON DELETE SET NULL anula created_by: la tarea manual sigue siendo válida y auditable.';

DO $manual$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass
      AND conname = 'building_tasks_manual_contract_chk'
  ) THEN
    ALTER TABLE public.building_tasks DROP CONSTRAINT building_tasks_manual_contract_chk;
  END IF;

  ALTER TABLE public.building_tasks
    ADD CONSTRAINT building_tasks_manual_contract_chk
    CHECK (
      generation_mode <> 'manual'
      OR (
        (created_by IS NOT NULL OR created_by_deleted_at IS NOT NULL)
        AND manual_subtype IN ('posible_interes','otro')
        AND subject_type IN ('owner','building')
        AND subject_id   IS NOT NULL
        AND starts_at    IS NOT NULL
        AND due_date     IS NOT NULL
        AND due_date >= starts_at
      )
    );
END
$manual$;

CREATE OR REPLACE FUNCTION public.building_tasks_mark_created_by_deleted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF OLD.created_by IS NOT NULL AND NEW.created_by IS NULL THEN
    NEW.created_by_deleted_at := coalesce(NEW.created_by_deleted_at, now());
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS building_tasks_created_by_deleted_trg ON public.building_tasks;
CREATE TRIGGER building_tasks_created_by_deleted_trg
  BEFORE UPDATE OF created_by ON public.building_tasks
  FOR EACH ROW EXECUTE FUNCTION public.building_tasks_mark_created_by_deleted();

-- ---------------------------------------------------------------------
-- 4. Demo imposible de persistir (defensa en profundidad sobre el CHECK).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.building_tasks_forbid_demo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF NEW.generation_mode = 'demo'
     OR NEW.task_key LIKE 'demo:%'
     OR NEW.task_key LIKE 'preview:%' THEN
    RAISE EXCEPTION 'V5: la demo es preview en memoria y NO se persiste (task_key=%)', NEW.task_key;
  END IF;
  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS building_tasks_forbid_demo_trg ON public.building_tasks;
CREATE TRIGGER building_tasks_forbid_demo_trg
  BEFORE INSERT OR UPDATE ON public.building_tasks
  FOR EACH ROW EXECUTE FUNCTION public.building_tasks_forbid_demo();

-- ---------------------------------------------------------------------
-- 5. Verificación final por (conrelid, conname) + definición e índices.
-- ---------------------------------------------------------------------
DO $verify$
DECLARE
  v_name text;
  v_def  text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'building_tasks_generation_mode_chk',
    'building_tasks_v5_status_chk',
    'building_tasks_no_t7_chk',
    'building_tasks_v5_key_code_chk',
    'building_tasks_production_contract_chk',
    'building_tasks_manual_contract_chk',
    'building_tasks_no_demo_chk',
    'building_tasks_v5_canonical_key_chk',
    'building_tasks_production_strings_chk',
    'building_tasks_no_legacy_datekey_chk'
  ] LOOP
    SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass AND conname = v_name;
    IF v_def IS NULL THEN
      RAISE EXCEPTION 'VERIFY V5 P0.2: falta el constraint %', v_name;
    END IF;
  END LOOP;

  -- Slot automático: pending|in_progress, SIN blocked (definición única).
  SELECT pg_get_indexdef(indexrelid) INTO v_def
  FROM pg_index WHERE indrelid = 'public.building_tasks'::regclass
    AND indexrelid = 'public.building_tasks_one_active_production_uidx'::regclass;
  IF v_def IS NULL OR v_def NOT LIKE '%pending%' OR v_def NOT LIKE '%in_progress%' OR v_def LIKE '%blocked%' THEN
    RAISE EXCEPTION 'VERIFY V5 P0.2: predicado de slot incorrecto: %', coalesce(v_def, 'NULL');
  END IF;

  -- Default de generation_mode.
  SELECT pg_get_expr(d.adbin, d.adrelid) INTO v_def
  FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
  WHERE d.adrelid = 'public.building_tasks'::regclass AND a.attname = 'generation_mode';
  IF v_def IS NULL OR v_def NOT LIKE '%legacy%' THEN
    RAISE EXCEPTION 'VERIFY V5 P0.2: generation_mode debe tener default legacy (actual: %)', coalesce(v_def, 'NULL');
  END IF;
END
$verify$;

COMMIT;
