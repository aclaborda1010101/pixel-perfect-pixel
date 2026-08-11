-- =====================================================================
-- MOTOR V5 — FASE A.1 (migración FORWARD, PENDIENTE DE APLICAR)
-- =====================================================================
-- NO se ha aplicado. Forward-only e idempotente: no reescribe migraciones
-- históricas, no borra ni reescribe datos, no genera tareas.
--
-- Principios:
--   * generation_mode = 'legacy' es el DEFAULT y el destino de todo lo
--     existente/no migrado. legacy NUNCA se reclasifica como manual ni
--     production. production/demo/manual son SIEMPRE explícitos.
--   * Preflight FAIL-CLOSED: si algún dato existente violase una
--     restricción, la migración aborta (RAISE EXCEPTION) sin tocar nada.
--   * T7, T2 y T3 quedan prohibidas también dentro de la task_key.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Columnas del modelo V5
-- ---------------------------------------------------------------------
ALTER TABLE public.building_tasks
  ADD COLUMN IF NOT EXISTS task_code            text NULL,
  ADD COLUMN IF NOT EXISTS subject_type         text NULL,
  ADD COLUMN IF NOT EXISTS subject_id           uuid NULL,
  ADD COLUMN IF NOT EXISTS generation_mode      text NOT NULL DEFAULT 'legacy',
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

-- El default pasa a 'legacy' también si la columna ya existía con otro default.
ALTER TABLE public.building_tasks ALTER COLUMN generation_mode SET DEFAULT 'legacy';

COMMENT ON COLUMN public.building_tasks.task_code IS
  'Código canónico V5: T1, T2_T3, T4, T5, T6, T8, T9. T7/T2/T3 prohibidas.';
COMMENT ON COLUMN public.building_tasks.generation_mode IS
  'legacy (default, filas no migradas) | production | demo | manual. Sólo production entra en la restricción de una activa por comercial.';
COMMENT ON COLUMN public.building_tasks.started_at IS
  'Inicio REAL de la tarea. NULL en el histórico: esas tareas no computan duración.';

-- ---------------------------------------------------------------------
-- 2. Preflight FAIL-CLOSED sobre datos existentes (no borra ni reescribe)
-- ---------------------------------------------------------------------
DO $preflight$
DECLARE
  v_bad     bigint;
  v_duetype text;
BEGIN
  -- 2.1 due_date debe ser timestamptz: la ventana se compara sin cast a date.
  SELECT atttypid::regtype::text INTO v_duetype
  FROM pg_attribute
  WHERE attrelid = 'public.building_tasks'::regclass AND attname = 'due_date' AND NOT attisdropped;

  IF v_duetype IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT V5: no existe building_tasks.due_date';
  END IF;
  IF v_duetype <> 'timestamp with time zone' THEN
    RAISE EXCEPTION
      'PREFLIGHT V5: due_date es % y la ventana exige timestamptz sin cast a date. Convertir la columna en una migración previa y explícita.',
      v_duetype;
  END IF;

  -- 2.2 Ninguna fila existente puede tener generation_mode fuera del dominio.
  SELECT count(*) INTO v_bad FROM public.building_tasks
  WHERE generation_mode IS NULL OR generation_mode NOT IN ('legacy','production','demo','manual');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT V5: % filas con generation_mode fuera de dominio', v_bad;
  END IF;

  -- 2.3 Claves V5 existentes: código válido y concordante, sin T7/T2/T3.
  SELECT count(*) INTO v_bad FROM public.building_tasks
  WHERE task_key LIKE 'v5:%'
    AND split_part(task_key, ':', 3) NOT IN ('T1','T2_T3','T4','T5','T6','T8','T9');
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT V5: % task_key con código no admitido', v_bad;
  END IF;

  -- 2.4 Ventana temporal existente coherente.
  SELECT count(*) INTO v_bad FROM public.building_tasks
  WHERE starts_at IS NOT NULL AND due_date IS NOT NULL AND due_date < starts_at;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT V5: % filas con due_date < starts_at', v_bad;
  END IF;

  -- 2.5 Más de una production activa por comercial (no debería existir aún).
  SELECT count(*) INTO v_bad FROM (
    SELECT user_id FROM public.building_tasks
    WHERE generation_mode = 'production' AND status IN ('pending','in_progress')
    GROUP BY user_id HAVING count(*) > 1
  ) q;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT V5: % comerciales con más de una production activa', v_bad;
  END IF;

  -- 2.6 Duplicados de task_key V5 en production.
  SELECT count(*) INTO v_bad FROM (
    SELECT task_key FROM public.building_tasks
    WHERE generation_mode = 'production' AND task_key LIKE 'v5:%'
    GROUP BY task_key HAVING count(*) > 1
  ) q;
  IF v_bad > 0 THEN
    RAISE EXCEPTION 'PREFLIGHT V5: % task_key duplicadas en production', v_bad;
  END IF;
