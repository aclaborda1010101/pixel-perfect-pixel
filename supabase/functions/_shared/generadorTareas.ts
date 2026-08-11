/**
 * GENERADOR CONTINUO DE TAREAS V1 — lógica pura y portable.
 * Compartida por la Edge Function (Deno), el frontend y los tests.
 *
 * Redacta tarjetas en lenguaje llano: nada de jerga interna.
 */

export const TIPOS = ['T-01', 'T-02_03', 'T-04', 'T-05', 'T-06', 'T-08'] as const;
export type Tipo = (typeof TIPOS)[number];

/** Clave de la mezcla de work_modes que corresponde a cada tipo. */
export const MIX_KEY: Record<Tipo, string> = {
  'T-01': 'T1',
  'T-02_03': 'T2_T3',
  'T-04': 'T4',
  'T-05': 'T5',
  'T-06': 'T6',
  'T-08': 'T8',
};

export const MIX_POR_DEFECTO: Record<string, number> = {
  T1: 25, T2_T3: 50, T4: 10, T5: 5, T6: 5, T8: 5,
};

/** Términos vetados por el cliente en cualquier texto visible de la tarjeta. */
export const TERMINOS_PROHIBIDOS = [
  'disparador', 'v5', 'backlog', 'motor', 'evidencia', 'guarda', 'orquestador',
] as const;

export function contieneTerminoProhibido(texto: string): string | null {
  const t = (texto ?? '').toLowerCase();
  for (const term of TERMINOS_PROHIBIDOS) if (t.includes(term)) return term;
  return null;
}

/**
 * Elige el tipo con mayor déficit respecto a la mezcla configurada,
 * limitado a los tipos que tienen candidato real.
 */
export function elegirTipo(input: {
  mix: Record<string, number> | null;
  historico: string[];
  disponibles: readonly Tipo[];
}): Tipo {
  const disponibles = input.disponibles.length > 0 ? input.disponibles : TIPOS;
  const mix = input.mix && Object.keys(input.mix).length > 0 ? input.mix : MIX_POR_DEFECTO;
  const totalMix = Object.values(mix).reduce((a, b) => a + (Number(b) || 0), 0) || 100;
  const n = input.historico.length;
  let mejor: Tipo = disponibles[0];
  let mejorDeficit = -Infinity;
  for (const tipo of disponibles) {
    const objetivo = (Number(mix[MIX_KEY[tipo]]) || 0) / totalMix;
    const hechas = input.historico.filter((h) => h === tipo).length;
    const actual = n === 0 ? 0 : hechas / n;
    const deficit = objetivo - actual;
    if (deficit > mejorDeficit + 1e-9) { mejorDeficit = deficit; mejor = tipo; }
  }
  return mejor;
}

/** Suma días laborables (lunes a viernes) a una fecha. */
export function sumarDiasLaborables(desde: Date, dias: number): Date {
  const d = new Date(desde.getTime());
  let restantes = dias;
  while (restantes > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) restantes--;
  }
  return d;
}

/** Fecha límite = hoy + 2 días laborables. */
export function proximaFechaLimite(desde: Date): Date {
  return sumarDiasLaborables(desde, 2);
}

/** Clave estable y única de la tarea (formato interno, nunca visible). */
export function taskKeyFor(tipo: Tipo, buildingId: string, subjectId: string, now: Date): string {
  const code = MIX_KEY[tipo];
  return `v5:gen1:${code}:${buildingId}:${subjectId}:${now.toISOString().slice(0, 19).replace(/[:T-]/g, '')}`;
}

export type ContextoTarjeta = {
  direccion: string;
  ciudad?: string | null;
  propietario?: string | null;
  telefono?: string | null;
  participacion?: number | string | null;
};

export type Tarjeta = {
  title: string;
  description: string;
  objetivo: string;
  pasos_registro: string;
};

function contacto(c: ContextoTarjeta): string {
  if (c.propietario && c.telefono) return `${c.propietario} (teléfono ${c.telefono})`;
  if (c.propietario) return `${c.propietario} (sin teléfono en ficha: búscalo antes de llamar)`;
  return 'el propietario principal (aún sin nombre en la ficha: identifícalo primero)';
}

