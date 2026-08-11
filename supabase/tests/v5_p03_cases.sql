-- =====================================================================
-- MOTOR V5 P0.3 · casos de integración REALES (clúster efímero).
-- Todo dentro de una transacción que termina en ROLLBACK: cero datos.
-- =====================================================================
BEGIN;

SET LOCAL client_min_messages = NOTICE;

DO $seed$
BEGIN
  INSERT INTO public.buildings (id, direccion, ciudad)
  VALUES ('aaaaaaaa-0000-0000-0000-000000000001', 'CASO V5 P0.3', 'LOCAL')
  ON CONFLICT (id) DO NOTHING;
END
$seed$;

-- ---------------------------------------------------------------------
-- CASO 1: flag OFF (default) => el commit no escribe NADA.
-- ---------------------------------------------------------------------
DO $c1$
DECLARE
  v_req uuid; v_tok uuid; v_rows int; v_id uuid;
BEGIN
  v_req := public.request_v5_generation('bbbbbbbb-0000-0000-0000-000000000001', 'test');
  SELECT lease_token INTO v_tok FROM (
    SELECT * FROM public.claim_v5_generation_requests(5, NULL)
  ) q LIMIT 1;

  SELECT count(*) INTO v_rows FROM public.building_tasks;
  SELECT id INTO v_id FROM public.commit_v5_generation_plan(v_req, v_tok, jsonb_build_object(
    'comercial_id','bbbbbbbb-0000-0000-0000-000000000001',
    'task_key','v5:v5.0.0:T1:aaaaaaaa-0000-0000-0000-000000000001:cccccccc-0000-0000-0000-000000000001:fp1',
    'task_code','T1','building_id','aaaaaaaa-0000-0000-0000-000000000001',
    'subject_type','owner','subject_id','cccccccc-0000-0000-0000-000000000001',
    'trigger_fingerprint','fp1','title','Investigar','eligibility_snapshot','{}'::jsonb,
    'mode_snapshot','{}'::jsonb,'starts_at', now()::text,'due_date',(now() + interval '3 days')::text,
    'justificacion','test'));
  IF v_id IS NOT NULL OR (SELECT count(*) FROM public.building_tasks) <> v_rows THEN
    RAISE EXCEPTION 'CASO 1 FAIL: con el flag OFF el motor escribió';
  END IF;
  RAISE NOTICE 'CASO 1 PASS: flag OFF => cero escrituras';
END
$c1$;

-- ---------------------------------------------------------------------
-- CASO 2: flag ON + canario => EXACTAMENTE una; el segundo intento, cero.
-- ---------------------------------------------------------------------
DO $c2$
DECLARE
  v_req uuid; v_tok uuid; v_id uuid; v_id2 uuid; v_plan jsonb;
  v_com uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
BEGIN
  UPDATE public.v5_runtime_config
     SET enabled = true, paused = false, config_review_required = false,
         canary_user_ids = ARRAY[v_com]
   WHERE id = 1;

  v_req := public.request_v5_generation(v_com, 'test');
  SELECT lease_token INTO v_tok FROM public.claim_v5_generation_requests(5, ARRAY[v_com]);

  v_plan := jsonb_build_object(
    'comercial_id', v_com::text,
    'task_key','v5:v5.0.0:T1:aaaaaaaa-0000-0000-0000-000000000001:cccccccc-0000-0000-0000-000000000002:fp2',
    'task_code','T1','building_id','aaaaaaaa-0000-0000-0000-000000000001',
    'subject_type','owner','subject_id','cccccccc-0000-0000-0000-000000000002',
    'trigger_fingerprint','fp2','title','Investigar','eligibility_snapshot','{}'::jsonb,
    'mode_snapshot','{}'::jsonb,'starts_at', now()::text,'due_date',(now() + interval '3 days')::text,
    'justificacion','test');

  SELECT id INTO v_id FROM public.commit_v5_generation_plan(v_req, v_tok, v_plan);
  IF v_id IS NULL THEN RAISE EXCEPTION 'CASO 2 FAIL: el canario no generó'; END IF;

  -- Segundo worker con el MISMO lease (ya consumido) => cero.
  SELECT id INTO v_id2 FROM public.commit_v5_generation_plan(v_req, v_tok, v_plan);
  IF v_id2 IS NOT NULL THEN
    RAISE EXCEPTION 'CASO 2 FAIL: dos workers generaron dos tareas';
  END IF;
  IF (SELECT count(*) FROM public.building_tasks
       WHERE user_id = v_com AND generation_mode = 'production') <> 1 THEN
    RAISE EXCEPTION 'CASO 2 FAIL: más de una production para el comercial';
  END IF;
  RAISE NOTICE 'CASO 2 PASS: canario ON => exactamente una tarea';
