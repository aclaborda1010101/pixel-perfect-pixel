-- =====================================================================
-- SALES MANAGER — FASE B (migración FORWARD, PENDIENTE DE APLICAR)
-- =====================================================================
-- Esta migración NO se ha aplicado. Es idempotente y sólo avanza:
-- no reescribe migraciones históricas ni borra datos.
--
-- Contenido:
--   1. profiles.must_change_password / building_tasks.started_at
--   2. Índices para métricas
--   3. sales_manager_team_members
--   4. Modos de reparto de tareas (catálogo, pesos, modo activo, auditoría)
--   5. current_user_role() con prioridad explícita
--   6. RPC SECURITY DEFINER del panel (agregados, config, arranque de tarea)
--   7. RLS mínima para el gestor
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Guardas de entorno: si falta el rol sales_manager, abortar claro.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    RAISE EXCEPTION 'Falta el tipo enum public.app_role: aborta la migración sales_manager.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'sales_manager'
  ) THEN
    RAISE EXCEPTION 'El enum public.app_role no contiene el valor sales_manager: aborta la migración.';
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Columnas nuevas
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- started_at queda NULL en el histórico a propósito: no se inventan valores.
ALTER TABLE public.building_tasks
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL;

COMMENT ON COLUMN public.building_tasks.started_at IS
  'Inicio REAL de la tarea (acción "Empezar"). NULL en el histórico anterior a esta migración: esas tareas no computan duración.';

-- ---------------------------------------------------------------------
-- 2. Índices para las métricas del panel
-- ---------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS building_tasks_user_created_idx
  ON public.building_tasks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS building_tasks_user_completed_idx
  ON public.building_tasks (user_id, completed_at DESC);
CREATE INDEX IF NOT EXISTS building_tasks_user_status_idx
  ON public.building_tasks (user_id, status);
CREATE INDEX IF NOT EXISTS building_tasks_user_due_idx
  ON public.building_tasks (user_id, due_date);
CREATE INDEX IF NOT EXISTS building_tasks_started_idx
  ON public.building_tasks (started_at) WHERE started_at IS NOT NULL;

-- ---------------------------------------------------------------------
-- 3. Equipo del gestor comercial
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_manager_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL,
  member_id  uuid NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (manager_id, member_id)
);

