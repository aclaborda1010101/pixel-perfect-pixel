// Perfiles de propietario (buyer_persona) — mapeo único y consistente.
// Se usa para pintar un único perfil asignado en la ficha del propietario
// y en el brief Voss (nunca cadenas tipo "T5-T2" ni "T9 T5 T2").

export type BuyerPersona =
  | "sin_clasificar"
  | "cansado"
  | "desplazado"
  | "controla"
  | "ego"
  | "no_traspasa"
  | "vive_edificio"
  | "no_primero";

/** Nombre corto y código T{n} asociado a cada buyer_persona. */
export const BUYER_PERSONA_META: Record<string, { code: string; label: string; nombre: string }> = {
  cansado:        { code: "T1", label: "T1 · Cansado",              nombre: "Cansado del edificio" },
  desplazado:     { code: "T2", label: "T2 · Desplazado",           nombre: "Ya no vive en el edificio" },
  controla:       { code: "T3", label: "T3 · Controla",             nombre: "Gestor / decide en la familia" },
  ego:            { code: "T4", label: "T4 · Ego",                  nombre: "Emocional / apego alto" },
  no_traspasa:    { code: "T5", label: "T5 · No heredar problemas", nombre: "Senior · dejar orden en vida" },
  vive_edificio:  { code: "T6", label: "T6 · Vive en el edificio",  nombre: "Reside en el propio edificio" },
  no_primero:     { code: "T7", label: "T7 · No es el primero",     nombre: "Cuota pequeña, sigue al mayoritario" },
};

/** Devuelve el perfil ÚNICO asignado a un propietario a partir de buyer_persona. */
export function perfilAsignado(buyerPersona?: string | null): { code: string; label: string; nombre: string; asignado: boolean } {
  const raw = String(buyerPersona ?? "").trim().toLowerCase();
  if (!raw || raw === "sin_clasificar") {
    return { code: "T?", label: "Sin clasificar (a confirmar en llamada)", nombre: "Sin clasificar", asignado: false };
  }
  const m = BUYER_PERSONA_META[raw];
  if (m) return { ...m, asignado: true };
  return { code: raw.toUpperCase(), label: raw, nombre: raw, asignado: true };
}

/**
 * Normaliza una cadena libre como "T9 T5 T2" o "T5-T2" o "T5 · No heredar" al PRIMER token T{n}.
 * Si no encuentra código Tn, devuelve el texto tal cual (recortado al primer segmento antes de `-`, `·`, `/`).
 */
export function normalizeTipologiaString(s: string | null | undefined): string {
  if (!s) return "";
  const m = String(s).match(/T\d{1,2}(?:\s*[·\-–.:]\s*[^\s/,;|]+)?/i);
  if (m) return m[0];
  return String(s).split(/[\s\/\-–·|,]+/)[0] ?? String(s);
}