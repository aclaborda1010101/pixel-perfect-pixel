/**
 * Métricas del panel de gestor comercial — lógica PURA.
 * Los datos llegan YA agregados desde la RPC get_sales_manager_dashboard:
 * el frontend no consulta building_tasks directamente.
 *
 * Ventanas SEPARADAS y no intercambiables:
 *  - created_in_period   -> tareas CREADAS en [from, to)
 *  - completed_in_period -> tareas CERRADAS en [from, to) (pudieron crearse antes)
 *  - plazos y duraciones -> se calculan SOLO sobre los cierres del periodo
 *  - snapshot            -> FOTO ACTUAL de estados, no es histórico
 */

export type SalesManagerSnapshot = {
  pending: number;
  in_progress: number;
  blocked: number;
  skipped: number;
  no_procede: number;
  completed: number;
  unknown: number;
  vencidas_ahora: number;
  /** Bloqueadas fuera de plazo: se informan APARTE, no penalizan al comercial. */
  bloqueadas_vencidas: number;
  as_of: string;
};

export type SalesManagerRow = {
  user_id: string;
  full_name: string | null;
  created_in_period: number;
  completed_in_period: number;
  /** Cierres NO productivos del periodo: se cuentan aparte de completed. */
  skipped_in_period: number;
  no_procede_in_period: number;
  con_plazo: number;
  en_plazo: number;
  con_duracion: number;
  media_horas: number | null;
  mediana_horas: number | null;
  /** Creadas en el periodo que tienen inicio real registrado. */
  cobertura_inicio_creadas: number;
  cobertura_inicio_pct: number | null;
  /** Cierres del periodo con duración completa (inicio + cierre). */
  cobertura_duracion_pct: number | null;
  snapshot: SalesManagerSnapshot;
  mezcla_creadas: Record<string, number>;
};

export type SalesManagerDashboard = {
  from: string;
  to: string;
  generated_at: string;
  rows: SalesManagerRow[];
};

export const MADRID_TZ = "Europe/Madrid";

/** Desplazamiento (ms) de Europe/Madrid respecto a UTC en un instante dado. */
function madridOffsetMs(at: Date): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: MADRID_TZ,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = Object.fromEntries(dtf.formatToParts(at).map((p) => [p.type, p.value]));
  const asUTC = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUTC - at.getTime();
}

/** Instante UTC correspondiente a la medianoche local de Madrid del día de `at`. */
export function madridDayStart(at: Date): Date {
  const off = madridOffsetMs(at);
  const local = new Date(at.getTime() + off);
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0,
    0,
    0,
    0,
  );
  // Se recalcula el offset en la medianoche para respetar los cambios de hora.
  const approx = new Date(localMidnight - off);
  return new Date(localMidnight - madridOffsetMs(approx));
}

/** El backend rechaza intervalos mayores: el cliente no puede pedirlos. */
export const MAX_PERIOD_DAYS = 31;

export type PeriodKey = "hoy" | "semana" | "mes";

export const PERIODS: readonly { key: PeriodKey; label: string; days: number }[] = [
  { key: "hoy", label: "Hoy", days: 1 },
  { key: "semana", label: "7 días", days: 7 },
  { key: "mes", label: "30 días", days: 30 },
] as const;

/**
 * Intervalo semiabierto [from, to) alineado a días naturales de Madrid.
 * "semana" son 7 días EXACTOS (hoy incluido).
 */
export function periodRange(period: PeriodKey, now: Date = new Date()): { from: Date; to: Date } {
  const startToday = madridDayStart(now);
  const days = PERIODS.find((p) => p.key === period)!.days;
  const capped = Math.min(days, MAX_PERIOD_DAYS);
  const to = new Date(madridDayStart(new Date(startToday.getTime() + 36 * 3_600_000)).getTime());
  const fromApprox = new Date(startToday.getTime() - (capped - 1) * 24 * 3_600_000);
  return { from: madridDayStart(fromApprox), to };
}

export function completionRate(row: SalesManagerRow): number | null {
  if (!row.con_plazo) return null;
  return Math.round((row.en_plazo / row.con_plazo) * 100);
}

export function fmtHoras(h: number | null | undefined): string {
  if (h == null || !Number.isFinite(Number(h))) return "—";
  const v = Number(h);
  if (v < 1) return `${Math.round(v * 60)} min`;
  return `${v.toFixed(1)} h`;
}

export function mezclaEntries(row: SalesManagerRow): [string, number][] {
  return Object.entries(row.mezcla_creadas ?? {}).sort((a, b) => b[1] - a[1]);
}

/** Cobertura de INICIO sobre las tareas creadas en el periodo. */
export function coberturaInicioNota(row: SalesManagerRow): string {
  if (!row.created_in_period) return "Sin tareas creadas en el periodo.";
  return `${row.cobertura_inicio_creadas} de ${row.created_in_period} tareas creadas tienen inicio real registrado (${row.cobertura_inicio_pct ?? 0}%).`;
}

/** Cobertura de DURACIÓN COMPLETA sobre los cierres del periodo. */
export function coberturaDuracionNota(row: SalesManagerRow): string {
  if (!row.completed_in_period) return "Sin cierres en el periodo.";
  return `Duración medida en ${row.con_duracion} de ${row.completed_in_period} cierres (${row.cobertura_duracion_pct ?? 0}%). Los cierres sin inicio registrado no computan duración.`;
}

/** Aviso de la foto actual: nunca se presenta como dato histórico. */
export function snapshotNota(row: SalesManagerRow): string {
  const at = row.snapshot?.as_of ? new Date(row.snapshot.as_of) : null;
  const cuando = at && !Number.isNaN(at.getTime())
    ? at.toLocaleString("es-ES", { timeZone: MADRID_TZ })
    : "ahora";
  return `Foto actual a ${cuando} (Madrid). No corresponde al periodo seleccionado.`;
}