END
$c2$;

-- ---------------------------------------------------------------------
-- CASO 3: comercial fuera del canario => cero.
-- ---------------------------------------------------------------------
DO $c3$
DECLARE
  v_req uuid; v_tok uuid; v_id uuid;
  v_com uuid := 'bbbbbbbb-0000-0000-0000-000000000003';
BEGIN
  v_req := public.request_v5_generation(v_com, 'test');
  SELECT lease_token INTO v_tok FROM public.claim_v5_generation_requests(5, ARRAY[v_com]);
  SELECT id INTO v_id FROM public.commit_v5_generation_plan(v_req, v_tok, jsonb_build_object(
    'comercial_id', v_com::text,
    'task_key','v5:v5.0.0:T4:aaaaaaaa-0000-0000-0000-000000000001:cccccccc-0000-0000-0000-000000000003:fp3',
    'task_code','T4','building_id','aaaaaaaa-0000-0000-0000-000000000001',
    'subject_type','owner','subject_id','cccccccc-0000-0000-0000-000000000003',
    'trigger_fingerprint','fp3','title','Cadencia','eligibility_snapshot','{}'::jsonb,
    'mode_snapshot','{}'::jsonb,'starts_at', now()::text,'due_date',(now() + interval '3 days')::text,
    'justificacion','test'));
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'CASO 3 FAIL: generó fuera del canario'; END IF;
  RAISE NOTICE 'CASO 3 PASS: fuera del canario => cero';
END
$c3$;

-- ---------------------------------------------------------------------
-- CASO 4: pausa => cero, aunque el flag esté ON.
-- ---------------------------------------------------------------------
DO $c4$
DECLARE
  v_req uuid; v_tok uuid; v_id uuid;
  v_com uuid := 'bbbbbbbb-0000-0000-0000-000000000004';
BEGIN
  UPDATE public.v5_runtime_config SET paused = true, canary_user_ids = NULL WHERE id = 1;
  v_req := public.request_v5_generation(v_com, 'test');
  SELECT lease_token INTO v_tok FROM public.claim_v5_generation_requests(5, ARRAY[v_com]);
  SELECT id INTO v_id FROM public.commit_v5_generation_plan(v_req, v_tok, jsonb_build_object(
    'comercial_id', v_com::text,
    'task_key','v5:v5.0.0:T5:aaaaaaaa-0000-0000-0000-000000000001:cccccccc-0000-0000-0000-000000000004:fp4',
    'task_code','T5','building_id','aaaaaaaa-0000-0000-0000-000000000001',
    'subject_type','owner','subject_id','cccccccc-0000-0000-0000-000000000004',
    'trigger_fingerprint','fp4','title','Ficha','eligibility_snapshot','{}'::jsonb,
    'mode_snapshot','{}'::jsonb,'starts_at', now()::text,'due_date',(now() + interval '3 days')::text,
    'justificacion','test'));
  IF v_id IS NOT NULL THEN RAISE EXCEPTION 'CASO 4 FAIL: generó en pausa'; END IF;
  UPDATE public.v5_runtime_config SET paused = false WHERE id = 1;
  RAISE NOTICE 'CASO 4 PASS: pausa => cero';
END
$c4$;

-- ---------------------------------------------------------------------
-- CASO 5: plan no canónico => excepción, nunca fila silenciosa.
-- ---------------------------------------------------------------------
DO $c5$
DECLARE
  v_req uuid; v_tok uuid;
  v_com uuid := 'bbbbbbbb-0000-0000-0000-000000000005';
