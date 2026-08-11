/**
 * Panel del gestor comercial — lógica PURA.
 * Los datos llegan de la consulta segura get_sales_manager_panel.
 */
import { ETIQUETA_TIPO, type TipoTarea } from "@/lib/modosGeneracion";

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

export function conRetraso(t: TareaPanel, ahora: Date = new Date()): boolean {
  if (!t.due_date) return false;
  return new Date(t.due_date).getTime() < ahora.getTime();
}

export type ResumenComercial = {
  user_id: string;
  nombre: string;
  activas: TareaPanel[];
  retrasadas: TareaPanel[];
  realizadas: TareaPanel[];
};

export function agruparPorComercial(data: PanelData | undefined, ahora: Date = new Date()): ResumenComercial[] {
  const activas = soloReales(data?.activas ?? []);
  const realizadas = soloReales(data?.realizadas ?? []);
  const mapa = new Map<string, ResumenComercial>();
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
    if (conRetraso(t, ahora)) r.retrasadas.push(t);
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
