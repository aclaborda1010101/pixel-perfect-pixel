-- =====================================================================
-- SALES MANAGER — FASE B (migración FORWARD, PENDIENTE DE APLICAR)
-- =====================================================================
-- NO aplicada. Idempotente y sólo hacia delante: no reescribe migraciones
-- históricas ni borra datos operativos. Sin SQL dinámico en ningún punto.
--
--   1. Columnas (must_change_password, started_at) e índices
--   2. Equipo del gestor (FK ON DELETE CASCADE, manager <> member)
--   3. Catálogo de modos, pesos, modo activo y auditoría
--   4. current_user_role() -> public.app_role con prioridad explícita
--   5. Helpers internos (INACCESIBLES para anon/authenticated/PUBLIC)
--   6. RPC del panel: agregados, config, arranque de tarea, alta de gestor
--   7. RLS efectiva: se ELIMINAN las políticas permisivas históricas
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Guardas de entorno
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
-- 1. Columnas nuevas e índices
-- ---------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

-- started_at queda NULL en el histórico a propósito: no se inventan valores.
ALTER TABLE public.building_tasks
  ADD COLUMN IF NOT EXISTS started_at timestamptz NULL;

COMMENT ON COLUMN public.building_tasks.started_at IS
  'Inicio REAL de la tarea (acción "Empezar"). NULL en el histórico anterior: esas tareas no computan duración.';

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
-- 2. Equipo del gestor comercial
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_manager_team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  member_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active     boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smtm_manager_ne_member CHECK (manager_id <> member_id),
  UNIQUE (manager_id, member_id)
);

-- Reparación idempotente si la tabla ya existía sin las garantías.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smtm_manager_ne_member') THEN
    ALTER TABLE public.sales_manager_team_members
      ADD CONSTRAINT smtm_manager_ne_member CHECK (manager_id <> member_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smtm_manager_fk') THEN
    ALTER TABLE public.sales_manager_team_members
      ADD CONSTRAINT smtm_manager_fk FOREIGN KEY (manager_id)
      REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'smtm_member_fk') THEN
    ALTER TABLE public.sales_manager_team_members
      ADD CONSTRAINT smtm_member_fk FOREIGN KEY (member_id)
      REFERENCES public.profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

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
-- 3. Modos de reparto
--    Los grupos son el catálogo V5 canónico (T2_T3 único, T7 deshabilitada).
--    Los textos de negocio NO están versionados: se guarda el código y la
--    marca "pendiente validar". No se inventan etiquetas.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sales_task_groups (
  code       text PRIMARY KEY,
  label      text NOT NULL,
  members    text[] NOT NULL,
  enabled    boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0
);

INSERT INTO public.sales_task_groups (code, label, members, enabled, sort_order) VALUES
  ('T1',    'T1 (pendiente validar)',                 ARRAY['T-01'],        true,  1),
  ('T2_T3', 'T2_T3 (pendiente validar)',              ARRAY['T-02','T-03'], true,  2),
  ('T4',    'T4 (pendiente validar)',                 ARRAY['T-04'],        true,  3),
  ('T5',    'T5 (pendiente validar)',                 ARRAY['T-05'],        true,  4),
  ('T6',    'T6 (pendiente validar)',                 ARRAY['T-06'],        true,  5),
  ('T7',    'T7 (deshabilitada, pendiente validar)',  ARRAY['T-07'],        false, 6),
  ('T8',    'T8 (pendiente validar)',                 ARRAY['T-08'],        true,  7),
  ('T9',    'T9 (pendiente validar)',                 ARRAY['T-09'],        true,  8)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, members = EXCLUDED.members,
      enabled = EXCLUDED.enabled, sort_order = EXCLUDED.sort_order;

