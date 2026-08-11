/**
 * Simulador FUNCIONAL de las reglas del panel de gestor comercial.
 *
 * Es la especificación ejecutable de la migración
 * `supabase/pending_migrations/20260811000000_sales_manager_phase_b.sql`:
 * mismas identidades (claims), mismos predicados, mismas ventanas.
 * Permite probar el comportamiento sin base de datos conectada.
 */

import { V5_TASK_CODES } from "@/lib/v5/model";
import type { SalesManagerRow, SalesManagerDashboard } from "@/lib/salesManagerMetrics";

export type AppRole =
  | "admin" | "manager" | "agent" | "viewer" | "captacion"
  | "comercial_zona" | "prevalificacion" | "whatsapp" | "sales_manager";

export type Claims = { uid: string | null; roles: AppRole[] };
export type TeamMember = { manager_id: string; member_id: string; active: boolean };

/** Prioridad explícita: admin > sales_manager > operativos > viewer. */
const ROLE_PRIORITY: AppRole[] = [
  "admin", "sales_manager", "manager", "agent", "captacion",
  "comercial_zona", "prevalificacion", "whatsapp", "viewer",
];

export function currentUserRole(claims: Claims): AppRole {
  if (!claims.uid) return "viewer";
  for (const r of ROLE_PRIORITY) if (claims.roles.includes(r)) return r;
  return "viewer"; // fallback: nunca NULL
}

const hasRole = (c: Claims, r: AppRole) => !!c.uid && c.roles.includes(r);

function isActiveTeamMember(team: TeamMember[], managerId: string, memberId: string): boolean {
  return team.some((t) => t.manager_id === managerId && t.member_id === memberId && t.active);
}

/** profiles_select_scoped */
export function canSelectProfile(viewer: Claims, profileId: string, team: TeamMember[]): boolean {
  if (!viewer.uid) return false;
  if (viewer.uid === profileId) return true;
  if (hasRole(viewer, "admin")) return true;
  return hasRole(viewer, "sales_manager") && isActiveTeamMember(team, viewer.uid, profileId);
}

/** user_roles_select_scoped */
export function canSelectUserRole(viewer: Claims, targetUserId: string, team: TeamMember[]): boolean {
  return canSelectProfile(viewer, targetUserId, team);
}

/** No existe política de SELECT sobre building_tasks para el gestor. */
export function canSelectBuildingTaskDirectly(): boolean {
  return false;
}

/** Helpers internos: sin EXECUTE para PUBLIC/anon/authenticated. */
export const INTERNAL_HELPERS = [
  "is_sales_manager_or_admin",
  "sales_manager_can_see",
  "sales_task_mode_weights_validate",
  "profiles_guard_must_change_password",
] as const;
export const PUBLIC_RPCS = [
  "get_sales_manager_dashboard",
  "get_sales_task_mode_config",
  "set_sales_task_mode",
  "start_building_task",
  "reopen_building_task",
  "finalize_sales_manager_setup",
] as const;

export function canExecute(fn: string, grantee: "anon" | "authenticated" | "service_role"): boolean {
  if (grantee === "service_role") return true;
  if ((INTERNAL_HELPERS as readonly string[]).includes(fn)) return false;
  return grantee === "authenticated" && (PUBLIC_RPCS as readonly string[]).includes(fn);
}

// ------------------------------------------------------------------
// start / reopen
// ------------------------------------------------------------------
export type TaskRow = {
  id: string;
  user_id: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  due_date?: string | null;
  task_key?: string | null;
};

export type StartResult =
  | { ok: true; started_at: string; written: boolean }
  | { ok: false; error: string };

export function startBuildingTaskSim(
  claims: Claims,
  task: TaskRow | undefined,
  now: Date,
): StartResult {
  if (!claims.uid) return { ok: false, error: "no autorizado" };
  if (!task) return { ok: false, error: "tarea inexistente" };
  if (task.user_id !== claims.uid && !hasRole(claims, "admin")) {
    return { ok: false, error: "la tarea no te pertenece" };
  }
  if (task.status === "pending") {
    const started = task.started_at ?? now.toISOString();
    task.started_at = started;
    task.status = "in_progress";
    return { ok: true, started_at: started, written: true };
  }
  if (task.status === "in_progress" && task.started_at) {
    return { ok: true, started_at: task.started_at, written: false }; // idempotente
  }
  return { ok: false, error: `estado no iniciable: ${task.status}` };
}

export function reopenBuildingTaskSim(claims: Claims, task: TaskRow | undefined): StartResult {
  if (!task) return { ok: false, error: "tarea inexistente" };
  if (task.user_id !== claims.uid && !hasRole(claims, "admin")) {
    return { ok: false, error: "la tarea no te pertenece" };
  }
  task.status = "pending";
  task.started_at = null;
  task.completed_at = null;
  return { ok: true, started_at: "", written: true };
}

// ------------------------------------------------------------------
// Alta de gestor
// ------------------------------------------------------------------
export type AuthUser = { id: string; email: string };

