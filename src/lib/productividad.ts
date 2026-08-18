/**
 * MAQUETA del panel de productividad del responsable — lógica PURA.
 *
 * Los seis indicadores y sus pesos vienen del documento del cliente.
 * Las puntuaciones son EJEMPLOS de diseño: no se calculan con datos reales,
 * no se guardan en ninguna tabla y no se escriben en HubSpot.
 */
import type { PanelData, TareaPanel } from "@/lib/gestorPanel";
import { soloReales } from "@/lib/gestorPanel";

export const AVISO_MAQUETA =
  "Vista de diseño · las puntuaciones son un ejemplo para decidir qué medir; todavía no se calculan con datos reales ni afectan a nadie";

export const AVISO_IMPORTES = "Importes orientativos, pendientes de definir por la dirección de Afflux";

export type Indicador = {
  id: string;
  numero: number;
  nombre: string;
  peso: number;
  comoSeMide: string;
};

/** Los SEIS indicadores del documento, con sus pesos. Suma exacta 100. */
export const INDICADORES: readonly Indicador[] = [
  {
    id: "info",
    numero: 1,
    nombre: "Información extraída y llamada bien registrada",
    peso: 15,
    comoSeMide: "Campos rellenados frente a los posibles.",
  },
  {
    id: "rentas",
    numero: 2,
    nombre: "Cuadro de rentas y vencimiento de contratos",
    peso: 25,
    comoSeMide:
      "Indicador determinante: conseguido (sí / a medias / no) o explicación documentada de por qué no se pudo.",
  },
  {
    id: "whatsapp",
    numero: 3,
    nombre: "WhatsApp conseguido / contenido enviado",
    peso: 15,
    comoSeMide: "Canal validado con permiso registrado en la llamada.",
  },
  {
    id: "guion",
    numero: 4,
    nombre: "Calidad de la llamada según el guion",
    peso: 15,
    comoSeMide: "Puntuación objetiva contra el guion: diagnóstico, técnica, extracción y cierre.",
  },
  {
    id: "seguimiento",
    numero: 5,
    nombre: "Seguimiento hasta cerrar el ciclo",
    peso: 15,
    comoSeMide: "Mitad cadencia cumplida en plazo, mitad ciclo cerrado.",
  },
  {
    id: "reunion",
    numero: 6,
    nombre: "Reunión cualificada con especialista",
    peso: 15,
    comoSeMide: "Reunión registrada y confirmada.",
  },
] as const;

export function sumaPesos(indicadores: readonly Indicador[] = INDICADORES): number {
  return indicadores.reduce((n, i) => n + i.peso, 0);
}

export type ComercialEjemplo = {
  nombre: string;
  /** Cumplimiento 0-100 por indicador (clave = Indicador.id). */
  logros: Record<string, number>;
};

/** Datos DE EJEMPLO, evidentemente ficticios, sólo para la maqueta. */
export const COMERCIALES_EJEMPLO: readonly ComercialEjemplo[] = [
  {
    nombre: "Jesús",
    logros: { info: 88, rentas: 70, whatsapp: 80, guion: 76, seguimiento: 65, reunion: 50 },
  },
  {
    nombre: "David",
    logros: { info: 72, rentas: 45, whatsapp: 60, guion: 68, seguimiento: 80, reunion: 25 },
  },
] as const;

export type LineaPuntuacion = Indicador & {
  /** Cumplimiento del indicador, 0-100. */
  logro: number;
  /** Puntos aportados al total (logro × peso / 100). */
  puntos: number;
};

export type PuntuacionComercial = {
  nombre: string;
  lineas: LineaPuntuacion[];
  total: number;
};

/** Puntuación global 0-100 con su desglose por indicador. */
export function puntuar(
  c: ComercialEjemplo,
  indicadores: readonly Indicador[] = INDICADORES,
): PuntuacionComercial {
  const lineas = indicadores.map((i) => {
    const logro = Math.max(0, Math.min(100, c.logros[i.id] ?? 0));
    return { ...i, logro, puntos: Math.round((logro * i.peso) / 100 * 10) / 10 };
  });
  const total = Math.round(lineas.reduce((n, l) => n + l.puntos, 0) * 10) / 10;
  return { nombre: c.nombre, lineas, total };
}

export function puntuarTodos(
  cs: readonly ComercialEjemplo[] = COMERCIALES_EJEMPLO,
): PuntuacionComercial[] {
  return cs.map((c) => puntuar(c));
}

/* ---------------- Actividad REAL ---------------- */

