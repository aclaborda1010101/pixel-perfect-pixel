/**
 * Interlocutor activo de un edificio: lógica pura compartida por
 * frontend, Edge Functions y tests.
 *
 * Regla: si un edificio tiene interlocutor activo, no se generan tareas
 * nuevas dirigidas a otros propietarios de ese edificio. Las dirigidas al
 * propio interlocutor sí se permiten.
 */

export type Interlocutor = {
  owner_id: string | null;
  nombre?: string | null;
  motivo?: string | null;
  marcado_por?: string | null;
  marcado_at?: string | null;
};

export function hayInterlocutorActivo(interlocutorOwnerId?: string | null): boolean {
  return typeof interlocutorOwnerId === 'string' && interlocutorOwnerId.trim() !== '';
}

/** ¿Se puede dirigir una tarea nueva a este propietario? */
export function permiteTareaHaciaPropietario(
  interlocutorOwnerId: string | null | undefined,
  ownerId: string | null | undefined,
): boolean {
  if (!hayInterlocutorActivo(interlocutorOwnerId)) return true;
  return !!ownerId && ownerId === interlocutorOwnerId;
}

/** Deja sólo a los propietarios contactables del edificio. */
export function propietariosContactables<T extends { owner_id?: string | null }>(
  interlocutorOwnerId: string | null | undefined,
  owners: T[],
): T[] {
  if (!hayInterlocutorActivo(interlocutorOwnerId)) return owners;
  return owners.filter((o) => o.owner_id === interlocutorOwnerId);
}

/** Texto llano de la bandera, sin jerga interna. */
export function textoBanderaInterlocutor(nombre?: string | null): string {
  const quien = (nombre ?? '').trim() || 'propietario designado';
  return `Interlocutor activo: ${quien} — no contactar a otros propietarios`;
}
