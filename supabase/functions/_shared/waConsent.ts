/**
 * Validación legal del consentimiento de WhatsApp.
 * Lógica pura, compartida por funciones edge, frontend y tests.
 *
 * Regla de oro: NADA se marca como autorizado si no supera las tres
 * comprobaciones (cita literal, atribución al propietario, aceptación
 * explícita) y si la llamada contiene un veto (lista Robinson, protección
 * de datos, baja, queja por el origen del dato).
 */

export type VeredictoWa = 'autorizado' | 'rechazado' | 'dudoso' | 'no_tratado';

/** De dónde viene el consentimiento. Nunca se mezclan en los contadores. */
export type OrigenConsentimiento =
  | 'cliente'   // lo marcó el cliente en su CRM, sin intervención nuestra
  | 'sistema'   // lo dedujo nuestro detector a partir de una transcripción
  | 'comercial' // lo registró a mano una persona del equipo
  | 'revocacion'; // baja registrada a mano

export const MOTIVO = {
  citaAusente: 'cita_no_encontrada_en_transcripcion',
  citaVacia: 'sin_cita_textual',
  atribucion: 'cita_no_atribuible_al_propietario',
  noExplicita: 'sin_aceptacion_explicita_de_whatsapp',
  veto: 'veto_privacidad',
  telefono: 'telefono_distinto_al_de_la_ficha',
  plantilla: 'cita_de_plantilla_no_es_evidencia',
} as const;

export type MotivoWa = typeof MOTIVO[keyof typeof MOTIVO] | string;

/** Frases fijas que el código escribía como si fueran del propietario. */
export const CITAS_DE_PLANTILLA = [
  'el propietario ha autorizado por telefono el envio de whatsapp.',
  'canal whatsapp abierto en hubspot.',
];