BEGIN
  v_req := public.request_v5_generation(v_com, 'test');
  SELECT lease_token INTO v_tok FROM public.claim_v5_generation_requests(5, ARRAY[v_com]);
  BEGIN
    PERFORM public.commit_v5_generation_plan(v_req, v_tok, jsonb_build_object(
      'comercial_id', v_com::text,
      'task_key','v5:2026-08-10:T-02:x',   -- clave histórica: prohibida en production
      'task_code','T1','building_id','aaaaaaaa-0000-0000-0000-000000000001',
      'subject_type','owner','subject_id','cccccccc-0000-0000-0000-000000000005',
      'trigger_fingerprint','fp5','title','X','eligibility_snapshot','{}'::jsonb,
      'mode_snapshot','{}'::jsonb,'starts_at', now()::text,'due_date',(now() + interval '3 days')::text,
      'justificacion','test'));
    RAISE EXCEPTION 'CASO 5 FAIL: aceptó una clave histórica como production';
  EXCEPTION WHEN others THEN
    IF SQLERRM LIKE 'CASO 5 FAIL%' THEN RAISE; END IF;
    RAISE NOTICE 'CASO 5 PASS: clave no canónica rechazada (%)', left(SQLERRM, 60);
  END;
END
$c5$;

-- ---------------------------------------------------------------------
-- CASO 6: el histórico legacy NO ocupa slot ni es generable.
-- ---------------------------------------------------------------------
DO $c6$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM public.building_tasks
   WHERE task_key ~ '^v5:\d{4}-\d{2}-\d{2}:T-0[1-9]:'
     AND generation_mode = 'legacy';
  IF v_n < 1 THEN RAISE EXCEPTION 'CASO 6 FAIL: no hay histórico legacy'; END IF;
  IF EXISTS (SELECT 1 FROM public.building_tasks
              WHERE task_key ~ '^v5:\d{4}-\d{2}-\d{2}:T-0[1-9]:'
                AND generation_mode = 'production') THEN
    RAISE EXCEPTION 'CASO 6 FAIL: histórico marcado como production';
  END IF;
  RAISE NOTICE 'CASO 6 PASS: histórico legacy visible y no generable (% filas)', v_n;
END
$c6$;

-- ---------------------------------------------------------------------
-- CASO 7: reaper recupera SÓLO leases caducados y no genera nada.
-- ---------------------------------------------------------------------
DO $c7$
DECLARE v_req uuid; v_tok uuid; v_n int; v_tasks int;
  v_com uuid := 'bbbbbbbb-0000-0000-0000-000000000007';
BEGIN
  v_req := public.request_v5_generation(v_com, 'test');
  SELECT lease_token INTO v_tok FROM public.claim_v5_generation_requests(5, ARRAY[v_com]);
  SELECT count(*) INTO v_tasks FROM public.building_tasks;
  IF public.reap_v5_generation_leases() <> 0 THEN
    RAISE EXCEPTION 'CASO 7 FAIL: recuperó un lease vivo';
  END IF;
  UPDATE public.v5_generation_requests SET lease_expires_at = now() - interval '1 hour' WHERE id = v_req;
  v_n := public.reap_v5_generation_leases();
  IF v_n <> 1 THEN RAISE EXCEPTION 'CASO 7 FAIL: no recuperó el lease caducado'; END IF;
  IF (SELECT count(*) FROM public.building_tasks) <> v_tasks THEN
    RAISE EXCEPTION 'CASO 7 FAIL: el reaper generó tareas';
  END IF;
  RAISE NOTICE 'CASO 7 PASS: reaper sólo recupera, nunca genera';
END
$c7$;

-- ---------------------------------------------------------------------
-- CASO 8: una única solicitud viva por comercial (reposición idempotente).
-- ---------------------------------------------------------------------
DO $c8$
DECLARE a uuid; b uuid;
  v_com uuid := 'bbbbbbbb-0000-0000-0000-000000000008';
BEGIN
  a := public.request_v5_generation(v_com, 'cierre:completed');
  b := public.request_v5_generation(v_com, 'cierre:skipped');
  IF a <> b THEN RAISE EXCEPTION 'CASO 8 FAIL: se duplicó la solicitud de reposición'; END IF;
  RAISE NOTICE 'CASO 8 PASS: reposición idempotente (una solicitud viva)';
END
$c8$;

ROLLBACK;
