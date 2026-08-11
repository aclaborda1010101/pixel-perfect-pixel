import { V5_TERMINAL_STATUSES } from "./v5/status";

const TZ = "Europe/Madrid";

const dateFmt = new Intl.DateTimeFormat("es-ES", {
  timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
});
const dateTimeFmt = new Intl.DateTimeFormat("es-ES", {
  timeZone: TZ, day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit",
});
const ymdFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
});

export type TemporalState = "hoy" | "proxima" | "vencida" | "sin_fecha";

/** YYYY-MM-DD of a date as seen in Europe/Madrid. */
export function madridYmd(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return ymdFmt.format(date);
}

export function formatDate(d?: string | null): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  return dateFmt.format(date);
}

export function formatDateTime(d?: string | null): string | null {
  if (!d) return null;
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  return dateTimeFmt.format(date);
}

/** Planned start date (read-only derivation, never persisted). */
export function plannedDate(task: any): { iso: string; source: "task_key" | "created_at" } | null {
  const key = typeof task?.task_key === "string" ? task.task_key : null;
  // Soporta el motor V5 (v5:FECHA:T-XX:id) y el formato anterior (call_queue:FECHA:id).
  const m = key ? key.match(/^(?:v5|call_queue):(\d{4}-\d{2}-\d{2}):/) : null;
  if (m) return { iso: `${m[1]}T00:00:00Z`, source: "task_key" };
  if (task?.created_at) return { iso: task.created_at, source: "created_at" };
  return null;
}

/**
 * Código de catálogo de una tarea.
 * - Histórico (SÓLO lectura): `v5:<YYYY-MM-DD>:T-0X:<id>`.
 * - Canónico V5: `v5:<rules_version>:<T1|T2_T3|…>:<building>:<subject>:<fp>`.
 */
export function taskCode(task: any): string | null {
  if (typeof task?.task_code === "string" && task.task_code.trim()) return task.task_code;
  const key = typeof task?.task_key === "string" ? task.task_key : null;
  const legacy = key?.match(/^v5:\d{4}-\d{2}-\d{2}:(T-\d{2}):/);
  if (legacy) return legacy[1];
  const canonical = key?.match(/^v5:[^:]+:(T1|T2_T3|T4|T5|T6|T8|T9):/);
  if (canonical) return canonical[1];
  const fromTitle = typeof task?.title === "string" ? task.title.match(/T-\d{2}/) : null;
  return fromTitle ? fromTitle[0] : null;
}

/** Identificador del sujeto de la tarea (propietario o edificio) desde el task_key. */
export function taskSubjectId(task: any): string | null {
  const key = typeof task?.task_key === "string" ? task.task_key : null;
  if (!key) return null;
  const v5 = key.match(/^v5:\d{4}-\d{2}-\d{2}:T-\d{2}:([0-9a-f-]{36})$/i);
  if (v5) return v5[1];
  const canonical = key.match(/^v5:[^:]+:(?:T1|T2_T3|T4|T5|T6|T8|T9):[^:]+:([^:]+):[^:]+$/);
  if (canonical) return canonical[1];
  const legacy = key.match(/^call_queue:\d{4}-\d{2}-\d{2}:([0-9a-f-]{36})$/i);
  return legacy ? legacy[1] : null;
}

/**
 * Abierta = no terminal según el vocabulario canónico V5 (status.ts).
 * `cancelled` y `superseded` son terminales: nunca se muestran vencidas.
 */
export function isTaskOpen(task: any): boolean {
  return !V5_TERMINAL_STATUSES.includes(String(task?.status) as never);
}

export function temporalState(task: any, now: Date = new Date()): TemporalState {
  if (!task?.due_date) return "sin_fecha";
  const due = madridYmd(task.due_date);
  const today = madridYmd(now);
  if (due === today) return "hoy";
  if (due < today) return isTaskOpen(task) ? "vencida" : "proxima";
  return "proxima";
}

export const temporalLabel: Record<TemporalState, string> = {
  hoy: "Hoy",
  proxima: "Próxima",
  vencida: "Vencida",
  sin_fecha: "Sin fecha límite",
};

export const temporalBadge: Record<TemporalState, "warning" | "info" | "destructive" | "outline"> = {
  hoy: "warning",
  proxima: "info",
  vencida: "destructive",
  sin_fecha: "outline",
};

const prioOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };

/** Pending tasks: due_date asc (nulls last), then priority. */
export function sortByDueThenPriority<T extends any>(tasks: T[]): T[] {
  return [...tasks].sort((a: any, b: any) => {
    const da = a.due_date ? new Date(a.due_date).getTime() : Infinity;
    const db = b.due_date ? new Date(b.due_date).getTime() : Infinity;
    if (da !== db) return da - db;
    const p = (prioOrder[a.priority] ?? 9) - (prioOrder[b.priority] ?? 9);
    if (p !== 0) return p;
    const pa = plannedDate(a)?.iso, pb = plannedDate(b)?.iso;
    return new Date(pa ?? 0).getTime() - new Date(pb ?? 0).getTime();
  });
}