GRANT SELECT ON public.sales_task_groups TO authenticated;
GRANT ALL    ON public.sales_task_groups TO service_role;
ALTER TABLE public.sales_task_groups ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stg_read ON public.sales_task_groups;
CREATE POLICY stg_read ON public.sales_task_groups FOR SELECT TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.sales_task_modes (
  code                   text PRIMARY KEY,
  label                  text NOT NULL,
  description            text,
  follows_engine_default boolean NOT NULL DEFAULT false,
  requires_weights       boolean NOT NULL DEFAULT true,
  sort_order             int NOT NULL DEFAULT 0
);

INSERT INTO public.sales_task_modes (code, label, description, follows_engine_default, requires_weights, sort_order) VALUES
  ('equilibrado',           'Equilibrado',            'Genera tareas automáticas. Porcentajes definidos en el panel.', false, true, 1),
  ('iniciar_conversaciones','Iniciar conversaciones', 'Genera tareas automáticas. Requiere mapa completo y válido.',   false, true, 2),
  ('seguimiento',           'Seguimiento',            'Genera tareas automáticas. Requiere mapa completo y válido.',   false, true, 3),
  ('manual',                'Manual (personalizado)', 'Porcentajes a mano. TAMBIÉN genera automáticas: no es pausa.',  false, true, 4)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description,
      follows_engine_default = EXCLUDED.follows_engine_default,
      requires_weights = EXCLUDED.requires_weights, sort_order = EXCLUDED.sort_order;

GRANT SELECT ON public.sales_task_modes TO authenticated;
GRANT ALL    ON public.sales_task_modes TO service_role;
ALTER TABLE public.sales_task_modes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stm_read ON public.sales_task_modes;
CREATE POLICY stm_read ON public.sales_task_modes FOR SELECT TO authenticated USING (true);

-- Pesos por modo y grupo. NO se siembran valores.
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
DROP POLICY IF EXISTS stmw_read ON public.sales_task_mode_weights;
CREATE POLICY stmw_read ON public.sales_task_mode_weights
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'sales_manager'));

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

CREATE TABLE IF NOT EXISTS public.sales_task_mode_active (
  singleton  boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  mode_code  text NOT NULL REFERENCES public.sales_task_modes(code),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);
INSERT INTO public.sales_task_mode_active (singleton, mode_code)
VALUES (true, 'equilibrado')
ON CONFLICT (singleton) DO NOTHING;

-- Pausa de generación automática: interruptor SEPARADO del modo, OFF y
-- todavía NO consumido por el motor (Fase C).
ALTER TABLE public.sales_task_mode_active
  ADD COLUMN IF NOT EXISTS generation_paused boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.sales_task_mode_active.generation_paused IS
  'Pausa de la generación automática. Independiente del modo. Modelo declarado, aún no conectado al motor.';

CREATE TABLE IF NOT EXISTS public.sales_task_mode_overrides (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
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
-- 4. current_user_role(): MANTIENE RETURNS public.app_role
--    Prioridad admin > sales_manager > operativos > viewer.
--    Fallback explícito 'viewer'::public.app_role. Sin SQL dinámico.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      ORDER BY CASE ur.role
        WHEN 'admin'::public.app_role           THEN 0
        WHEN 'sales_manager'::public.app_role   THEN 1
        WHEN 'manager'::public.app_role         THEN 2
        WHEN 'agent'::public.app_role           THEN 3
        WHEN 'comercial_zona'::public.app_role  THEN 4
        WHEN 'captacion'::public.app_role       THEN 5
        WHEN 'prevalificacion'::public.app_role THEN 6
        WHEN 'whatsapp'::public.app_role        THEN 7
        WHEN 'viewer'::public.app_role          THEN 9
        ELSE 8
      END
      LIMIT 1
    ),
    'viewer'::public.app_role
  );
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- ---------------------------------------------------------------------
-- 4b. current_user_has_role(role): ÚNICO comprobador de rol para cliente y
--     para políticas nuevas. Fija auth.uid() internamente y NO acepta
--     user_id: es imposible preguntar por el rol de un tercero.
--     has_role(_user_id, _role) permanece intacto para no romper las
--     políticas históricas (ver migración de bloqueo BLOCKED_*_has_role_lockdown).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_user_has_role(_role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.user_roles ur
       WHERE ur.user_id = auth.uid() AND ur.role = _role
     );
