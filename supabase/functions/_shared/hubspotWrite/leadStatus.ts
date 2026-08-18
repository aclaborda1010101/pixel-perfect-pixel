// Lógica pura para la puesta al día del estado de ciclo (hs_lead_status) en HubSpot.
// Alcance estricto: sólo esta propiedad. No toca campos comerciales.

export type OpcionPortal = { label: string; value: string; displayOrder?: number };

export const ETIQUETA_OBJETIVO = "Contactado";

/** Orden de respaldo si el portal no devolviera opciones. */
export const ORDEN_RESPALDO = [
  "no contactado",
  "nuevo",
  "intento de contacto",
  "contactado",
  "primer contacto",
  "visitado",
  "evaluacion",
  "en negociacion",
  "no vende",
];

export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/** Opciones del portal ordenadas por displayOrder; devuelve etiqueta+valor internos. */
export function ordenarOpciones(opciones: OpcionPortal[]): OpcionPortal[] {
  return [...opciones].sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
}

/** Índice de un estado (por valor interno o etiqueta) dentro del orden del portal. */
export function indiceEstado(estado: string | null | undefined, orden: OpcionPortal[]): number {
  const n = normalizar(estado);
  if (n === "") return -1;
  const i = orden.findIndex((o) => normalizar(o.value) === n || normalizar(o.label) === n);
  if (i >= 0) return i;
  return ORDEN_RESPALDO.indexOf(n);
}

export type Decision =
  | { accion: "escribir"; valor: string }
  | { accion: "ya_resuelto"; motivo: string }
  | { accion: "no_aplicable"; motivo: string };

/**
 * Decide si hay que escribir "Contactado" en un contacto.
 * - Vacío o anterior a Contactado → escribir.
 * - Igual o posterior → ya resuelto, no se pisa.
 * - Estado no reconocido → no se toca (prudencia).
 */
export function decidirLeadStatus(params: {
  actual: string | null | undefined;
  orden: OpcionPortal[];
  valorObjetivo: string | null;
}): Decision {
  const { actual, orden, valorObjetivo } = params;
  if (!valorObjetivo) return { accion: "no_aplicable", motivo: "objetivo_inexistente_en_portal" };
  const iObjetivo = indiceEstado(valorObjetivo, orden);
  const n = normalizar(actual);
  if (n === "") return { accion: "escribir", valor: valorObjetivo };
  const iActual = indiceEstado(actual, orden);
  if (iActual < 0) return { accion: "no_aplicable", motivo: `estado_no_reconocido:${actual}` };
  if (iActual >= iObjetivo) return { accion: "ya_resuelto", motivo: `estado_igual_o_posterior:${actual}` };
  return { accion: "escribir", valor: valorObjetivo };
}

/** Trocea una lista en lotes del tamaño indicado (límite de la API de HubSpot). */
export function lotes<T>(items: T[], tam: number): T[][] {
  const out: T[][] = [];
  const paso = Math.max(1, tam);
  for (let i = 0; i < items.length; i += paso) out.push(items.slice(i, i + paso));
  return out;
}