export function finalizeSalesManagerSetupSim(
  caller: Claims,
  args: { user_id: string; expected_email: string; full_name: string; members: string[] },
  db: {
    authUsers: AuthUser[];
    roles: { user_id: string; role: AppRole }[];
    team: TeamMember[];
  },
): { ok: true; roles_borrados: number; rol: AppRole; miembros: number } | { ok: false; error: string } {
  if (!hasRole(caller, "admin")) return { ok: false, error: "sólo admin" };

  const u = db.authUsers.find((x) => x.id === args.user_id);
  if (!u) return { ok: false, error: "el usuario no existe en Auth: esta función no crea usuarios" };
  if (u.email.toLowerCase() !== args.expected_email.toLowerCase()) {
    return { ok: false, error: "el email no coincide con el esperado" };
  }
  if (!args.full_name.trim()) return { ok: false, error: "nombre obligatorio" };

  for (const m of args.members) {
    if (!db.authUsers.some((x) => x.id === m)) return { ok: false, error: `miembro inexistente: ${m}` };
    if (!db.roles.some((r) => r.user_id === m && r.role === "comercial_zona")) {
      return { ok: false, error: `el miembro ${m} no es comercial_zona` };
    }
  }

  const previos = db.roles.filter((r) => r.user_id === args.user_id).length;
  db.roles = db.roles.filter((r) => r.user_id !== args.user_id);
  db.roles.push({ user_id: args.user_id, role: "sales_manager" });

  // El equipo se SUSTITUYE por el array recibido.
  const resto = db.team.filter((t) => t.manager_id !== args.user_id);
  db.team.length = 0;
  db.team.push(
    ...resto,
    ...args.members.map((m) => ({ manager_id: args.user_id, member_id: m, active: true })),
  );

  return { ok: true, roles_borrados: previos, rol: "sales_manager", miembros: args.members.length };
}

// ------------------------------------------------------------------
// Dashboard agregado
// ------------------------------------------------------------------
export const MAX_PERIOD_MS = 31 * 86_400_000;

function groupOf(taskKey: string | null | undefined): string {
  const m = /v5:[^:]+:(T-?\d+)/i.exec(taskKey ?? "");
  if (!m) return "unknown";
  const n = Number(m[1].replace(/\D/g, ""));
  if (n === 2 || n === 3) return "T2_T3";
  const code = `T${n}`;
  return (V5_TASK_CODES as readonly string[]).includes(code) || code === "T7" ? code : "unknown";
}

const hours = (a: string, b: string) => (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function getSalesManagerDashboardSim(
  members: { user_id: string; full_name: string | null }[],
  tasks: TaskRow[],
  from: Date,
  to: Date,
  now: Date = new Date(),
): SalesManagerDashboard {
  if (to.getTime() - from.getTime() > MAX_PERIOD_MS) throw new Error("intervalo máximo 31 días");
  if (to <= from) throw new Error("intervalo inválido");

  const inWin = (iso: string | null | undefined) =>
    !!iso && new Date(iso) >= from && new Date(iso) < to;

  const rows: SalesManagerRow[] = members.map((m) => {
    const mine = tasks.filter((t) => t.user_id === m.user_id);
    const creadas = mine.filter((t) => inWin(t.created_at));
    const cerradas = mine.filter((t) => inWin(t.completed_at));

    const conPlazo = cerradas.filter((t) => !!t.due_date);
    const enPlazo = conPlazo.filter((t) => new Date(t.completed_at!) <= new Date(t.due_date!));
    const conDuracion = cerradas.filter(
      (t) => t.started_at && new Date(t.completed_at!) >= new Date(t.started_at),
    );
    const duraciones = conDuracion.map((t) => hours(t.started_at!, t.completed_at!));
    const mediaH = duraciones.length
      ? Math.round((duraciones.reduce((a, b) => a + b, 0) / duraciones.length) * 100) / 100
      : null;

    const conInicio = creadas.filter((t) => !!t.started_at).length;
    const snapCount = (s: string) => mine.filter((t) => t.status === s).length;
    const known = ["pending", "in_progress", "blocked", "skipped", "completed", "no_procede"];

    const mezcla: Record<string, number> = {};
    for (const t of creadas) {
      const g = groupOf(t.task_key);
      mezcla[g] = (mezcla[g] ?? 0) + 1;
    }

    return {
      user_id: m.user_id,
      full_name: m.full_name,
      created_in_period: creadas.length,
      completed_in_period: cerradas.length,
      con_plazo: conPlazo.length,
      en_plazo: enPlazo.length,
      con_duracion: conDuracion.length,
      media_horas: mediaH,
      mediana_horas: duraciones.length ? Math.round(median(duraciones)! * 100) / 100 : null,
      cobertura_inicio_creadas: conInicio,
      cobertura_inicio_pct: creadas.length ? Math.round((conInicio / creadas.length) * 100) : null,
      cobertura_duracion_pct: cerradas.length
        ? Math.round((conDuracion.length / cerradas.length) * 100)
        : null,
      snapshot: {
        pending: snapCount("pending"),
        in_progress: snapCount("in_progress"),
        blocked: snapCount("blocked"),
        skipped: snapCount("skipped") + snapCount("no_procede"),
        completed: snapCount("completed"),
        unknown: mine.filter((t) => !known.includes(t.status)).length,
        vencidas_ahora: mine.filter(
          (t) =>
            (t.status === "pending" || t.status === "in_progress") &&
            t.due_date &&
            new Date(t.due_date) < now,
        ).length,
        as_of: now.toISOString(),
      },
      mezcla_creadas: mezcla,
    };
  });

  return { from: from.toISOString(), to: to.toISOString(), generated_at: now.toISOString(), rows };
}