$$;

REVOKE ALL ON FUNCTION public.current_user_has_role(public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_role(public.app_role) TO service_role;

-- ---------------------------------------------------------------------
-- 4c. Validación de OTROS usuarios desde RPC SECURITY DEFINER:
--     consulta interna a user_roles con permisos fijos. No devuelve listas
--     ni permite enumerar: responde sólo sí/no sobre un miembro concreto
--     y exige que el llamante sea admin o su gestor.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.internal_member_has_role(_member uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _member AND ur.role = _role
  );
$$;

REVOKE ALL ON FUNCTION public.internal_member_has_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.internal_member_has_role(uuid, public.app_role) TO service_role;

-- ---------------------------------------------------------------------
-- 5. Helpers INTERNOS: sólo los usan las RPC SECURITY DEFINER.
--    Nadie más puede ejecutarlos (ni PUBLIC, ni anon, ni authenticated).
--    Por eso las políticas RLS NO los invocan: usan EXISTS en línea.
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

REVOKE ALL ON FUNCTION public.is_sales_manager_or_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_manager_can_see(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sales_task_mode_weights_validate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_sales_manager_or_admin(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_manager_can_see(uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------
-- 6a. Panel del gestor: SÓLO agregados. Nunca títulos, descripciones,
--     edificios, propietarios ni transcripciones.
--
--     Separación estricta de ventanas:
--       * created_in_period   -> created_at   en [from, to)
--       * completed_in_period -> completed_at en [from, to)
--       * plazos y duraciones -> SOLO cierres del periodo
--       * estados actuales    -> SNAPSHOT de hoy, sin ventana temporal
--     El intervalo máximo permitido es de 31 días.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_sales_manager_dashboard(p_from timestamptz, p_to timestamptz)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_rows jsonb;
  v_now  timestamptz := now();
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_manager_or_admin(v_uid) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to <= p_from THEN
    RAISE EXCEPTION 'intervalo inválido' USING ERRCODE = '22023';
  END IF;
  IF p_to - p_from > interval '31 days' THEN
    RAISE EXCEPTION 'intervalo máximo 31 días' USING ERRCODE = '22023';
  END IF;

  WITH team AS (
    SELECT t.member_id AS user_id
    FROM public.sales_manager_team_members t
    WHERE t.manager_id = v_uid AND t.active
    UNION
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE public.has_role(v_uid, 'admin')
      AND ur.role IN ('comercial_zona'::public.app_role,
                      'captacion'::public.app_role,
                      'prevalificacion'::public.app_role)
  ),
  -- Universo de tareas del equipo, SIN ventana: cada métrica filtra la suya.
  universo AS (
    SELECT
      bt.user_id,
      bt.status,
      bt.created_at,
      bt.started_at,
      bt.completed_at,
      bt.due_date,
      CASE WHEN bt.task_key LIKE 'v5:%' THEN split_part(bt.task_key, ':', 3) ELSE NULL END AS task_code
    FROM public.building_tasks bt
    JOIN team ON team.user_id = bt.user_id
    WHERE bt.task_type = 'manual' OR bt.task_key LIKE 'v5:%'
  ),
  creadas AS (
    SELECT user_id, COUNT(*) AS n,
           COUNT(*) FILTER (WHERE started_at IS NOT NULL) AS con_inicio
    FROM universo
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY user_id
  ),
  cerradas AS (   -- cierres DEL PERIODO, con independencia de cuándo se crearon
    SELECT
      user_id,
      COUNT(*) AS n,
      COUNT(*) FILTER (WHERE due_date IS NOT NULL) AS con_plazo,
      COUNT(*) FILTER (WHERE due_date IS NOT NULL AND completed_at <= due_date) AS en_plazo,
      COUNT(*) FILTER (WHERE started_at IS NOT NULL AND completed_at >= started_at) AS con_duracion,
      ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0)
            FILTER (WHERE started_at IS NOT NULL AND completed_at >= started_at)::numeric, 2) AS media_horas,
      ROUND((PERCENTILE_CONT(0.5) WITHIN GROUP (
               ORDER BY EXTRACT(EPOCH FROM (completed_at - started_at)) / 3600.0
             ) FILTER (WHERE started_at IS NOT NULL AND completed_at >= started_at))::numeric, 2) AS mediana_horas
    FROM universo
    WHERE completed_at IS NOT NULL AND completed_at >= p_from AND completed_at < p_to
    GROUP BY user_id
  ),
  snapshot AS (   -- FOTO ACTUAL: no es histórico, no depende del periodo
    SELECT
      user_id,
      COUNT(*) FILTER (WHERE status = 'pending')                     AS pending,
      COUNT(*) FILTER (WHERE status = 'in_progress')                 AS in_progress,
      COUNT(*) FILTER (WHERE status = 'blocked')                     AS blocked,
      COUNT(*) FILTER (WHERE status IN ('skipped','no_procede'))     AS skipped,
      COUNT(*) FILTER (WHERE status = 'completed')                   AS completed,
      COUNT(*) FILTER (WHERE status NOT IN
        ('completed','pending','in_progress','blocked','skipped','no_procede')
        OR status IS NULL)                                           AS unknown,
      COUNT(*) FILTER (
        WHERE status NOT IN ('completed','skipped','no_procede')
          AND due_date IS NOT NULL AND due_date < v_now
      )                                                              AS vencidas_ahora
    FROM universo
    GROUP BY user_id
  ),
  -- T-02 y T-03 se SUMAN en su grupo ANTES de construir el json.
  mezcla_grupo AS (
    SELECT u.user_id,
           COALESCE(g.code, 'sin_codigo') AS grupo,
           COUNT(*) AS n
    FROM universo u
    LEFT JOIN public.sales_task_groups g
      ON u.task_code = g.code OR u.task_code = ANY (g.members)
    WHERE u.created_at >= p_from AND u.created_at < p_to
    GROUP BY u.user_id, COALESCE(g.code, 'sin_codigo')
  ),
  mix AS (
    SELECT user_id, jsonb_object_agg(grupo, n) AS mezcla
    FROM mezcla_grupo GROUP BY user_id
  )
  -- Se parte del EQUIPO: los miembros sin actividad aparecen con ceros.
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'full_name' NULLS LAST), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'user_id',              t.user_id,
      'full_name',            p.full_name,
      'created_in_period',    COALESCE(c.n, 0),
      'completed_in_period',  COALESCE(k.n, 0),
      'con_plazo',            COALESCE(k.con_plazo, 0),
      'en_plazo',             COALESCE(k.en_plazo, 0),
      'con_duracion',         COALESCE(k.con_duracion, 0),
      'media_horas',          k.media_horas,
      'mediana_horas',        k.mediana_horas,
      'cobertura_inicio_creadas', COALESCE(c.con_inicio, 0),
      'cobertura_inicio_pct', CASE WHEN COALESCE(c.n, 0) > 0
                                   THEN ROUND(100.0 * COALESCE(c.con_inicio, 0) / c.n)::int END,
      'cobertura_duracion_pct', CASE WHEN COALESCE(k.n, 0) > 0
                                   THEN ROUND(100.0 * COALESCE(k.con_duracion, 0) / k.n)::int END,
      'snapshot', jsonb_build_object(
        'pending',      COALESCE(s.pending, 0),
        'in_progress',  COALESCE(s.in_progress, 0),
        'blocked',      COALESCE(s.blocked, 0),
        'skipped',      COALESCE(s.skipped, 0),
        'completed',    COALESCE(s.completed, 0),
        'unknown',      COALESCE(s.unknown, 0),
        'vencidas_ahora', COALESCE(s.vencidas_ahora, 0),
        'as_of',        v_now
      ),
      'mezcla_creadas', COALESCE(m.mezcla, '{}'::jsonb)
    ) AS x
    FROM team t
    LEFT JOIN creadas  c ON c.user_id = t.user_id
    LEFT JOIN cerradas k ON k.user_id = t.user_id
    LEFT JOIN snapshot s ON s.user_id = t.user_id
    LEFT JOIN mix      m ON m.user_id = t.user_id
    LEFT JOIN public.profiles p ON p.id = t.user_id
  ) q;

  RETURN jsonb_build_object(
    'from', p_from,
    'to',   p_to,
    'generated_at', v_now,
    'rows', v_rows
  );