GRANT SELECT ON public.sales_manager_team_members TO authenticated;
GRANT ALL    ON public.sales_manager_team_members TO service_role;
ALTER TABLE public.sales_manager_team_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS smtm_manager_reads_own ON public.sales_manager_team_members;
CREATE POLICY smtm_manager_reads_own ON public.sales_manager_team_members
  FOR SELECT TO authenticated
  USING (manager_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS smtm_admin_writes ON public.sales_manager_team_members;
CREATE POLICY smtm_admin_writes ON public.sales_manager_team_members
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------
-- 4. Modos de reparto de tareas
-- ---------------------------------------------------------------------
-- Grupos estables. T-02 y T-03 forman un ÚNICO grupo. T-07 está deshabilitada.
CREATE TABLE IF NOT EXISTS public.sales_task_groups (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  members    text[] NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.sales_task_groups (code, label, members, enabled, sort_order) VALUES
  ('T1',    'T-01 Primer contacto',        ARRAY['T-01'],          true,  1),
  ('T2_T3', 'T-02 + T-03 Seguimiento',     ARRAY['T-02','T-03'],   true,  2),
  ('T4',    'T-04 Reactivación',           ARRAY['T-04'],          true,  3),
  ('T5',    'T-05 Perfilado',              ARRAY['T-05'],          true,  4),
  ('T6',    'T-06 Incidencia registral',   ARRAY['T-06'],          true,  5),
  ('T7',    'T-07 (deshabilitada)',        ARRAY['T-07'],          false, 6),
  ('T8',    'T-08 Oportunidad caliente',   ARRAY['T-08'],          true,  7),
  ('T9',    'T-09 Edificio',               ARRAY['T-09'],          true,  8)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, members = EXCLUDED.members,
      enabled = EXCLUDED.enabled, sort_order = EXCLUDED.sort_order;

GRANT SELECT ON public.sales_task_groups TO authenticated;
GRANT ALL    ON public.sales_task_groups TO service_role;
ALTER TABLE public.sales_task_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stg_read ON public.sales_task_groups;
CREATE POLICY stg_read ON public.sales_task_groups FOR SELECT TO authenticated USING (true);

-- Catálogo de modos. `follows_engine_default` = no lleva pesos propios:
-- el reparto es el que ya produce el motor V5 hoy (no se inventan porcentajes).
CREATE TABLE IF NOT EXISTS public.sales_task_modes (
  code                  text PRIMARY KEY,
  label                 text NOT NULL,
  description           text,
  follows_engine_default boolean NOT NULL DEFAULT false,
  requires_weights      boolean NOT NULL DEFAULT true,
  sort_order            int NOT NULL DEFAULT 0
);

INSERT INTO public.sales_task_modes (code, label, description, follows_engine_default, requires_weights, sort_order) VALUES
  ('equilibrado',           'Equilibrado',            'Reparto actual del motor V5 (cobertura de catálogo + prioridad). No define porcentajes propios.', true,  false, 1),
  ('iniciar_conversaciones','Iniciar conversaciones', 'Prioriza primer contacto. Requiere guardar pesos válidos antes de activarse.',                    false, true,  2),
  ('seguimiento',           'Seguimiento',            'Prioriza seguimiento y reactivación. Requiere guardar pesos válidos antes de activarse.',         false, true,  3),
  ('manual',                'Manual',                 'Pesos definidos a mano por el gestor. Requiere guardar pesos válidos antes de activarse.',        false, true,  4)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description,
      follows_engine_default = EXCLUDED.follows_engine_default,
      requires_weights = EXCLUDED.requires_weights, sort_order = EXCLUDED.sort_order;

GRANT SELECT ON public.sales_task_modes TO authenticated;
GRANT ALL    ON public.sales_task_modes TO service_role;
ALTER TABLE public.sales_task_modes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stm_read ON public.sales_task_modes;
CREATE POLICY stm_read ON public.sales_task_modes FOR SELECT TO authenticated USING (true);

-- Pesos por modo y grupo. NO se siembran valores: hasta que el gestor guarde
-- una configuración válida (suma exacta 100) el modo no puede activarse.
CREATE TABLE IF NOT EXISTS public.sales_task_mode_weights (
  mode_code  text NOT NULL REFERENCES public.sales_task_modes(code) ON DELETE CASCADE,
  group_code text NOT NULL REFERENCES public.sales_task_groups(code) ON DELETE CASCADE,
  weight     int  NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  PRIMARY KEY (mode_code, group_code),
  CONSTRAINT sales_task_mode_weights_range_chk CHECK (weight >= 0 AND weight <= 100)
);

GRANT SELECT ON public.sales_task_mode_weights TO authenticated;
GRANT ALL    ON public.sales_task_mode_weights TO service_role;
ALTER TABLE public.sales_task_mode_weights ENABLE ROW LEVEL SECURITY;
-- Sin políticas de escritura: la configuración SÓLO se cambia por RPC.
DROP POLICY IF EXISTS stmw_read ON public.sales_task_mode_weights;
CREATE POLICY stmw_read ON public.sales_task_mode_weights
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager'));

-- T-07 siempre a 0 y nunca activable: trigger de validación (no CHECK inmutable).
CREATE OR REPLACE FUNCTION public.sales_task_mode_weights_validate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE v_enabled boolean;
BEGIN
  SELECT enabled INTO v_enabled FROM public.sales_task_groups WHERE code = NEW.group_code;
  IF v_enabled IS DISTINCT FROM true AND NEW.weight <> 0 THEN
    RAISE EXCEPTION 'El grupo % está deshabilitado: su peso debe ser 0', NEW.group_code;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sales_task_mode_weights_validate_trg ON public.sales_task_mode_weights;
CREATE TRIGGER sales_task_mode_weights_validate_trg
  BEFORE INSERT OR UPDATE ON public.sales_task_mode_weights
  FOR EACH ROW EXECUTE FUNCTION public.sales_task_mode_weights_validate();

-- Modo activo global (fila única) y override por comercial.
CREATE TABLE IF NOT EXISTS public.sales_task_mode_active (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode_code  text NOT NULL REFERENCES public.sales_task_modes(code),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);
INSERT INTO public.sales_task_mode_active (singleton, mode_code)
VALUES (true, 'equilibrado')
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.sales_task_mode_overrides (
  user_id    uuid PRIMARY KEY,
  mode_code  text NOT NULL REFERENCES public.sales_task_modes(code),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);

CREATE TABLE IF NOT EXISTS public.sales_task_mode_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid NULL,
  scope       text NOT NULL CHECK (scope IN ('global','user')),
  target_user uuid NULL,
  mode_code   text NOT NULL,
  weights     jsonb NOT NULL DEFAULT '{}'::jsonb,
  note        text NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.sales_task_mode_active, public.sales_task_mode_overrides, public.sales_task_mode_audit TO authenticated;
GRANT ALL    ON public.sales_task_mode_active, public.sales_task_mode_overrides, public.sales_task_mode_audit TO service_role;
ALTER TABLE public.sales_task_mode_active    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_task_mode_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_task_mode_audit     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stma_read ON public.sales_task_mode_active;
CREATE POLICY stma_read ON public.sales_task_mode_active FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager'));
DROP POLICY IF EXISTS stmo_read ON public.sales_task_mode_overrides;
CREATE POLICY stmo_read ON public.sales_task_mode_overrides FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager') OR user_id = auth.uid());
DROP POLICY IF EXISTS stmau_read ON public.sales_task_mode_audit;
CREATE POLICY stmau_read ON public.sales_task_mode_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager'));

-- ---------------------------------------------------------------------
-- 5. current_user_role() con prioridad explícita
--    admin > sales_manager > operativos > viewer.
--    No se asume que ningún trigger elimine 'viewer'.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ur.role::text
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      ORDER BY CASE ur.role::text
        WHEN 'admin'           THEN 0
        WHEN 'sales_manager'   THEN 1
        WHEN 'comercial_zona'  THEN 2
        WHEN 'captacion'       THEN 3
        WHEN 'prevalificacion' THEN 4
        WHEN 'whatsapp'        THEN 5
        WHEN 'viewer'          THEN 9
        ELSE 8
      END
      LIMIT 1
    ),
    'viewer'
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- ---------------------------------------------------------------------
-- 6. Helpers de autorización
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_sales_manager_or_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_uid, 'admin') OR public.has_role(_uid, 'sales_manager');
$$;

