/**
 * CADENCIAS DE SEGUIMIENTO POR SITUACIÓN DEL CONTACTO — lógica pura.
 *
 * Decide, para cada propietario, en qué situación está y cuándo puede
 * volver a proponerse una tarea de contacto. Sin acceso a datos: recibe
 * las llamadas registradas y la situación del edificio.
 *
 * Mapeo situación -> campos reales (no se añaden columnas):
 *  - intentos            = filas de `calls` del propietario
 *  - contacto conseguido = calls.outcome in (interesado, dudoso, no_interesado, otro)
 *                          o calls.duracion_seg >= 30
 *  - interés claro       = última llamada con contacto -> outcome = 'interesado'
 *  - receptivo           = buildings.estado = 'posible_interes'
 *                          o última llamada con contacto: outcome='dudoso' o sentiment='positivo'
 *  - frío                = contactado sin señal positiva (outcome no_interesado/otro, sentiment neutro/negativo)
 *  - sin respuesta       = hubo contacto real y después sólo intentos fallidos
 */

export type Llamada = {
  fecha: string | Date;
  outcome?: string | null;
  sentiment?: string | null;
  duracion_seg?: number | null;
};

export type Situacion =
  | 'no_contactado'
  | 'no_contactado_reintento'
  | 'no_contactado_agotado'
  | 'interes_claro'
  | 'receptivo'
  | 'sin_respuesta'
  | 'frio';

export type Cadencia = {
  situacion: Situacion;
  /** Fecha a partir de la cual se puede proponer la tarea. */
  elegibleDesde: Date;
  /** true si ya se puede proponer con la fecha de referencia dada. */
  elegible: boolean;
  /** Fecha límite de la tarea = fecha de cadencia + 2 días laborables. */
  fechaLimite: Date;
  /** Tipo de contacto permitido. */
  accion: 'primera_llamada' | 'seguimiento' | 'investigacion';
  /** Días de cadencia aplicados (0 = ya elegible). */
  dias: number;
};

const CONTACTO_OUTCOMES = new Set(['interesado', 'dudoso', 'no_interesado', 'otro']);
const DURACION_CONTACTO_SEG = 30;

export const MAX_INTENTOS_SIN_CONTACTO = 3;
export const VENTANA_INTENTOS_DIAS = 10;
export const REINTENTO_DIAS_LABORABLES = 3;
export const DIAS_FRIO = 45;
export const DIAS_RECEPTIVO = 14;
export const DIAS_INTERES = 7;
export const DIAS_SIN_RESPUESTA = 30;

export function huboContacto(c: Llamada): boolean {
  const o = (c.outcome ?? '').toLowerCase();
  if (CONTACTO_OUTCOMES.has(o)) return true;
  return Number(c.duracion_seg ?? 0) >= DURACION_CONTACTO_SEG;
}

function ts(f: string | Date): number {
  return (f instanceof Date ? f : new Date(f)).getTime();
}

function sumarDiasLaborables(desde: Date, dias: number): Date {
  const d = new Date(desde.getTime());
  let restantes = dias;
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  return d;
}

function sumarDias(desde: Date, dias: number): Date {
  const d = new Date(desde.getTime());
  d.setUTCDate(d.getUTCDate() + dias);
  return d;
}

/**
 * Calcula la situación del propietario y su fecha de cadencia.
 */
export function calcularCadencia(input: {
  llamadas: Llamada[];
  estadoEdificio?: string | null;
  ahora?: Date;
}): Cadencia {
  const ahora = input.ahora ?? new Date();
  const llamadas = [...(input.llamadas ?? [])]
    .filter((c) => c && c.fecha && !isNaN(ts(c.fecha)))
    .sort((a, b) => ts(a.fecha) - ts(b.fecha));

  const conContacto = llamadas.filter(huboContacto);
  const posibleInteres = String(input.estadoEdificio ?? '') === 'posible_interes';

  const armar = (
    situacion: Situacion,
    base: Date,
    dias: number,
    accion: Cadencia['accion'],
    laborables = false,
  ): Cadencia => {
    const elegibleDesde = dias === 0
      ? new Date(base.getTime())
      : laborables ? sumarDiasLaborables(base, dias) : sumarDias(base, dias);
    const referencia = elegibleDesde.getTime() <= ahora.getTime() ? ahora : elegibleDesde;
    return {
      situacion,
      elegibleDesde,
      elegible: elegibleDesde.getTime() <= ahora.getTime(),
      fechaLimite: sumarDiasLaborables(referencia, 2),
      accion,
      dias,
    };
  };

  // 1) Nunca se ha hablado con esta persona.
  if (conContacto.length === 0) {
    if (llamadas.length === 0) return armar('no_contactado', ahora, 0, 'primera_llamada');
    const primero = new Date(ts(llamadas[0].fecha));
    const ultimo = new Date(ts(llamadas[llamadas.length - 1].fecha));
    const dentroVentana = ts(ultimo) - ts(primero) <= VENTANA_INTENTOS_DIAS * 86400000;
    if (llamadas.length >= MAX_INTENTOS_SIN_CONTACTO || !dentroVentana) {
      // Tras el tercer intento sin éxito no se llama más: se investiga otro camino.
      return armar('no_contactado_agotado', ahora, 0, 'investigacion');
    }
    return armar('no_contactado_reintento', ultimo, REINTENTO_DIAS_LABORABLES, 'primera_llamada', true);
  }

  // 2) Ya hubo conversación real: sólo seguimiento.
  const ultimoContacto = conContacto[conContacto.length - 1];
  const fechaContacto = new Date(ts(ultimoContacto.fecha));
  const ultimoIntento = new Date(ts(llamadas[llamadas.length - 1].fecha));
  const outcome = (ultimoContacto.outcome ?? '').toLowerCase();
  const sentiment = (ultimoContacto.sentiment ?? '').toLowerCase();

  if (outcome === 'interesado') {
    return armar('interes_claro', fechaContacto, DIAS_INTERES, 'seguimiento');
  }
  if (posibleInteres || outcome === 'dudoso' || sentiment === 'positivo') {
    return armar('receptivo', fechaContacto, DIAS_RECEPTIVO, 'seguimiento');
  }
  // Hubo conversación seria y después sólo intentos sin respuesta.
  if (ts(ultimoIntento) > ts(fechaContacto)) {
    return armar('sin_respuesta', ultimoIntento, DIAS_SIN_RESPUESTA, 'seguimiento');
  }
  return armar('frio', fechaContacto, DIAS_FRIO, 'seguimiento');
}

/** Agrupa llamadas por propietario. */
export function agruparLlamadas(
  filas: Array<{ owner_id?: string | null } & Llamada>,
): Map<string, Llamada[]> {
  const m = new Map<string, Llamada[]>();
  for (const f of filas ?? []) {
    const id = f?.owner_id ? String(f.owner_id) : null;
    if (!id) continue;
    const arr = m.get(id) ?? [];
    arr.push({ fecha: f.fecha, outcome: f.outcome, sentiment: f.sentiment, duracion_seg: f.duracion_seg });
    m.set(id, arr);
  }
  return m;
}

/** ¿Permite esta cadencia proponer una tarea de este tipo hoy? */
export function permiteTipo(cad: Cadencia, tipo: string): boolean {
  if (tipo === 'T-02_03') return cad.elegible && cad.accion === 'primera_llamada';
  if (tipo === 'T-04') return cad.elegible && cad.accion === 'seguimiento';
  if (tipo === 'T-01') return true;
  return true;
}