END $$;

REVOKE ALL ON FUNCTION public.get_sales_manager_dashboard(timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_sales_manager_dashboard(timestamptz, timestamptz) TO authenticated;

-- ---------------------------------------------------------------------
-- 6b. Configuración de modos
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

-- Guardado atómico. Exige la configuración COMPLETA: todos los grupos
-- habilitados presentes, T7 presente con 0, sin extras, enteros estrictos y
-- suma exacta 100. Al ACTIVAR se REVALIDA lo persistido.
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
  v_missing text;
  v_saved_sum int;
  v_saved_missing text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_sales_manager_or_admin(v_uid) THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_mode FROM public.sales_task_modes WHERE code = p_mode_code;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'modo desconocido: %', p_mode_code USING ERRCODE = '22023';
  END IF;

  -- p_weights DEBE ser un objeto: null, array, string o escalar => rechazo.
  -- Cada guardado o activación revalida el mapa SUMINISTRADO: nunca se
  -- reutilizan en silencio pesos antiguos.
  IF p_weights IS NULL OR jsonb_typeof(p_weights) <> 'object' THEN
    RAISE EXCEPTION 'p_weights debe ser un objeto con los pesos completos (recibido: %)',
      COALESCE(jsonb_typeof(p_weights), 'null') USING ERRCODE = '22023';
  END IF;

  IF true THEN
    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_weights) LOOP
      SELECT enabled INTO v_enabled FROM public.sales_task_groups WHERE code = v_key;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'grupo desconocido: %', v_key USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v_val) <> 'number' THEN
        RAISE EXCEPTION 'peso no numérico en %', v_key USING ERRCODE = '22023';
      END IF;
      -- Entero ESTRICTO: 33.5 se rechaza, no se redondea.
      IF (v_val#>>'{}')::numeric <> trunc((v_val#>>'{}')::numeric) THEN
        RAISE EXCEPTION 'peso no entero en %: %', v_key, (v_val#>>'{}') USING ERRCODE = '22023';
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

    -- TODOS los grupos deben estar declarados (incluida T7 con 0).
    SELECT string_agg(g.code, ', ' ORDER BY g.sort_order) INTO v_missing
    FROM public.sales_task_groups g
    WHERE NOT (p_weights ? g.code);
    IF v_missing IS NOT NULL THEN
      RAISE EXCEPTION 'faltan grupos en la configuración: %', v_missing USING ERRCODE = '22023';
    END IF;

    IF v_sum <> 100 THEN
      RAISE EXCEPTION 'la suma de pesos debe ser exactamente 100 (recibido %)', v_sum USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.sales_task_mode_weights WHERE mode_code = p_mode_code;
    INSERT INTO public.sales_task_mode_weights (mode_code, group_code, weight, updated_by)
    SELECT p_mode_code, k, (v#>>'{}')::numeric::int, v_uid FROM jsonb_each(p_weights) AS e(k, v);
  END IF;

  IF p_activate THEN
    IF v_mode.requires_weights THEN
      -- REVALIDACIÓN de lo persistido en el momento de activar.
      SELECT COALESCE(SUM(w.weight), -1) INTO v_saved_sum
      FROM public.sales_task_mode_weights w WHERE w.mode_code = p_mode_code;

      SELECT string_agg(g.code, ', ' ORDER BY g.sort_order) INTO v_saved_missing
      FROM public.sales_task_groups g
      WHERE NOT EXISTS (
        SELECT 1 FROM public.sales_task_mode_weights w
        WHERE w.mode_code = p_mode_code AND w.group_code = g.code
      );

      IF v_saved_missing IS NOT NULL THEN
        RAISE EXCEPTION 'el modo % no puede activarse: faltan grupos %', p_mode_code, v_saved_missing USING ERRCODE = '22023';
      END IF;
      IF v_saved_sum <> 100 THEN
        RAISE EXCEPTION 'el modo % no puede activarse: la suma guardada es %', p_mode_code, v_saved_sum USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.sales_task_mode_weights w
        JOIN public.sales_task_groups g ON g.code = w.group_code
        WHERE w.mode_code = p_mode_code AND NOT g.enabled AND w.weight <> 0
      ) THEN
        RAISE EXCEPTION 'el modo % no puede activarse: grupo deshabilitado con peso', p_mode_code USING ERRCODE = '22023';
      END IF;
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
                            'activated', p_activate,
                            'scope', CASE WHEN p_target_user IS NULL THEN 'global' ELSE 'user' END);
END $$;

REVOKE ALL ON FUNCTION public.set_sales_task_mode(text, jsonb, uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sales_task_mode(text, jsonb, uuid, boolean, text) TO authenticated;

-- ---------------------------------------------------------------------
-- 6c. Arranque de tarea.
--     - pending           -> in_progress + started_at = now()
--     - in_progress con started_at -> ÉXITO IDEMPOTENTE (no cambia nada)
--     - completed / skipped / no_procede / blocked -> RECHAZO
--     - in_progress SIN started_at (histórico) -> se sella el inicio
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_building_task(p_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.building_tasks%ROWTYPE;
  v_mode text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row FROM public.building_tasks WHERE id = p_task_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tarea inexistente' USING ERRCODE = 'P0002';
  END IF;
  -- Ni siquiera un admin arranca tareas ajenas desde aquí: haría falta una
  -- RPC administrativa separada.
  IF v_row.user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'la tarea no te pertenece' USING ERRCODE = '42501';
  END IF;

  -- Sólo tareas de producción o manuales: legacy/demo NO son iniciables.
  v_mode := COALESCE(to_jsonb(v_row) ->> 'generation_mode', 'production');
  IF v_mode NOT IN ('production','manual') THEN
    RAISE EXCEPTION 'modo de generación no iniciable: %', v_mode USING ERRCODE = '22023';
  END IF;

  IF v_row.status IN ('completed','skipped','no_procede','blocked') THEN
    RAISE EXCEPTION 'la tarea en estado % no se puede empezar', v_row.status USING ERRCODE = '22023';
  END IF;

  IF v_row.status = 'in_progress' AND v_row.started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status,
                              'started_at', v_row.started_at, 'idempotent', true);
  END IF;

  -- in_progress HISTÓRICO sin started_at: no se inventa duración retroactiva.
  IF v_row.status = 'in_progress' AND v_row.started_at IS NULL THEN
    RAISE EXCEPTION 'tarea in_progress sin inicio registrado: requiere reapertura' USING ERRCODE = '22023';
  END IF;

  IF v_row.status NOT IN ('pending','in_progress') THEN
    RAISE EXCEPTION 'estado no admitido para empezar: %', COALESCE(v_row.status, 'null') USING ERRCODE = '22023';
  END IF;

  UPDATE public.building_tasks
     SET started_at = COALESCE(started_at, now()),
         status = 'in_progress',
         updated_at = now()
   WHERE id = p_task_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status,
                            'started_at', v_row.started_at, 'idempotent', false);
END $$;

REVOKE ALL ON FUNCTION public.start_building_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_building_task(uuid) TO authenticated;

-- Reapertura EXPLÍCITA: vuelve a pending y LIMPIA started_at/completed_at,
-- de modo que el nuevo ciclo mide su propia duración.
CREATE OR REPLACE FUNCTION public.reopen_building_task(p_task_id uuid)
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
  IF v_row.user_id IS DISTINCT FROM v_uid AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'la tarea no te pertenece' USING ERRCODE = '42501';
  END IF;

  -- Reapertura SÓLO desde estados terminales o bloqueados.
  IF v_row.status IS NULL OR v_row.status NOT IN ('completed','skipped','no_procede','blocked') THEN
    RAISE EXCEPTION 'estado no reabrible: %', COALESCE(v_row.status,'null') USING ERRCODE = '22023';
  END IF;

  UPDATE public.building_tasks
     SET status = 'pending', started_at = NULL, completed_at = NULL, updated_at = now()
   WHERE id = p_task_id
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status,
                            'started_at', v_row.started_at);