CREATE OR REPLACE FUNCTION public.sales_manager_can_see(_manager uuid, _member uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_manager, 'admin')
      OR EXISTS (
        SELECT 1 FROM public.sales_manager_team_members t
        WHERE t.manager_id = _manager AND t.member_id = _member AND t.active
      );
$$;

REVOKE ALL ON FUNCTION public.is_sales_manager_or_admin(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.sales_manager_can_see(uuid, uuid) FROM anon;

-- ---------------------------------------------------------------------
-- 6b. RPC del panel: SÓLO agregados. Nunca títulos, descripciones,
--     edificios, propietarios ni transcripciones.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_manager_dashboard(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rows jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_manager_or_admin(v_uid) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'intervalo inválido' USING ERRCODE = '22023';
  END IF;

  WITH team AS (
    SELECT t.member_id AS user_id
    FROM public.sales_manager_team_members t
    WHERE t.manager_id = v_uid AND t.active
    UNION
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE public.has_role(v_uid, 'admin')
      AND ur.role::text IN ('comercial_zona','captacion','prevalificacion')
  ),
  -- Intervalo semiabierto [p_from, p_to)
  base AS (
    SELECT
      bt.user_id,
      bt.status,
      bt.task_key,
      bt.task_type,
      bt.created_at,
      bt.started_at,
      bt.completed_at,
      bt.due_date,
      CASE
        WHEN bt.task_key LIKE 'v5:%' THEN split_part(bt.task_key, ':', 3)
        ELSE NULL
      END AS task_code
    FROM public.building_tasks bt
    JOIN team ON team.user_id = bt.user_id
    WHERE bt.created_at >= p_from AND bt.created_at < p_to
      AND (bt.task_type = 'manual' OR bt.task_key LIKE 'v5:%')
  ),
  dur AS (
    SELECT user_id,
           EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0 AS horas
    FROM base
    WHERE started_at IS NOT NULL AND completed_at IS NOT NULL AND completed_at >= started_at
  ),
  agg AS (
    SELECT
      b.user_id,
      COUNT(*)                                                        AS creadas,
      COUNT(*) FILTER (WHERE b.status = 'completed')                  AS completadas,
      COUNT(*) FILTER (WHERE b.status = 'pending')                    AS pending,
      COUNT(*) FILTER (WHERE b.status = 'in_progress')                AS in_progress,
      COUNT(*) FILTER (WHERE b.status = 'blocked')                    AS blocked,
      COUNT(*) FILTER (WHERE b.status IN ('skipped','no_procede'))    AS skipped,
      COUNT(*) FILTER (WHERE b.status NOT IN
        ('completed','pending','in_progress','blocked','skipped','no_procede')) AS unknown,
      COUNT(*) FILTER (
        WHERE b.status NOT IN ('completed','skipped','no_procede')
          AND b.due_date IS NOT NULL AND b.due_date < now()
      )                                                               AS vencidas,
      COUNT(*) FILTER (WHERE b.completed_at IS NOT NULL AND b.due_date IS NOT NULL) AS con_plazo,
      COUNT(*) FILTER (
        WHERE b.completed_at IS NOT NULL AND b.due_date IS NOT NULL
          AND b.completed_at <= b.due_date
      )                                                               AS en_plazo,
      COUNT(*) FILTER (WHERE b.started_at IS NOT NULL)                AS con_inicio
    FROM base b
    GROUP BY b.user_id
  ),
  mix AS (
    SELECT b.user_id,
           jsonb_object_agg(COALESCE(g.code, COALESCE(b.task_code, 'manual')), n ORDER BY COALESCE(g.code, 'zz')) AS mezcla
    FROM (
      SELECT user_id, task_code, COUNT(*) AS n
      FROM base GROUP BY user_id, task_code
    ) b
    LEFT JOIN public.sales_task_groups g ON b.task_code = ANY (g.members)
    GROUP BY b.user_id
  ),
  durstats AS (
    SELECT user_id,
           ROUND(AVG(horas)::numeric, 2) AS media_horas,
           ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY horas))::numeric, 2) AS mediana_horas,
           COUNT(*) AS muestra
    FROM dur GROUP BY user_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',        a.user_id,
    'full_name',      p.full_name,
    'creadas',        a.creadas,
    'completadas',    a.completadas,
    'pending',        a.pending,
    'in_progress',    a.in_progress,
    'blocked',        a.blocked,
    'skipped',        a.skipped,
    'unknown',        a.unknown,
    'vencidas',       a.vencidas,
    'con_plazo',      a.con_plazo,
    'en_plazo',       a.en_plazo,
    'con_inicio',     a.con_inicio,
    'cobertura_inicio_pct', CASE WHEN a.creadas > 0
                                 THEN ROUND(100.0 * a.con_inicio / a.creadas)::int ELSE NULL END,
    'media_horas',    d.media_horas,
    'mediana_horas',  d.mediana_horas,
    'muestra_duracion', COALESCE(d.muestra, 0),
    'mezcla',         COALESCE(m.mezcla, '{}'::jsonb)
  ) ORDER BY a.creadas DESC), '[]'::jsonb)
  INTO v_rows
  FROM agg a
  LEFT JOIN durstats d ON d.user_id = a.user_id
  LEFT JOIN mix m      ON m.user_id = a.user_id
  LEFT JOIN public.profiles p ON p.id = a.user_id;

  RETURN jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'generated_at', now(),
    'rows', v_rows
  );
