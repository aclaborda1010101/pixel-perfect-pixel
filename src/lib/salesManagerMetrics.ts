/**
 * Métricas del panel de gestor comercial — lógica PURA.
 * Los datos llegan YA agregados desde la RPC get_sales_manager_dashboard:
 * el frontend no consulta building_tasks directamente.
 */

export type SalesManagerRow = {
  user_id: string;
  full_name: string | null;
  creadas: number;
  completadas: number;
  pending: number;
  in_progress: number;
  blocked: number;
  skipped: number;
  unknown: number;
  vencidas: number;
  con_plazo: number;
  en_plazo: number;
  con_inicio: number;
  cobertura_inicio_pct: number | null;
  media_horas: number | null;
  mediana_horas: number | null;
  muestra_duracion: number;
  mezcla: Record<string, number>;
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
  const to = new Date(madridDayStart(new Date(startToday.getTime() + 36 * 3_600_000)).getTime());
  const fromApprox = new Date(startToday.getTime() - (days - 1) * 24 * 3_600_000);
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
  return Object.entries(row.mezcla ?? {}).sort((a, b) => b[1] - a[1]);
}

/** Aviso honesto sobre la cobertura de started_at. */
export function coberturaNota(row: SalesManagerRow): string {
  const pct = row.cobertura_inicio_pct;
  if (pct == null) return "Sin tareas en el periodo.";
  return `Duración calculada sobre ${row.muestra_duracion} de ${row.creadas} tareas (${pct}% con inicio real registrado). El histórico sin inicio no computa duración.`;
}