END $$;

REVOKE ALL ON FUNCTION public.reopen_building_task(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_building_task(uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 6d. Alta de gestor YA creado en Auth. NO crea usuarios.
--     Verifica identidad (auth.users), email y nombre esperados; deja
--     EXACTAMENTE el rol sales_manager y SUSTITUYE el equipo por el array.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.finalize_sales_manager_setup(
  p_user_id        uuid,
  p_expected_email text,
  p_full_name      text,
  p_members        uuid[] DEFAULT '{}'::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_email         text;
  v_member        uuid;
  v_roles_borrados int := 0;
  v_altas          int := 0;
  v_desactivados   int := 0;
  v_solicitados    int := 0;
  v_members        uuid[];
BEGIN
  -- Deduplicación PREVIA: un UUID repetido no puede fallar ni falsear counts.
  SELECT COALESCE(array_agg(DISTINCT m), '{}'::uuid[])
    INTO v_members
    FROM unnest(COALESCE(p_members, '{}'::uuid[])) AS m
   WHERE m IS NOT NULL;
  v_solicitados := COALESCE(array_length(v_members, 1), 0);

  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_expected_email IS NULL OR btrim(p_expected_email) = '' THEN
    RAISE EXCEPTION 'p_user_id y p_expected_email son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_full_name IS NULL OR btrim(p_full_name) = '' THEN
    RAISE EXCEPTION 'p_full_name es obligatorio' USING ERRCODE = '22023';
  END IF;

  -- 1. El usuario debe EXISTIR ya en Auth y coincidir el email esperado.
  SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p_user_id;
  IF v_email IS NULL THEN
    RAISE EXCEPTION 'el usuario % no existe en Auth: esta función no crea usuarios', p_user_id USING ERRCODE = 'P0002';
  END IF;
  IF lower(v_email) <> lower(btrim(p_expected_email)) THEN
    RAISE EXCEPTION 'el email no coincide con el usuario indicado' USING ERRCODE = '22023';
  END IF;

  -- 2. Todos los miembros deben existir y ser comercial_zona (validación previa).
  IF v_solicitados > 0 THEN
    FOREACH v_member IN ARRAY v_members LOOP
      IF v_member = p_user_id THEN
        RAISE EXCEPTION 'el gestor no puede ser miembro de su propio equipo' USING ERRCODE = '22023';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_member) THEN
        RAISE EXCEPTION 'el miembro % no existe', v_member USING ERRCODE = 'P0002';
      END IF;
      IF NOT public.has_role(v_member, 'comercial_zona') THEN
        RAISE EXCEPTION 'el miembro % no es comercial_zona', v_member USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  -- 3. Perfil.
  INSERT INTO public.profiles (id, email, full_name, must_change_password)
  VALUES (p_user_id, lower(btrim(p_expected_email)), btrim(p_full_name), true)
  ON CONFLICT (id) DO UPDATE
    SET email = lower(btrim(p_expected_email)),
        full_name = btrim(p_full_name),
        must_change_password = true;

  -- 4. Rol EXCLUSIVO: se eliminan TODOS los anteriores.
  WITH borrados AS (
    DELETE FROM public.user_roles WHERE user_id = p_user_id RETURNING 1
  )
  SELECT COUNT(*) INTO v_roles_borrados FROM borrados;

  INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, 'sales_manager'::public.app_role);

  -- 5. El equipo se SUSTITUYE por el array recibido.
  WITH bajas AS (
    UPDATE public.sales_manager_team_members
       SET active = false, updated_at = now()
     WHERE manager_id = p_user_id
       AND active
       AND NOT (member_id = ANY (v_members))
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_desactivados FROM bajas;

  WITH altas AS (
    INSERT INTO public.sales_manager_team_members (manager_id, member_id, active)
    SELECT p_user_id, m, true FROM unnest(v_members) AS m
    ON CONFLICT (manager_id, member_id) DO UPDATE SET active = true, updated_at = now()
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_altas FROM altas;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_user_id,
    'email', lower(btrim(p_expected_email)),
    'roles_eliminados', v_roles_borrados,
    'roles_finales', (SELECT COUNT(*) FROM public.user_roles WHERE user_id = p_user_id),
    'miembros_solicitados', v_solicitados,
    'miembros_activos', (SELECT COUNT(*) FROM public.sales_manager_team_members
                          WHERE manager_id = p_user_id AND active),
    'miembros_altas', v_altas,
    'miembros_desactivados', v_desactivados
  );
END $$;

REVOKE ALL ON FUNCTION public.finalize_sales_manager_setup(uuid, text, text, uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_sales_manager_setup(uuid, text, text, uuid[]) TO service_role;

-- Se retira la firma antigua (sin email esperado) si existiera.
DROP FUNCTION IF EXISTS public.finalize_sales_manager_setup(uuid, text, uuid[]);

-- ---------------------------------------------------------------------
-- 7. RLS EFECTIVA
--    Las políticas históricas `USING (true)` se ELIMINAN: mientras existan,
--    cualquier política nueva quedaría anulada por el OR entre permisivas.
--    NO se concede SELECT sobre building_tasks a sales_manager: el panel
--    sólo ve agregados por RPC.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_authenticated   ON public.profiles;
DROP POLICY IF EXISTS user_roles_select_authenticated ON public.user_roles;

-- profiles: SELECT DIRECTO sólo self + admin. El sales_manager NO recibe filas
-- de perfil de sus miembros: el panel consume únicamente la RPC agregada.
DROP POLICY IF EXISTS profiles_select_scoped ON public.profiles;
CREATE POLICY profiles_select_scoped ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- user_roles: propio rol + admin. Sin excepción para sales_manager (evita
-- además cualquier recursión con las políticas de profiles).
DROP POLICY IF EXISTS user_roles_self_read     ON public.user_roles;
DROP POLICY IF EXISTS user_roles_select_scoped ON public.user_roles;
CREATE POLICY user_roles_select_scoped ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin')
  );

-- ---------------------------------------------------------------------
-- 7b. Atribución MÍNIMA de agentes para el panel de WhatsApp.
--     Devuelve EXCLUSIVAMENTE id + nombre visible de los ids solicitados.
--     Ni email, ni avatar, ni roles, ni timestamps, ni must_change_password.
--     No permite enumerar la tabla base (exige lista de ids).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_agent_display_names(p_ids uuid[])
RETURNS TABLE (id uuid, display_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p.id, NULLIF(btrim(COALESCE(p.full_name, '')), '') AS display_name
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND (public.has_role(auth.uid(), 'whatsapp') OR public.has_role(auth.uid(), 'admin'))
    AND p_ids IS NOT NULL
    AND array_length(p_ids, 1) IS NOT NULL
    AND array_length(p_ids, 1) <= 200
    AND p.id = ANY (p_ids);
$$;

REVOKE ALL ON FUNCTION public.get_agent_display_names(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_agent_display_names(uuid[]) TO authenticated;

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

REVOKE ALL ON FUNCTION public.profiles_guard_must_change_password() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_guard_must_change_password_trg ON public.profiles;
CREATE TRIGGER profiles_guard_must_change_password_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_guard_must_change_password();

COMMIT;