END
$preflight$;

-- ---------------------------------------------------------------------
-- 3. Dominios / invariantes
-- ---------------------------------------------------------------------
DO $constraints$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_generation_mode_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_generation_mode_chk
      CHECK (generation_mode IN ('legacy','production','demo','manual'));
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

  -- T7/T2/T3 no pueden entrar por código ni por clave (ni en minúsculas).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_no_t7_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_no_t7_chk
      CHECK (
        (task_code IS NULL OR task_code IN ('T1','T2_T3','T4','T5','T6','T8','T9'))
        AND (task_key IS NULL OR task_key !~* '^v5:[^:]*:(t7|t2|t3):')
      );
  END IF;

  -- Concordancia EXACTA entre task_code y el segmento de la task_key.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_v5_key_code_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_v5_key_code_chk
      CHECK (
        task_key IS NULL
        OR task_key NOT LIKE 'v5:%'
        OR (
          task_code IS NOT NULL
          AND split_part(task_key, ':', 3) = task_code
          AND task_code IN ('T1','T2_T3','T4','T5','T6','T8','T9')
        )
      );
  END IF;

  -- Ventana exacta timestamptz, sin cast a date.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_window_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_window_chk
      CHECK (starts_at IS NULL OR due_date IS NULL OR due_date >= starts_at);
  END IF;

  -- production: contrato completo y explícito.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_production_contract_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_production_contract_chk
      CHECK (
        generation_mode <> 'production'
        OR (
          user_id              IS NOT NULL
          AND task_code        IS NOT NULL
          AND subject_type     IS NOT NULL
          AND subject_id       IS NOT NULL
          AND rules_version    IS NOT NULL
          AND trigger_fingerprint IS NOT NULL
          AND eligibility_snapshot IS NOT NULL
          AND mode_snapshot    IS NOT NULL
          AND task_key         IS NOT NULL
          AND task_key LIKE 'v5:%'
        )
      );
  END IF;

  -- manual: autor, subtipo y sujeto obligatorios.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_manual_contract_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_manual_contract_chk
      CHECK (
        generation_mode <> 'manual'
        OR (
          created_by       IS NOT NULL
          AND manual_subtype IN ('posible_interes','otro')
          AND subject_type IN ('owner','building')
          AND subject_id   IS NOT NULL
        )
      );
  END IF;

  -- demo: siempre ligada a una simulación, nunca a producción.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_demo_contract_chk') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_demo_contract_chk
      CHECK (generation_mode <> 'demo' OR simulation_run_id IS NOT NULL);
  END IF;
END
$constraints$;

-- ---------------------------------------------------------------------
-- 4. Claves foráneas seguras (NOT VALID: no reescriben el histórico)
-- ---------------------------------------------------------------------
DO $fks$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'auth' AND c.relname = 'users')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_created_by_fkey') THEN
    ALTER TABLE public.building_tasks
      ADD CONSTRAINT building_tasks_created_by_fkey
      FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'public' AND c.relname = 'owners')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'building_tasks_subject_owner_fkey') THEN
    -- Sólo se declara si owners.id es uuid y único; en caso contrario se omite.
    IF EXISTS (
      SELECT 1 FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
      WHERE i.indrelid = 'public.owners'::regclass AND i.indisunique
        AND a.attname = 'id' AND a.atttypid = 'uuid'::regtype
    ) THEN
      RAISE NOTICE 'V5: owners.id es uuid único; la FK de subject_id se omite a propósito porque subject_id es polimórfico (owner|building).';
    END IF;
  END IF;
END
$fks$;

-- ---------------------------------------------------------------------
-- 5. Idempotencia: task_key V5 única SÓLO en production.
--    legacy y demo no colisionan entre sí ni con production.
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS building_tasks_v5_production_key_uidx
  ON public.building_tasks (task_key)
  WHERE generation_mode = 'production' AND task_key LIKE 'v5:%';

-- ---------------------------------------------------------------------
-- 6. Máximo UNA tarea production activa por comercial (user_id NOT NULL).
-- ---------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS building_tasks_one_active_production_uidx
  ON public.building_tasks (user_id)
  WHERE generation_mode = 'production'
    AND user_id IS NOT NULL
    AND status IN ('pending','in_progress');

-- ---------------------------------------------------------------------
-- 7. Índices acotados de consulta
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
