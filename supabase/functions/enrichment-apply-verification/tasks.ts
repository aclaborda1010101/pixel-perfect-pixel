import { legacyTaskSkip, type LegacyTaskSkip } from "../_shared/legacyTasks.ts";

/**
 * Antes: insert automático en `building_tasks` ("Buscar teléfono en Tecnofind")
 * cuando la verificación aprobada no traía teléfono.
 *
 * Ahora: productor retirado. Devuelve la incidencia para el payload de
 * respuesta y NO toca ninguna tabla. No recibe cliente de base de datos a
 * propósito, para que no pueda volver a escribir.
 */
export function tecnofindIncidenciaTrasVerificacion(input: {
  buildingId?: string | null;
  telefono?: string | null;
  ownerId?: string | null;
  jobId?: string | null;
}): LegacyTaskSkip | null {
  if (!input.buildingId || input.telefono) return null;
  return legacyTaskSkip("telefono_pendiente_tecnofind", {
    building_id: input.buildingId,
    owner_id: input.ownerId ?? null,
    enrichment_job_id: input.jobId ?? null,
  });
}