export function normalizarTexto(input: unknown): string {
  return String(input ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizarTelefono(input: unknown): string {
  const soloDigitos = String(input ?? '').replace(/\D/g, '');
  return soloDigitos.length > 9 ? soloDigitos.slice(-9) : soloDigitos;
}

/** 1) La cita tiene que estar LITERALMENTE en la transcripción. */
export function citaExisteLiteral(transcripcion: unknown, cita: unknown): boolean {
  const c = normalizarTexto(cita);
  if (c.length < 8) return false;
  return normalizarTexto(transcripcion).includes(c);
}

const MARCAS_COMERCIAL = [
  'te mando', 'te envio', 'te paso', 'te escribo', 'le mando', 'le envio', 'le paso',
  'le escribo', 'os mando', 'os envio', 'ahora te lo mando', 'se lo mando', 'se lo envio',
  'te lo mando', 'te lo envio', 'te lo paso', 'voy a mandarte', 'voy a enviarle',
];

const MARCAS_PROPIETARIO = [
  'mandame', 'mandamelo', 'mandamela', 'enviame', 'enviamelo', 'envieme', 'mandeme',
  'mandemelo', 'escribeme', 'escribame', 'pasamelo', 'paseme', 'me lo mandas',
  'me lo envias', 'me lo manda', 'me lo envia', 'prefiero por whatsapp',
  'mejor por whatsapp', 'por whatsapp mejor', 'si me haces el favor',
];

export type Atribucion = 'propietario' | 'comercial' | 'desconocida';

/**
 * 2) La cita tiene que ser del propietario. Las transcripciones no traen
 * etiquetas de interlocutor, así que se atribuye por la forma del habla:
 * quien pide recibir ("mándame") es el propietario; quien ofrece enviar
 * ("te mando") es el comercial.
 */
export function atribucionCita(cita: unknown): Atribucion {
  const c = normalizarTexto(cita);
  if (!c) return 'desconocida';
  const esComercial = MARCAS_COMERCIAL.some((m) => c.includes(m));
  const esPropietario = MARCAS_PROPIETARIO.some((m) => c.includes(m));
  if (esPropietario && !esComercial) return 'propietario';
  if (esComercial && !esPropietario) return 'comercial';
  return 'desconocida';
}

const MENCION_WA = /(whats\s?app|whatsap|wasap|guasap|wasa|whats)/;

/** 3) La cita tiene que pedir o aceptar expresamente recibir el mensaje. */
export function esAceptacionExplicita(cita: unknown): boolean {
  const c = normalizarTexto(cita);
  if (!c) return false;
  if (CITAS_DE_PLANTILLA.includes(`${c}.`) || CITAS_DE_PLANTILLA.some((p) => normalizarTexto(p) === c)) return false;
  if (!MENCION_WA.test(c)) return false;
  return MARCAS_PROPIETARIO.some((m) => c.includes(m));
}

export const PATRONES_VETO: Array<{ motivo: string; re: RegExp }> = [
  { motivo: 'lista_robinson', re: /lista robinson|en robinson/ },
  { motivo: 'proteccion_de_datos', re: /proteccion de datos|rgpd|lopd|agencia espanola de proteccion/ },
  { motivo: 'peticion_de_baja', re: /darme de baja|dar de baja|deme de baja|borren mis datos|borrar mis datos|elimine mis datos|no me llamen mas|no vuelvan a llamar/ },
  { motivo: 'queja_origen_del_dato', re: /de donde (ha|han|habeis|habeis) (sacado|obtenido)|donde lo ha obtenido|de donde sacan|quien les ha dado mi|como habeis llegado a los telefonos|como han conseguido mi/ },
];

export function detectarVeto(transcripcion: unknown): { vetado: boolean; motivos: string[] } {
  const t = normalizarTexto(transcripcion);
  const motivos = PATRONES_VETO.filter((p) => p.re.test(t)).map((p) => p.motivo);
  return { vetado: motivos.length > 0, motivos };
}

export type EntradaValidacion = {
  veredicto: VeredictoWa;
  cita?: string | null;
  transcripcion?: string | null;
  telefonoLlamada?: string | null;
  telefonoFicha?: string | null;
};

export type ResultadoValidacion = {
  veredicto: VeredictoWa;
  /** Sólo true si supera las tres comprobaciones y no hay veto. */
  apto_para_escritura: boolean;
  requiere_revision: boolean;
  motivos: MotivoWa[];
  vetos: string[];
  atribucion: Atribucion;
};

/**
 * Comprueba las tres condiciones y el veto. Si falla una sola, el veredicto
 * baja a «dudoso» y no se escribe en ningún sitio.
 */
export function validarConsentimiento(e: EntradaValidacion): ResultadoValidacion {
  const motivos: MotivoWa[] = [];
  const { vetado, motivos: vetos } = detectarVeto(e.transcripcion ?? '');

  if (e.veredicto !== 'autorizado') {
    return {
      veredicto: e.veredicto,
      apto_para_escritura: false,
      requiere_revision: false,
      motivos: vetado ? [MOTIVO.veto] : [],
      vetos,
      atribucion: 'desconocida',
    };
  }

  const cita = String(e.cita ?? '').trim();
  if (!cita) motivos.push(MOTIVO.citaVacia);
  if (cita && CITAS_DE_PLANTILLA.some((p) => normalizarTexto(p) === normalizarTexto(cita))) {
    motivos.push(MOTIVO.plantilla);
  }
  if (cita && e.transcripcion != null && !citaExisteLiteral(e.transcripcion, cita)) {
    motivos.push(MOTIVO.citaAusente);
  }
  const atribucion = atribucionCita(cita);
  if (atribucion !== 'propietario') motivos.push(MOTIVO.atribucion);
  if (!esAceptacionExplicita(cita)) motivos.push(MOTIVO.noExplicita);

  const telLlamada = normalizarTelefono(e.telefonoLlamada);
  const telFicha = normalizarTelefono(e.telefonoFicha);
  if (telLlamada && telFicha && telLlamada !== telFicha) motivos.push(MOTIVO.telefono);

  if (vetado) motivos.push(MOTIVO.veto);

  const limpio = motivos.length === 0;
  return {
    veredicto: limpio ? 'autorizado' : 'dudoso',
    apto_para_escritura: limpio,
    requiere_revision: !limpio,
    motivos,
    vetos,
    atribucion,
  };
}

export type SenalConsentimiento = {
  id?: string | null;
  owner_id?: string | null;
  veredicto?: string | null;
  fecha_llamada?: string | null;
  detectado_at?: string | null;
  review_status?: string | null;
  fuente?: string | null;
  origen?: string | null;
  hs_call_id?: string | null;
  cita_textual?: string | null;
};

export type EstadoConsentimiento = {
  autorizado: boolean;
  fecha: string | null;
  origen: OrigenConsentimiento | null;
  senal: SenalConsentimiento | null;
  /** true si la señal más reciente es un rechazo posterior a un sí. */
  revocado: boolean;
};

const AFIRMATIVOS = ['autorizado', 'si', 'sí', 'true', 'yes', 'concedido'];
const NEGATIVOS = ['rechazado', 'no', 'false', 'revocado', 'denegado'];

function instante(s: SenalConsentimiento): number {
  const t = Date.parse(String(s.fecha_llamada ?? s.detectado_at ?? ''));
  return Number.isFinite(t) ? t : 0;
}

function origenDe(s: SenalConsentimiento): OrigenConsentimiento {
  const o = String(s.origen ?? '').toLowerCase();
  if (o === 'cliente' || o === 'sistema' || o === 'comercial' || o === 'revocacion') return o;
  const f = String(s.fuente ?? '').toLowerCase();
  if (f === 'hubspot') return 'cliente';
  if (f.startsWith('tarjeta') || f.includes('manual')) return 'comercial';
  return 'sistema';
}

/**
 * Vale SIEMPRE la señal más reciente: un «no» posterior revoca el «sí».
 * Las señales en revisión o revocadas no cuentan como autorización.
 */
export function resolverConsentimiento(
  senales: readonly SenalConsentimiento[] | null | undefined,
  ownerId: string,
): EstadoConsentimiento {
  const propias = (senales ?? [])
    .filter((s) => String(s?.owner_id ?? '') === ownerId)
    .filter((s) => {
      const v = String(s?.veredicto ?? '').trim().toLowerCase();
      return AFIRMATIVOS.includes(v) || NEGATIVOS.includes(v);
    })
    .sort((a, b) => instante(b) - instante(a));

  if (propias.length === 0) return { autorizado: false, fecha: null, origen: null, senal: null, revocado: false };

  // Fail-closed: cualquier marca de revisión distinta de una aprobación
  // humana explícita deja la señal fuera de juego.
  const APROBACIONES = ['aprobado', 'validado', 'aprobada', 'validada'];
  const vigentes = propias.filter((s) => {
    const r = String(s?.review_status ?? '').trim().toLowerCase();
    return r === '' || APROBACIONES.includes(r);
  });

  const ultima = vigentes[0] ?? null;
  const ultimaGlobal = propias[0];
  const negativoReciente = NEGATIVOS.includes(String(ultimaGlobal.veredicto ?? '').toLowerCase());

  if (!ultima || negativoReciente || NEGATIVOS.includes(String(ultima.veredicto ?? '').toLowerCase())) {
    const previoSi = propias.some((s) => AFIRMATIVOS.includes(String(s.veredicto ?? '').toLowerCase()));
    return {
      autorizado: false,
      fecha: null,
      origen: null,
      senal: ultimaGlobal,
      revocado: previoSi,
    };
  }

  const fechaRaw = ultima.fecha_llamada ?? ultima.detectado_at ?? null;
  return {
    autorizado: true,
    fecha: fechaRaw ? new Date(fechaRaw).toISOString() : null,
    origen: origenDe(ultima),
    senal: ultima,
    revocado: false,
  };
}

/** Contadores separados: origen cliente vs propuesto por el sistema. */
export function contarPorOrigen(senales: readonly SenalConsentimiento[] | null | undefined) {
  const out = { cliente: 0, sistema: 0, comercial: 0, revocacion: 0 };
  for (const s of senales ?? []) {
    if (!AFIRMATIVOS.includes(String(s?.veredicto ?? '').toLowerCase())) continue;
    out[origenDe(s)]++;
  }
  return out;
}

/**
 * Busca en una transcripción la frase del PROPIETARIO que pide o acepta
 * recibir el WhatsApp. Determinista: sin modelo de lenguaje, sin inventar.
 * Devuelve null si no hay ninguna frase que supere las tres comprobaciones.
 */
export function extraerCitaConsentimiento(transcripcion: unknown): string | null {
  const texto = String(transcripcion ?? '');
  if (!texto.trim()) return null;
  const frases = texto
    .split(/(?<=[.!?¿¡\n])\s+/)
    .map((f) => f.trim())
    .filter((f) => f.length >= 8 && f.length <= 320);
  for (const frase of frases) {
    if (!MENCION_WA.test(normalizarTexto(frase))) continue;
    if (atribucionCita(frase) !== 'propietario') continue;
    if (!esAceptacionExplicita(frase)) continue;
    return frase;
  }
  return null;
}