/** Valor real o ausencia declarada. Nunca un cero engañoso. */
export type Metrica = { valor: number | null; disponible: boolean };

export const SIN_DATOS = "sin datos todavía";

export function metrica(valor: number | null | undefined, disponible: boolean): Metrica {
  return disponible && typeof valor === "number" ? { valor, disponible: true } : { valor: null, disponible: false };
}

export function textoMetrica(m: Metrica): string {
  return m.disponible && m.valor !== null ? m.valor.toLocaleString("es-ES") : "—";
}

export type ActividadComercial = {
  user_id: string;
  nombre: string;
  hoy: Metrica;
  semana: Metrica;
  mes: Metrica;
  retrasadas: Metrica;
  llamadas: Metrica;
  whatsapps: Metrica;
};

function mismoDia(a: Date, b: Date): boolean {
  return a.toDateString() === b.toDateString();
}

function lunes(f: Date): Date {
  const d = new Date(f);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function inicioMes(f: Date): Date {
  return new Date(f.getFullYear(), f.getMonth(), 1);
}

/**
 * Actividad real por comercial a partir de la RPC agregada.
 * `extras` aporta llamadas/WhatsApp sólo cuando existan de verdad.
 */
export function actividadReal(
  data: PanelData | undefined,
  retrasadasPorComercial: Record<string, number>,
  ahora: Date = new Date(),
  extras: Record<string, { llamadas?: number | null; whatsapps?: number | null }> = {},
): ActividadComercial[] {
  if (!data) return [];
  const realizadas = soloReales(data.realizadas ?? []);
  const activas = soloReales(data.activas ?? []);
  const nombres = new Map<string, string>();
  for (const c of data.comerciales ?? []) nombres.set(c.user_id, c.full_name || c.user_id.slice(0, 8));
  for (const t of [...realizadas, ...activas] as TareaPanel[]) {
    if (!nombres.has(t.user_id)) nombres.set(t.user_id, t.full_name || t.user_id.slice(0, 8));
  }
  const l = lunes(ahora);
  const m = inicioMes(ahora);
  return [...nombres.entries()]
    .map(([user_id, nombre]) => {
      const mias = realizadas.filter((t) => t.user_id === user_id && t.completed_at);
      const fechas = mias
        .map((t) => new Date(t.completed_at as string))
        .filter((d) => !Number.isNaN(d.getTime()));
      const ex = extras[user_id] ?? {};
      return {
        user_id,
        nombre,
        hoy: metrica(fechas.filter((d) => mismoDia(d, ahora)).length, true),
        semana: metrica(fechas.filter((d) => d >= l).length, true),
        mes: metrica(fechas.filter((d) => d >= m).length, true),
        retrasadas: metrica(retrasadasPorComercial[user_id] ?? 0, true),
        llamadas: metrica(ex.llamadas ?? null, typeof ex.llamadas === "number"),
        whatsapps: metrica(ex.whatsapps ?? null, typeof ex.whatsapps === "number"),
      };
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/* ---------------- Compensación y reglas ---------------- */

export type BloqueCompensacion = { titulo: string; detalle: string; indicadores: string };

export const COMPENSACION: readonly BloqueCompensacion[] = [
  {
    titulo: "Bloque de comisión por trabajo bien hecho",
    indicadores: "Indicadores 1 + 3 + 4",
    detalle:
      "Un importe por llamada útil cuando la información queda registrada, el canal de WhatsApp queda validado y la llamada cumple el guion.",
  },
  {
    titulo: "Cuadro de rentas, escalonado",
    indicadores: "Indicador 2",
    detalle:
      "Importe completo si el cuadro de rentas y vencimientos se consigue entero; importe parcial si se consigue a medias; sin importe si no se consigue ni se documenta el motivo.",
  },
  {
    titulo: "Seguimiento hasta cerrar el ciclo",
    indicadores: "Indicador 5",
    detalle:
      "Importe por ciclo cerrado en plazo: mitad por cumplir la cadencia, mitad por dejar el ciclo cerrado con su desenlace.",
  },
  {
    titulo: "Reunión cualificada con especialista",
    indicadores: "Indicador 6",
    detalle: "Importe por reunión registrada y confirmada con el especialista.",
  },
] as const;

export const REGLAS_JUEGO_LIMPIO: readonly string[] = [
  "La oportunidad nunca es opinión de la máquina: hace falta cita textual del propietario.",
  "Los estados de cierre los escribe el sistema tras analizar la llamada, no el comercial.",
  'El cierre por "no hay oportunidad" lo valida el responsable por muestreo.',
] as const;
