/**
 * Lógica pura del bloque de WhatsApp de la tarjeta de primera llamada.
 * Compartida por las funciones edge, el frontend y los tests.
 */

export const PLANTILLA_T23_POR_DEFECTO =
  'Hola {nombre}, soy {comercial} de Afflux Property. Como hemos hablado ahora por teléfono, te escribo por aquí para enviarte la información de tu edificio de {direccion}. Para cualquier cosa me tienes en este número. Un saludo.';

export type VariablesPlantilla = {
  nombre?: string | null;
  comercial?: string | null;
  direccion?: string | null;
};

/** Sustituye {nombre}, {comercial} y {direccion}. Nada más se toca. */
export function renderPlantilla(texto: string | null | undefined, v: VariablesPlantilla): string {
  const base = (texto ?? '').trim() === '' ? PLANTILLA_T23_POR_DEFECTO : String(texto);
  const val: Record<string, string> = {
    nombre: (v.nombre ?? '').trim() || 'hola',
    comercial: (v.comercial ?? '').trim() || 'tu contacto',
    direccion: (v.direccion ?? '').trim() || 'tu edificio',
  };
  return base.replace(/\{(nombre|comercial|direccion)\}/g, (_m, k: string) => val[k]);
}

export type ModoEnvio = 'real' | 'prueba' | 'simulado';
export type Destino = { modo: ModoEnvio; telefono: string | null; motivo?: string };

export function normalizarTelefono(input: string | null | undefined): string {
  return String(input ?? '').replace(/[^0-9]/g, '');
}

/**
 * Decide a dónde va el mensaje. Con modo prueba activo NUNCA se envía al
 * teléfono del propietario: o va al número de prueba, o queda simulado.
 */
export function decidirDestino(input: {
  modoPrueba: boolean;
  numeroPrueba?: string | null;
  telefonoPropietario?: string | null;
}): Destino {
  const propietario = normalizarTelefono(input.telefonoPropietario);
  if (input.modoPrueba) {
    const prueba = normalizarTelefono(input.numeroPrueba);
    if (prueba) return { modo: 'prueba', telefono: prueba };
    return { modo: 'simulado', telefono: null, motivo: 'modo_prueba_sin_numero' };
  }
  if (!propietario) return { modo: 'simulado', telefono: null, motivo: 'propietario_sin_telefono' };
  return { modo: 'real', telefono: propietario };
}

export type SenalConsentimiento = {
  owner_id?: string | null;
  veredicto?: string | null;
};

const VEREDICTOS_AFIRMATIVOS = ['si', 'sí', 'true', 'yes', 'concedido', 'autorizado'];

/** Hay consentimiento si existe al menos una señal afirmativa de ese propietario. */
export function tieneConsentimiento(
  senales: readonly SenalConsentimiento[] | null | undefined,
  ownerId: string,
): boolean {
  return (senales ?? []).some(
    (s) =>
      String(s?.owner_id ?? '') === ownerId &&
      VEREDICTOS_AFIRMATIVOS.includes(String(s?.veredicto ?? '').trim().toLowerCase()),
  );
}

export type SenalConsentimientoDetalle = SenalConsentimiento & {
  detectado_at?: string | null;
  fecha_llamada?: string | null;
  fuente?: string | null;
  hs_call_id?: string | null;
};

export type ResumenConsentimiento = {
  autorizado: boolean;
  /** Fecha ISO de la autorización más antigua encontrada. */
  fecha: string | null;
  /** Origen en lenguaje llano: 'llamada' o 'registro'. */
  origen: 'llamada' | 'registro' | null;
};

/**
 * Resume la autorización ya registrada de un propietario: si existe, desde
 * cuándo y de dónde viene. Sirve para mostrarla marcada y bloqueada.
 */
export function resumenConsentimiento(
  senales: readonly SenalConsentimientoDetalle[] | null | undefined,
  ownerId: string,
): ResumenConsentimiento {
  const afirmativas = (senales ?? []).filter(
    (s) =>
      String(s?.owner_id ?? '') === ownerId &&
      VEREDICTOS_AFIRMATIVOS.includes(String(s?.veredicto ?? '').trim().toLowerCase()),
  );
  if (afirmativas.length === 0) return { autorizado: false, fecha: null, origen: null };
  const conFecha = afirmativas
    .map((s) => ({
      s,
      t: Date.parse(String(s.fecha_llamada ?? s.detectado_at ?? '')),
    }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t);
  const elegida = conFecha[0]?.s ?? afirmativas[0];
  const fechaRaw = elegida.fecha_llamada ?? elegida.detectado_at ?? null;
  const origen: 'llamada' | 'registro' | null = elegida.hs_call_id
    ? 'llamada'
    : elegida.fuente
      ? 'registro'
      : null;
  return {
    autorizado: true,
    fecha: fechaRaw ? new Date(fechaRaw).toISOString() : null,
    origen,
  };
}

export type ClaveGenerada = { code: string; buildingId: string; subjectId: string };

export type TextoFinal = { texto: string; editado: boolean };

/**
 * Decide qué texto se envía: el propuesto por el comercial si lo ha tocado,
 * o el montado por la plantilla. Marca si hubo edición a mano.
 */
export function resolverTextoFinal(base: string, propuesto: unknown): TextoFinal {
  const original = String(base ?? '');
  if (typeof propuesto !== 'string') return { texto: original, editado: false };
  const limpio = propuesto.trim();
  if (limpio === '' || limpio === original.trim()) return { texto: original, editado: false };
  return { texto: limpio, editado: true };
}

/** Lee la clave del generador continuo: `v5:gen1:<code>:<building>:<subject>:<ts>`. */
export function parseGeneratedTaskKey(taskKey: unknown): ClaveGenerada | null {
  if (typeof taskKey !== 'string') return null;
  const seg = taskKey.split(':');
  if (seg.length !== 6) return null;
  const [p, gen, code, buildingId, subjectId] = seg;
  if (p !== 'v5' || gen !== 'gen1') return null;
  if (!code || !buildingId || !subjectId) return null;
  return { code, buildingId, subjectId };
}
