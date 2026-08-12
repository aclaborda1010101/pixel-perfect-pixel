/**
 * Panel del gestor comercial — lógica PURA.
 * Los datos llegan de la consulta segura get_sales_manager_panel.
 */
import { ETIQUETA_TIPO, type TipoTarea } from "@/lib/modosGeneracion";
import { estaRetrasada, HORARIO_POR_DEFECTO, type HorarioLaboral } from "@/lib/horarioLaboral";

export type TareaPanel = {
  id: string;
  user_id: string;
  full_name: string | null;
  task_type: string;
  title: string | null;
  status: string;
  building_id: string | null;
  direccion: string | null;
  started_at: string | null;
  created_at?: string | null;
  due_date: string | null;
  completed_at?: string | null;
};

export type PanelData = {
  from: string;
  to: string;
  generated_at: string;
  comerciales?: { user_id: string; full_name: string | null }[];
  activas: TareaPanel[];
  realizadas: TareaPanel[];
};

/** Tipos reales del día a día. Las tareas de demostración nunca se muestran. */
export const TIPOS_VISIBLES = ["T-01", "T-02_03", "T-04", "T-05", "T-06", "T-08"] as const;

export function esTareaReal(t: { task_type: string }): boolean {
  return (TIPOS_VISIBLES as readonly string[]).includes(t.task_type);
}

export function soloReales<T extends { task_type: string }>(rows: T[]): T[] {
  return (rows ?? []).filter(esTareaReal);
}

export function etiquetaTipo(tipo: string): string {
  return ETIQUETA_TIPO[tipo as TipoTarea] ?? tipo;
}

export function conRetraso(
  t: TareaPanel,
  ahora: Date = new Date(),
  horario: HorarioLaboral = HORARIO_POR_DEFECTO,
): boolean {
  return estaRetrasada(t.due_date, ahora, horario);
}

export type ResumenComercial = {
  user_id: string;
  nombre: string;
  activas: TareaPanel[];
  retrasadas: TareaPanel[];
  realizadas: TareaPanel[];
};

export function agruparPorComercial(
  data: PanelData | undefined,
  ahora: Date = new Date(),
  horario: HorarioLaboral = HORARIO_POR_DEFECTO,
): ResumenComercial[] {
  const activas = soloReales(data?.activas ?? []);
  const realizadas = soloReales(data?.realizadas ?? []);
  const mapa = new Map<string, ResumenComercial>();
  for (const c of data?.comerciales ?? []) {
    mapa.set(c.user_id, {
      user_id: c.user_id,
      nombre: c.full_name || c.user_id.slice(0, 8),
      activas: [],
      retrasadas: [],
      realizadas: [],
    });
  }
  const get = (t: TareaPanel) => {
    const k = t.user_id;
    if (!mapa.has(k)) {
      mapa.set(k, {
        user_id: k,
        nombre: t.full_name || k.slice(0, 8),
        activas: [],
        retrasadas: [],
        realizadas: [],
      });
    }
    return mapa.get(k)!;
  };
  for (const t of activas) {
    const r = get(t);
    r.activas.push(t);
    if (conRetraso(t, ahora, horario)) r.retrasadas.push(t);
  }
  for (const t of realizadas) get(t).realizadas.push(t);
  return [...mapa.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

export function totales(rs: ResumenComercial[]) {
  return {
    activas: rs.reduce((n, r) => n + r.activas.length, 0),
    retrasadas: rs.reduce((n, r) => n + r.retrasadas.length, 0),
    realizadas: rs.reduce((n, r) => n + r.realizadas.length, 0),
  };
}

export function fmtFecha(v: string | null | undefined): string {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "2-digit" });
}

/** Lunes de la semana a la que pertenece la fecha (hora local). */
export function inicioSemana(f: Date): Date {
  const d = new Date(f);
  d.setHours(0, 0, 0, 0);
  const dia = (d.getDay() + 6) % 7; // 0 = lunes
  d.setDate(d.getDate() - dia);
  return d;
}

export type SemanaTareas = {
  clave: string;
  etiqueta: string;
  tareas: TareaPanel[];
};

export function etiquetaSemana(lunes: Date, ahora: Date = new Date()): string {
  const actual = inicioSemana(ahora).getTime();
  const anterior = actual - 7 * 24 * 3600 * 1000;
  if (lunes.getTime() === actual) return "Esta semana";
  if (lunes.getTime() === anterior) return "Semana pasada";
  const fin = new Date(lunes.getTime() + 6 * 24 * 3600 * 1000);
  const f = (d: Date) => d.toLocaleDateString("es-ES", { day: "2-digit", month: "short" });
  return `Semana del ${f(lunes)} al ${f(fin)}`;
}

/** Agrupa tareas realizadas por semana, de la más reciente a la más antigua. */
export function agruparPorSemana(rows: TareaPanel[], ahora: Date = new Date()): SemanaTareas[] {
  const mapa = new Map<number, TareaPanel[]>();
  for (const t of soloReales(rows ?? [])) {
    const ref = t.completed_at || t.due_date || t.started_at || t.created_at;
    if (!ref) continue;
    const d = new Date(ref);
    if (Number.isNaN(d.getTime())) continue;
    const k = inicioSemana(d).getTime();
    if (!mapa.has(k)) mapa.set(k, []);
    mapa.get(k)!.push(t);
  }
  return [...mapa.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([k, tareas]) => ({
      clave: String(k),
      etiqueta: etiquetaSemana(new Date(k), ahora),
      tareas: tareas.sort(
        (a, b) => new Date(b.completed_at ?? 0).getTime() - new Date(a.completed_at ?? 0).getTime(),
      ),
    }));
}