END $$;

REVOKE ALL ON FUNCTION public.get_sales_manager_dashboard(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_manager_dashboard(timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------
-- 6c. Configuración de modos
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_task_mode_config()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_manager_or_admin(v_uid) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  RETURN jsonb_build_object(
    'groups', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'code', code, 'label', label, 'members', members, 'enabled', enabled
               ) ORDER BY sort_order), '[]'::jsonb) FROM public.sales_task_groups),
    'modes',  (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'code', m.code, 'label', m.label, 'description', m.description,
                 'follows_engine_default', m.follows_engine_default,
                 'requires_weights', m.requires_weights,
                 'weights', (SELECT COALESCE(jsonb_object_agg(w.group_code, w.weight), '{}'::jsonb)
                             FROM public.sales_task_mode_weights w WHERE w.mode_code = m.code)
               ) ORDER BY m.sort_order), '[]'::jsonb) FROM public.sales_task_modes m),
    'active', (SELECT jsonb_build_object('mode_code', mode_code, 'updated_at', updated_at, 'updated_by', updated_by)
               FROM public.sales_task_mode_active WHERE singleton),
    'overrides', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'user_id', user_id, 'mode_code', mode_code, 'updated_at', updated_at)), '[]'::jsonb)
               FROM public.sales_task_mode_overrides),
    'audit', (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'id', id, 'actor_id', actor_id, 'scope', scope, 'target_user', target_user,
                 'mode_code', mode_code, 'weights', weights, 'created_at', created_at
               ) ORDER BY created_at DESC), '[]'::jsonb)
               FROM (SELECT * FROM public.sales_task_mode_audit ORDER BY created_at DESC LIMIT 20) a)
  );
