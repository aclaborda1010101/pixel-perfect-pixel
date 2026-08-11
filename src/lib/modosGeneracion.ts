/**
 * Modos de reparto para la generación continua de tareas — lógica PURA.
 * Nomenclatura de tipos idéntica a la de las tareas reales.
 */

export const TIPOS_TAREA = ['T-01', 'T-02_03', 'T-04', 'T-05', 'T-06', 'T-08'] as const;
export type TipoTarea = (typeof TIPOS_TAREA)[number];

export const ETIQUETA_TIPO: Record<TipoTarea, string> = {
  'T-01': 'Investigación',
  'T-02_03': 'Primera llamada y WhatsApp',
  'T-04': 'Seguimiento',
  'T-05': 'Completar ficha',
  'T-06': 'Verificación',
  'T-08': 'Revisión',
};

export type Mezcla = Record<string, number>;

export type ModoCodigo = 'apertura' | 'equilibrado' | 'seguimiento' | 'manual';

export const MODOS: readonly {
  code: ModoCodigo;
  label: string;
  descripcion: string;
  editable: boolean;
  mezcla?: Mezcla;
}[] = [
  {
    code: 'apertura',
    label: 'Apertura',
    descripcion: 'Prioriza abrir conversaciones nuevas con propietarios.',
    editable: false,
    mezcla: { 'T-01': 20, 'T-02_03': 60, 'T-04': 20, 'T-05': 0, 'T-06': 0, 'T-08': 0 },
  },
  {
    code: 'equilibrado',
    label: 'Equilibrado',
    descripcion: 'Reparto equilibrado entre abrir conversaciones y darles seguimiento.',
    editable: false,
    mezcla: { 'T-01': 20, 'T-02_03': 40, 'T-04': 40, 'T-05': 0, 'T-06': 0, 'T-08': 0 },
  },
  {
    code: 'seguimiento',
    label: 'Seguimiento',
    descripcion: 'Prioriza retomar las conversaciones ya iniciadas.',
    editable: false,
    mezcla: { 'T-01': 10, 'T-02_03': 15, 'T-04': 75, 'T-05': 0, 'T-06': 0, 'T-08': 0 },
  },
  {
    code: 'manual',
    label: 'Manual (personalizado)',
    descripcion: 'Tú decides el porcentaje de cada tipo de tarea. Debe sumar 100.',
    editable: true,
  },
] as const;

export type ValidacionMezcla = { valida: boolean; total: number; errores: string[] };

export function validarMezcla(mix: Mezcla | null | undefined): ValidacionMezcla {
  const errores: string[] = [];
  if (!mix || typeof mix !== 'object' || Array.isArray(mix)) {
    return { valida: false, total: 0, errores: ['No hay porcentajes definidos.'] };
  }
  let total = 0;
  for (const [k, v] of Object.entries(mix)) {
    if (!(TIPOS_TAREA as readonly string[]).includes(k)) {
      errores.push(`Tipo de tarea desconocido: ${k}`);
      continue;
    }
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) {
      errores.push(`Porcentaje no válido en ${k}: ${String(v)}`);
      continue;
    }
    total += v;
  }
  for (const t of TIPOS_TAREA) {
    if (!(t in mix)) errores.push(`Falta el tipo ${t}.`);
  }
  if (total !== 100) errores.push(`Los porcentajes deben sumar exactamente 100 (ahora suman ${total}).`);
  return { valida: errores.length === 0, total, errores };
}

export function mezclaVacia(): Record<TipoTarea, number> {
  const out = {} as Record<TipoTarea, number>;
  for (const t of TIPOS_TAREA) out[t] = 0;
  return out;
}

/** Puede cambiar el modo activo: solo dirección y responsables de ventas. */
export function puedeCambiarModo(rol: string | null | undefined): boolean {
  return rol === 'admin' || rol === 'sales_manager';
}
