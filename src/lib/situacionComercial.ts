/** Situación comercial del edificio, en lenguaje llano. */
export const SITUACIONES_EDIFICIO = [
  "identificado",
  "contactado",
  "posible_interes",
  "en_estudio",
  "descartado",
] as const;

export type SituacionEdificio = (typeof SITUACIONES_EDIFICIO)[number];

export const SITUACION_LABEL: Record<string, string> = {
  identificado: "Identificado",
  contactado: "Contactado",
  posible_interes: "Posible interés",
  en_estudio: "En estudio",
  descartado: "Descartado",
};

/** Descripción de apoyo para la nueva situación. */
export const POSIBLE_INTERES_AYUDA =
  "Contacto receptivo aunque hoy diga que no vende. Es un paso anterior a interesado u oferta.";

export function situacionLabel(valor?: string | null): string {
  if (!valor) return "Sin situación";
  return SITUACION_LABEL[valor] ?? valor;
}

export function esPosibleInteres(valor?: string | null): boolean {
  return valor === "posible_interes";
}