END $$;

REVOKE ALL ON FUNCTION public.get_sales_task_mode_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_task_mode_config() TO authenticated;

-- Guardado atómico: valida rango, grupos conocidos, T-07 = 0 y suma exacta 100.
-- Sólo afecta a tareas FUTURAS: no toca building_tasks.
CREATE OR REPLACE FUNCTION public.set_sales_task_mode(
  p_mode_code   text,
  p_weights     jsonb DEFAULT NULL,
  p_target_user uuid  DEFAULT NULL,
  p_activate    boolean DEFAULT true,
  p_note        text  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_mode public.sales_task_modes%ROWTYPE;
  v_sum  int := 0;
  v_key  text;
  v_val  jsonb;
  v_w    int;
  v_enabled boolean;
  v_has_weights boolean;
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_manager_or_admin(v_uid) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mode FROM public.sales_task_modes WHERE code = p_mode_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'modo desconocido: %', p_mode_code USING ERRCODE = '22023';
  END IF;

  IF p_weights IS NOT NULL AND jsonb_typeof(p_weights) = 'object' THEN
    IF v_mode.follows_engine_default THEN
      RAISE EXCEPTION 'el modo % sigue el reparto del motor y no admite pesos', p_mode_code USING ERRCODE = '22023';
    END IF;
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_weights) LOOP
      SELECT enabled INTO v_enabled FROM public.sales_task_groups WHERE code = v_key;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'grupo desconocido: %', v_key USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_val) <> 'number' THEN
        RAISE EXCEPTION 'peso no numérico en %', v_key USING ERRCODE = '22023';
      END IF;
      v_w := (v_val#>>'{}')::numeric::int;
      IF v_w < 0 OR v_w > 100 THEN
        RAISE EXCEPTION 'peso fuera de rango 0..100 en %: %', v_key, v_w USING ERRCODE = '22023';
      END IF;
      IF v_enabled IS DISTINCT FROM true AND v_w <> 0 THEN
        RAISE EXCEPTION 'el grupo % está deshabilitado y su peso debe ser 0', v_key USING ERRCODE = '22023';
      END IF;
      v_sum := v_sum + v_w;
    END LOOP;

    IF v_sum <> 100 THEN
      RAISE EXCEPTION 'la suma de pesos debe ser exactamente 100 (recibido %)', v_sum USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.sales_task_mode_weights WHERE mode_code = p_mode_code;
    INSERT INTO public.sales_task_mode_weights (mode_code, group_code, weight, updated_by)
    SELECT p_mode_code, k, (v#>>'{}')::numeric::int, v_uid FROM jsonb_each(p_weights) AS e(k, v);
  END IF;

  IF p_activate THEN
    SELECT EXISTS (SELECT 1 FROM public.sales_task_mode_weights WHERE mode_code = p_mode_code)
      INTO v_has_weights;
    IF v_mode.requires_weights AND NOT v_has_weights THEN
      RAISE EXCEPTION 'el modo % no puede activarse sin pesos válidos guardados', p_mode_code USING ERRCODE = '22023';
    END IF;

    IF p_target_user IS NULL THEN
      UPDATE public.sales_task_mode_active
         SET mode_code = p_mode_code, updated_at = now(), updated_by = v_uid
       WHERE singleton;
    ELSE
      IF NOT public.sales_manager_can_see(v_uid, p_target_user) THEN
        RAISE EXCEPTION 'comercial fuera de tu equipo' USING ERRCODE = '42501';
      END IF;
      INSERT INTO public.sales_task_mode_overrides (user_id, mode_code, updated_by)
      VALUES (p_target_user, p_mode_code, v_uid)
      ON CONFLICT (user_id) DO UPDATE
        SET mode_code = EXCLUDED.mode_code, updated_at = now(), updated_by = v_uid;
    END IF;
  END IF;

  INSERT INTO public.sales_task_mode_audit (actor_id, scope, target_user, mode_code, weights, note)
  VALUES (v_uid,
          CASE WHEN p_target_user IS NULL THEN 'global' ELSE 'user' END,
          p_target_user, p_mode_code, COALESCE(p_weights, '{}'::jsonb), p_note);

  RETURN jsonb_build_object('ok', true, 'mode_code', p_mode_code,
                            'applies_to', 'tareas_futuras',
                            'scope', CASE WHEN p_target_user IS NULL THEN 'global' ELSE 'user' END);
END $$;

REVOKE ALL ON FUNCTION public.set_sales_task_mode(text, jsonb, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sales_task_mode(text, jsonb, uuid, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6d. Arranque de tarea: idempotente y sólo para el comercial propietario.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_building_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.building_tasks%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'la tarea no te pertenece' USING ERRCODE = '42501';
  END IF;

  -- Idempotente: started_at sólo se fija si es NULL.
  UPDATE public.building_tasks
     SET started_at = COALESCE(started_at, now()),
         status = CASE WHEN status = 'pending' THEN 'in_progress' ELSE status END
   WHERE id = p_task_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id,
                            'status', v_row.status, 'started_at', v_row.started_at);
END $$;

REVOKE ALL ON FUNCTION public.start_building_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_building_task(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6e. Operación de servicio: finalizar alta de un gestor YA creado en Auth.
--     Transaccional: perfil + rol + equipo. No crea usuarios.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_sales_manager_setup(
  p_user_id   uuid,
  p_full_name text,
  p_members   uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  -- Sólo admin autenticado o service_role (auth.uid() NULL).
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id requerido' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.profiles (id, full_name, must_change_password)
  VALUES (p_user_id, p_full_name, true)
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        must_change_password = true;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, 'sales_manager')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.sales_manager_team_members (manager_id, member_id)
  SELECT p_user_id, m FROM unnest(COALESCE(p_members, '{}'::uuid[])) AS m
  ON CONFLICT (manager_id, member_id) DO UPDATE SET active = true, updated_at = now();

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id,
                            'members', COALESCE(array_length(p_members, 1), 0));
END $$;

REVOKE ALL ON FUNCTION public.finalize_sales_manager_setup(uuid, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sales_manager_setup(uuid, text, uuid[]) TO service_role;

-- ---------------------------------------------------------------------
-- 7. RLS mínima para el gestor
--    NO se concede SELECT global sobre building_tasks a sales_manager.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_sales_manager_min ON public.profiles;
CREATE POLICY profiles_sales_manager_min ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR (
      public.has_role(auth.uid(), 'sales_manager')
      AND EXISTS (
        SELECT 1 FROM public.sales_manager_team_members t
        WHERE t.manager_id = auth.uid() AND t.member_id = public.profiles.id AND t.active
      )
    )
  );

DROP POLICY IF EXISTS user_roles_self_read ON public.user_roles;
CREATE POLICY user_roles_self_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- El usuario normal NO puede quitarse must_change_password vía profiles.update.
DROP POLICY IF EXISTS profiles_self_update_safe ON public.profiles;
CREATE POLICY profiles_self_update_safe ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

CREATE OR REPLACE FUNCTION public.profiles_guard_must_change_password()
RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NEW.must_change_password IS DISTINCT FROM OLD.must_change_password THEN
    NEW.must_change_password := OLD.must_change_password;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_guard_must_change_password_trg ON public.profiles;
CREATE TRIGGER profiles_guard_must_change_password_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_must_change_password();

COMMIT;
