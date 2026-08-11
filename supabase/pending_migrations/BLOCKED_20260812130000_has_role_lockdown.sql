-- =====================================================================
-- BLOQUEADA — NO APLICAR. Cierre de public.has_role(_user_id, _role)
-- =====================================================================
-- Objetivo final: que has_role(uuid, app_role) deje de ser invocable por
-- authenticated/PUBLIC, de modo que ningún usuario autenticado pueda
-- preguntar por el rol de un UUID arbitrario (enumeración de roles).
--
-- ESTADO: BLOQUEADA a propósito. El prefijo BLOCKED_ y el guard de abajo
-- impiden su despliegue. Aplicarla HOY rompería las políticas RLS
-- históricas, que se evalúan con el rol del invocante y llaman a
-- public.has_role(auth.uid(), ...). Primero hay que portar TODOS los
-- consumidores a public.current_user_has_role(role).
--
-- INVENTARIO COMPLETO DE CONSUMIDORES (a fecha de esta enmienda)
-- ---------------------------------------------------------------------
-- A) Cliente / edge functions:
--    * supabase/functions/guardas_aprobar/index.ts  -> PORTADO: ya no llama
--      a rpc('has_role'); consulta user_roles con el cliente de servicio.
--    * src/**: 0 llamadas a rpc('has_role') (el front usa current_user_role()).
-- B) Políticas RLS y funciones SQL en supabase/migrations/*.sql:
--    17 ficheros históricos, ~48 invocaciones de has_role(auth.uid(), ...)
--    en políticas de: buildings, building_tasks, building_feedback, owners,
--    notas_simples, hubspot_*, wa_*, user_roles, profiles, app_settings,
--    coach_reports, work_modes, guard_proposals, entre otras.  NO PORTADAS.
-- C) Migración pendiente 20260811000000_sales_manager_phase_b.sql:
--    políticas y RPC del panel del gestor.  NO PORTADAS.
--
-- CRITERIO DE DESBLOQUEO (todo, en una sola migración forward):
--   1. Reescribir cada política de (B) y (C) a current_user_has_role(role).
--   2. Dejar has_role(uuid, app_role) sólo para SECURITY DEFINER/service_role
--      (o sustituirlo por internal_member_has_role).
--   3. Probar en DB desechable que ninguna política queda huérfana.
--   4. Renombrar este fichero sin el prefijo BLOCKED_ y quitar el guard.
-- =====================================================================

DO $$
BEGIN
  RAISE EXCEPTION
    'MIGRACION BLOQUEADA: has_role_lockdown no puede aplicarse hasta portar TODOS los consumidores (ver inventario en la cabecera).';
END $$;

-- ---------------------------------------------------------------------
-- Contenido previsto (inalcanzable mientras el guard esté activo)
-- ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO service_role;
