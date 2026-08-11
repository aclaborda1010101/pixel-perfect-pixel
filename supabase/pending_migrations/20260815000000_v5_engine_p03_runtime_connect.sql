-- =====================================================================
-- MOTOR V5 — P0.3. CONEXIÓN DEL RUNTIME (migración FORWARD, PENDIENTE)
-- =====================================================================
-- NO aplicada. Depende de 20260811230000 (Fase A) y 20260813000000 (P0.2).
-- Forward-only e idempotente. No genera ni borra tareas.
--
-- Aporta:
--   * v5_runtime_config: interruptor real (OFF por defecto), pausa, canario
--     y revisión de configuración. Sin fila => todo apagado (fail-closed).
--   * v5_generation_requests: cola/outbox de solicitudes con LEASE por
--     comercial. Una solicitud viva por comercial (índice único parcial).
--   * commit_v5_generation_plan: ÚNICA puerta de escritura de production.
--     Revalida flag/pausa/canario/revisión/slot/tombstone/clave canónica y
--     inserta EXACTAMENTE 0 ó 1 fila. Dos workers => como mucho una.
--   * resolve_building_task: cierre transaccional + reposición única.
--   * reap_v5_generation_leases: SOLO recuperación de leases caducados.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Preflight: Fase A + P0.2 aplicadas.
-- ---------------------------------------------------------------------
DO $pre$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.building_tasks'::regclass
      AND conname = 'building_tasks_v5_canonical_key_chk'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT V5 P0.3: falta P0.2 (building_tasks_v5_canonical_key_chk). Aplicar 20260813000000 primero.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------
-- 1. Configuración del runtime (singleton, OFF por defecto)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v5_runtime_config (
  id                      smallint PRIMARY KEY DEFAULT 1,
  enabled                 boolean NOT NULL DEFAULT false,
  paused                  boolean NOT NULL DEFAULT true,
  config_review_required  boolean NOT NULL DEFAULT true,
  canary_user_ids         uuid[]  NULL,
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT v5_runtime_config_singleton_chk CHECK (id = 1)
);

INSERT INTO public.v5_runtime_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

REVOKE ALL ON public.v5_runtime_config FROM PUBLIC;
GRANT SELECT ON public.v5_runtime_config TO authenticated;
GRANT SELECT, UPDATE ON public.v5_runtime_config TO service_role;
ALTER TABLE public.v5_runtime_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v5_runtime_config_read ON public.v5_runtime_config;
CREATE POLICY v5_runtime_config_read ON public.v5_runtime_config
  FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------
-- 2. Cola/outbox de generación con lease
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.v5_generation_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comercial_id  uuid NOT NULL,
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',
  lease_token   uuid NULL,
  lease_expires_at timestamptz NULL,
  outcome       text NULL,
  detail        text NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz NULL,
  CONSTRAINT v5_generation_requests_status_chk
    CHECK (status IN ('pending','leased','done','failed'))
);

-- Como mucho UNA solicitud viva por comercial: retry idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS v5_generation_requests_one_open_uidx
  ON public.v5_generation_requests (comercial_id)
  WHERE status IN ('pending','leased');

CREATE INDEX IF NOT EXISTS v5_generation_requests_lease_idx
  ON public.v5_generation_requests (lease_expires_at)
  WHERE status = 'leased';

REVOKE ALL ON public.v5_generation_requests FROM PUBLIC;
REVOKE ALL ON public.v5_generation_requests FROM anon, authenticated;
GRANT SELECT ON public.v5_generation_requests TO service_role;
ALTER TABLE public.v5_generation_requests ENABLE ROW LEVEL SECURITY;
-- Sin políticas: la tabla sólo se toca por las RPC SECURITY DEFINER.