/** Redacta la tarjeta con las 3 secciones obligatorias y en lenguaje llano. */
export function redactarTarjeta(tipo: Tipo, c: ContextoTarjeta): Tarjeta {
  const dir = c.direccion;
  const quien = contacto(c);
  const parte = c.participacion != null ? ` Su participación en el edificio es del ${c.participacion}%.` : '';

  let title: string;
  let pasos: string[];
  let objetivo: string;
  let registro: string;

  switch (tipo) {
    case 'T-01':
      title = `Investigación — ${dir}`;
      pasos = [
        `Repasa la ficha de ${dir} y anota qué falta: propietarios, teléfonos y situación del edificio.`,
        `Busca datos de contacto de ${quien}.`,
        'Completa en la ficha todo lo que encuentres.',
      ];
      objetivo = `Dejar la ficha de ${dir} lista para poder llamar.`;
      registro = 'Guarda los datos encontrados en la ficha y deja una nota con lo que has averiguado.';
      break;
    case 'T-02_03':
      title = `Primera llamada — ${dir}`;
      pasos = [
        `Llama a ${quien}.${parte}`,
        'Preséntate, explica que trabajamos con edificios en su zona y pregunta si se ha planteado vender.',
        'Si no coge el teléfono, envíale un WhatsApp corto presentándote y proponiendo hablar.',
      ];
      objetivo = 'Conseguir la primera conversación real con el propietario.';
      registro = 'Registra la llamada con su resultado (contactado, no contesta, interesado, no interesado) para que el análisis funcione, y anota lo que te haya contado.';
      break;
    case 'T-04':
      title = `Seguimiento — ${c.propietario ?? dir}`;
      pasos = [
        `Repasa lo hablado la última vez con ${quien}.`,
        'Vuelve a llamarle y retoma la conversación donde quedó.',
        'Acuerda el siguiente paso concreto (nueva llamada, visita o envío de información).',
      ];
      objetivo = 'Mantener viva la conversación y avanzar hacia una propuesta.';
      registro = 'Registra la llamada con su resultado para que el análisis funcione, y apunta el siguiente paso acordado con su fecha.';
      break;
    case 'T-05':
      title = `Completar ficha — ${dir}`;
      pasos = [
        `Abre la ficha de ${dir} y revisa los campos vacíos.`,
        `Completa los datos del propietario: ${quien}.`,
        'Añade lo que sepas del edificio: estado, número de viviendas y situación de alquiler.',
      ];
      objetivo = `Tener la ficha de ${dir} completa y fiable.`;
      registro = 'Guarda los cambios en la ficha y deja una nota indicando qué has completado.';
      break;
    case 'T-06':
      title = `Verificación — ${dir}`;
      pasos = [
        `Contrasta los propietarios y sus porcentajes de ${dir} con lo que aparece en la nota del registro.`,
        `Confirma con ${quien} que los datos de contacto son correctos.`,
        'Corrige en la ficha cualquier diferencia que encuentres.',
      ];
      objetivo = 'Confirmar que los propietarios y sus porcentajes son correctos.';
      registro = 'Deja constancia en la ficha de lo verificado y, si has hablado con el propietario, registra la llamada con su resultado.';
      break;
    case 'T-08':
      title = `Revisión — ${dir}`;
      pasos = [
        `Revisa todo el historial de ${dir}: llamadas, mensajes y notas.`,
        'Decide si seguimos trabajando el edificio o lo aparcamos, y por qué.',
        `Si sigue vivo, prepara la próxima acción con ${quien}.`,
      ];
      objetivo = `Decidir el rumbo del edificio ${dir}.`;
      registro = 'Escribe una nota con la decisión tomada y, si has llamado, registra la llamada con su resultado.';
      break;
  }

  const description = [
    'Qué hacer',
    ...pasos.map((p, i) => `${i + 1}. ${p}`),
    '',
    'Objetivo',
    objetivo,
    '',
    'Al terminar',
    registro,
  ].join('\n');

  return { title, description, objetivo, pasos_registro: registro };
}
