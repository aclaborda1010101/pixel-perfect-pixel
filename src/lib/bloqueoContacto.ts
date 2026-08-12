/**
 * Bloqueo de contacto cuando un edificio tiene un interlocutor activo.
 * Lógica pura, compartida por pantallas y pruebas. Lenguaje llano.
 */

export const TEXTO_CONTACTO_BLOQUEADO = "Bloqueado por interlocutor activo";

/** ¿Este propietario está bloqueado por el interlocutor activo del edificio? */
export function contactoBloqueado(
  interlocutorOwnerId: string | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  const inter = (interlocutorOwnerId ?? "").trim();
  if (!inter) return false;
  return !ownerId || ownerId !== inter;
}

/** Solo administración y responsable de equipo pueden saltarse el bloqueo. */
export function puedeAutorizarExcepcion(role: string | null | undefined): boolean {
  return role === "admin" || role === "sales_manager";
}

/** El comercial de zona nunca puede contactar a un propietario bloqueado. */
export function puedeContactar(
  role: string | null | undefined,
  bloqueado: boolean,
  excepcionAutorizada = false,
): boolean {
  if (!bloqueado) return true;
  if (puedeAutorizarExcepcion(role)) return excepcionAutorizada;
  return false;
}

/** El motivo de la excepción es obligatorio y con contenido real. */
export function motivoExcepcionValido(motivo: string | null | undefined): boolean {
  return (motivo ?? "").trim().length >= 5;
}

/** Texto de aviso para la ficha y las tarjetas. */
export function textoBloqueoContacto(nombreInterlocutor?: string | null): string {
  const quien = (nombreInterlocutor ?? "").trim();
  return quien
    ? `${TEXTO_CONTACTO_BLOQUEADO}: habla solo con ${quien}`
    : TEXTO_CONTACTO_BLOQUEADO;
}