-- ---------------------------------------------------------------------
-- 3. Solicitud de generación (idempotente)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.request_v5_generation(p_comercial_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_id uuid;
BEGIN
  IF p_comercial_id IS NULL THEN
    RAISE EXCEPTION 'request_v5_generation: comercial obligatorio';
  END IF;
  SELECT id INTO v_id FROM public.v5_generation_requests
   WHERE comercial_id = p_comercial_id AND status IN ('pending','leased')
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN v_id;  -- ya hay una solicitud viva: no se duplica.
  END IF;
  INSERT INTO public.v5_generation_requests (comercial_id, reason)
  VALUES (p_comercial_id, coalesce(p_reason, 'reposicion'))
  RETURNING id INTO v_id;
  RETURN v_id;
END
$fn$;

REVOKE ALL ON FUNCTION public.request_v5_generation(uuid, text) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------
-- 4. Reclamo con lease (server-side, token opaco)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_v5_generation_requests(
  p_limit int DEFAULT 10,
  p_user_ids uuid[] DEFAULT NULL
)
RETURNS TABLE (id uuid, comercial_id uuid, lease_token uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  RETURN QUERY
  WITH pick AS (
    SELECT r.id
      FROM public.v5_generation_requests r
     WHERE r.status = 'pending'
       AND (p_user_ids IS NULL OR r.comercial_id = ANY (p_user_ids))
     ORDER BY r.created_at
     FOR UPDATE SKIP LOCKED
     LIMIT greatest(1, least(coalesce(p_limit, 10), 50))
  )
  UPDATE public.v5_generation_requests r
     SET status = 'leased',
         lease_token = gen_random_uuid(),
         lease_expires_at = now() + interval '5 minutes'
    FROM pick
   WHERE r.id = pick.id
  RETURNING r.id, r.comercial_id, r.lease_token;
END
$fn$;

REVOKE ALL ON FUNCTION public.claim_v5_generation_requests(int, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_v5_generation_requests(int, uuid[]) TO service_role;

CREATE OR REPLACE FUNCTION public.release_v5_generation_request(
  p_request_id uuid, p_lease_token uuid, p_outcome text, p_detail text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_rows int;
BEGIN
  UPDATE public.v5_generation_requests
     SET status = CASE WHEN p_outcome = 'inserted' THEN 'done' ELSE 'failed' END,
         outcome = p_outcome,
         detail = p_detail,
         lease_token = NULL,
         lease_expires_at = NULL,
         processed_at = now()
   WHERE id = p_request_id
     AND lease_token = p_lease_token;   -- CAS: nunca pisa un lease ajeno.
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows = 1;
END
$fn$;

REVOKE ALL ON FUNCTION public.release_v5_generation_request(uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_v5_generation_request(uuid, uuid, text, text) TO service_role;

-- Reaper: SOLO recupera leases caducados. NUNCA genera.
CREATE OR REPLACE FUNCTION public.reap_v5_generation_leases()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_rows int;
BEGIN
  UPDATE public.v5_generation_requests
     SET status = 'pending', lease_token = NULL, lease_expires_at = NULL
   WHERE status = 'leased' AND lease_expires_at < now();
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END
$fn$;

REVOKE ALL ON FUNCTION public.reap_v5_generation_leases() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reap_v5_generation_leases() TO service_role;

-- ---------------------------------------------------------------------
-- 5.0 Validador de clave canónica (obligatorio en el commit)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.v5_assert_canonical_task_key(
  p_key text, p_code text, p_building uuid, p_subject uuid, p_fingerprint text
)
RETURNS void
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $fn$
BEGIN
  IF p_key !~ '^v5:[^:]+:(T1|T2_T3|T4|T5|T6|T8|T9):[^:]+:[^:]+:[^:]+$'
     OR split_part(p_key, ':', 3) <> p_code
     OR split_part(p_key, ':', 4) <> p_building::text
     OR split_part(p_key, ':', 5) <> p_subject::text
     OR split_part(p_key, ':', 6) <> p_fingerprint THEN
    RAISE EXCEPTION 'V5: task_key no canónica (%)', p_key;
  END IF;
END
$fn$;

-- ---------------------------------------------------------------------
-- 5. COMMIT TRANSACCIONAL: única puerta de escritura de production
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commit_v5_generation_plan(
  p_request_id uuid, p_lease_token uuid, p_plan jsonb
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_cfg      public.v5_runtime_config%ROWTYPE;
  v_com      uuid := (p_plan->>'comercial_id')::uuid;
  v_key      text := p_plan->>'task_key';
  v_code     text := p_plan->>'task_code';
  v_building uuid := (p_plan->>'building_id')::uuid;
  v_subject  uuid := (p_plan->>'subject_id')::uuid;
  v_fp       text := p_plan->>'trigger_fingerprint';
  v_new      uuid;
BEGIN
  -- 5.1 Lease vivo y coincidente (CAS). Sin él, cero escritura.
  PERFORM 1 FROM public.v5_generation_requests
   WHERE id = p_request_id AND lease_token = p_lease_token
     AND status = 'leased' AND lease_expires_at > now()
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;  -- 0 filas: el worker perdió el lease.
  END IF;

  -- 5.2 Revalidación de configuración DENTRO de la transacción.
  SELECT * INTO v_cfg FROM public.v5_runtime_config WHERE id = 1 FOR UPDATE;
  IF NOT FOUND OR v_cfg.enabled IS NOT TRUE OR v_cfg.paused IS TRUE
     OR v_cfg.config_review_required IS TRUE THEN
    RETURN;
  END IF;
  IF v_cfg.canary_user_ids IS NOT NULL
     AND array_length(v_cfg.canary_user_ids, 1) > 0
     AND NOT (v_com = ANY (v_cfg.canary_user_ids)) THEN
    RETURN;
  END IF;

  -- 5.3 Contrato canónico mínimo (la BD vuelve a comprobarlo con CHECKs).
  IF v_com IS NULL OR v_building IS NULL OR v_subject IS NULL
     OR coalesce(btrim(v_key), '') = '' OR coalesce(btrim(v_fp), '') = ''
     OR v_code NOT IN ('T1','T2_T3','T4','T5','T6','T8','T9') THEN
    RAISE EXCEPTION 'commit_v5_generation_plan: plan no canónico';
  END IF;
  PERFORM public.v5_assert_canonical_task_key(v_key, v_code, v_building, v_subject, v_fp);

  -- 5.3.b FECHAS (la BD revalida lo que ya validó el writer): instantes
  -- válidos, ventana coherente y jamás una tarea nacida vencida.
  IF (p_plan->>'starts_at') IS NULL OR (p_plan->>'due_date') IS NULL THEN
    RAISE EXCEPTION 'commit_v5_generation_plan: ventana temporal obligatoria';
  END IF;
  IF (p_plan->>'due_date')::timestamptz < (p_plan->>'starts_at')::timestamptz THEN
    RAISE EXCEPTION 'commit_v5_generation_plan: due_date anterior a starts_at';
  END IF;
  IF (p_plan->>'due_date')::timestamptz <= now() THEN
    RAISE EXCEPTION 'commit_v5_generation_plan: la tarea nacería vencida';
  END IF;

  -- 5.4 Slot: como mucho UNA production abierta por comercial.
  PERFORM 1 FROM public.building_tasks
   WHERE user_id = v_com AND generation_mode = 'production'
     AND status IN ('pending','in_progress')
   FOR UPDATE;
  IF FOUND THEN RETURN; END IF;

  -- 5.5 Tombstone / idempotencia por clave (misma huella = nada nuevo).
  PERFORM 1 FROM public.building_tasks WHERE task_key = v_key;
  IF FOUND THEN RETURN; END IF;

  INSERT INTO public.building_tasks (
    user_id, building_id, title, description, priority, status,
    task_type, task_key, task_code, generation_mode, rules_version,
    subject_type, subject_id, trigger_fingerprint,
    eligibility_snapshot, mode_snapshot, starts_at, due_date
  ) VALUES (
    v_com, v_building, p_plan->>'title', p_plan->>'justificacion', 'medium', 'pending',
    'auto', v_key, v_code, 'production', split_part(v_key, ':', 2),
    p_plan->>'subject_type', v_subject, v_fp,
    coalesce(p_plan->'eligibility_snapshot', '{}'::jsonb),
    coalesce(p_plan->'mode_snapshot', '{}'::jsonb),
    (p_plan->>'starts_at')::timestamptz,
    (p_plan->>'due_date')::timestamptz
  )
  ON CONFLICT DO NOTHING
  RETURNING building_tasks.id INTO v_new;

  IF v_new IS NULL THEN RETURN; END IF;

  UPDATE public.v5_generation_requests
     SET status = 'done', outcome = 'inserted', lease_token = NULL,
         lease_expires_at = NULL, processed_at = now()
   WHERE id = p_request_id AND lease_token = p_lease_token;

  id := v_new;
  RETURN NEXT;
END
$fn$;

REVOKE ALL ON FUNCTION public.commit_v5_generation_plan(uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commit_v5_generation_plan(uuid, uuid, jsonb) TO service_role;

-- ---------------------------------------------------------------------
-- 6. Cierre transaccional + reposición única (la UI llama a esto)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_building_task(
  p_task_id uuid, p_status text, p_note text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_task public.building_tasks%ROWTYPE;
BEGIN
  IF p_status NOT IN ('completed','skipped','no_procede','blocked','cancelled') THEN
    RAISE EXCEPTION 'resolve_building_task: estado no admitido %', p_status;
  END IF;

  SELECT * INTO v_task FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'resolve_building_task: tarea inexistente';
  END IF;
  IF v_task.user_id <> auth.uid()
     AND NOT public.current_user_has_role('admin')
     AND NOT public.current_user_has_role('sales_manager') THEN
    RAISE EXCEPTION 'resolve_building_task: la tarea no es tuya';
  END IF;
  IF v_task.status IN ('completed','skipped','no_procede','cancelled','superseded') THEN
    RETURN false;  -- idempotente: ya cerrada.
  END IF;

  UPDATE public.building_tasks
     SET status = p_status,
         completed_at = CASE WHEN p_status = 'completed' THEN now() ELSE completed_at END,
         superseded_reason = coalesce(p_note, superseded_reason)
   WHERE id = p_task_id;

  -- Reposición: EXACTAMENTE una solicitud viva, en la MISMA transacción.
  IF v_task.generation_mode = 'production' THEN
    PERFORM public.request_v5_generation(v_task.user_id, 'cierre:' || p_status);
  END IF;
  RETURN true;
END
$fn$;

REVOKE ALL ON FUNCTION public.resolve_building_task(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_building_task(uuid, text, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------
-- 7. Verificación por definición exacta (no sólo existencia)
-- ---------------------------------------------------------------------
DO $verify$
DECLARE v_def text;
BEGIN
  SELECT pg_get_indexdef(indexrelid) INTO v_def
    FROM pg_index
   WHERE indrelid = 'public.v5_generation_requests'::regclass
     AND indexrelid = 'public.v5_generation_requests_one_open_uidx'::regclass;
  IF v_def IS NULL OR v_def NOT LIKE '%UNIQUE%' OR v_def NOT LIKE '%pending%' OR v_def NOT LIKE '%leased%' THEN
    RAISE EXCEPTION 'VERIFY V5 P0.3: índice de solicitud viva incorrecto: %', coalesce(v_def, 'NULL');
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'commit_v5_generation_plan';
  IF v_def IS NULL OR v_def NOT LIKE '%SECURITY DEFINER%' OR v_def NOT LIKE '%search_path%' THEN
    RAISE EXCEPTION 'VERIFY V5 P0.3: commit_v5_generation_plan sin SECURITY DEFINER/search_path fijo';
  END IF;

  IF has_function_privilege('authenticated', 'public.commit_v5_generation_plan(uuid, uuid, jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY V5 P0.3: authenticated no puede ejecutar el commit del motor';
  END IF;
END
$verify$;

COMMIT;
