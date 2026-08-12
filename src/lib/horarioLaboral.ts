/**
 * Horario laboral del equipo — lógica PURA.
 * Sirve para decidir si una tarea está realmente retrasada: fuera del
 * horario (noches, fines de semana, días desactivados) el retraso no corre.
 */

export type TramoDia = { activo: boolean; inicio: string; fin: string };
/** Índice 0 = domingo … 6 = sábado (igual que Date.getDay()). */
export type HorarioLaboral = TramoDia[];

export const DIAS_SEMANA = [
  "Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado",
] as const;

/** Orden de presentación: de lunes a domingo. */
export const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0] as const;

export const HORARIO_POR_DEFECTO: HorarioLaboral = [
  { activo: false, inicio: "09:00", fin: "18:00" }, // domingo
  { activo: true, inicio: "09:00", fin: "18:00" },
  { activo: true, inicio: "09:00", fin: "18:00" },
  { activo: true, inicio: "09:00", fin: "18:00" },
  { activo: true, inicio: "09:00", fin: "18:00" },
  { activo: true, inicio: "09:00", fin: "18:00" },
  { activo: false, inicio: "09:00", fin: "14:00" }, // sábado
];

export const CLAVE_HORARIO = "horario_laboral";

/** Convierte "09:30" en minutos desde medianoche. Devuelve null si no vale. */
export function minutosDeHora(v: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((v ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/** Normaliza cualquier valor guardado a un horario válido de 7 días. */
export function normalizarHorario(v: unknown): HorarioLaboral {
  const base = HORARIO_POR_DEFECTO;
  if (!Array.isArray(v) || v.length !== 7) return base.map((d) => ({ ...d }));
  return base.map((porDefecto, i) => {
    const d = (v as any[])[i] ?? {};
    const ini = minutosDeHora(d.inicio) != null ? String(d.inicio) : porDefecto.inicio;
    const fin = minutosDeHora(d.fin) != null ? String(d.fin) : porDefecto.fin;
    const ok = (minutosDeHora(ini) as number) < (minutosDeHora(fin) as number);
    return {
      activo: typeof d.activo === "boolean" ? d.activo && ok : porDefecto.activo,
      inicio: ok ? ini : porDefecto.inicio,
      fin: ok ? fin : porDefecto.fin,
    };
  });
}

/** ¿Este instante cae dentro del horario laboral? */
export function esHoraLaborable(fecha: Date, horario: HorarioLaboral = HORARIO_POR_DEFECTO): boolean {
  const d = horario[fecha.getDay()];
  if (!d?.activo) return false;
  const min = fecha.getHours() * 60 + fecha.getMinutes();
  return min >= (minutosDeHora(d.inicio) ?? 0) && min < (minutosDeHora(d.fin) ?? 0);
}

function inicioDelDia(f: Date): Date {
  const x = new Date(f);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** Minutos de trabajo transcurridos entre dos instantes. */
export function minutosLaborablesEntre(
  desde: Date,
  hasta: Date,
  horario: HorarioLaboral = HORARIO_POR_DEFECTO,
): number {
  if (!(desde instanceof Date) || !(hasta instanceof Date)) return 0;
  if (Number.isNaN(desde.getTime()) || Number.isNaN(hasta.getTime())) return 0;
  if (hasta <= desde) return 0;
  let total = 0;
  let cursor = inicioDelDia(desde);
  for (let i = 0; i < 400 && cursor <= hasta; i++) {
    const d = horario[cursor.getDay()];
    if (d?.activo) {
      const ini = new Date(cursor);
      ini.setMinutes(minutosDeHora(d.inicio) ?? 0);
      const fin = new Date(cursor);
      fin.setMinutes(minutosDeHora(d.fin) ?? 0);
      const a = ini < desde ? desde : ini;
      const b = fin > hasta ? hasta : fin;
      if (b > a) total += (b.getTime() - a.getTime()) / 60000;
    }
    cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
    cursor = inicioDelDia(cursor);
  }
  return Math.round(total);
}

/** Una tarea sólo se retrasa cuando ha pasado tiempo de trabajo desde su fecha límite. */
export function estaRetrasada(
  fechaLimite: string | Date | null | undefined,
  ahora: Date = new Date(),
  horario: HorarioLaboral = HORARIO_POR_DEFECTO,
): boolean {
  if (!fechaLimite) return false;
  const d = fechaLimite instanceof Date ? fechaLimite : new Date(fechaLimite);
  if (Number.isNaN(d.getTime())) return false;
  return minutosLaborablesEntre(d, ahora, horario) > 0;
}

export function resumenDia(d: TramoDia): string {
  return d.activo ? `${d.inicio}–${d.fin}` : "Sin trabajo";
}
