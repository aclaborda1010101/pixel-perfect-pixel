import { legacyTaskSkip, type LegacyTaskSkip } from "../_shared/legacyTasks.ts";

export type TecnofindJob = {
  id?: string;
  building_id?: string | null;
  titular_nombre?: string | null;
  datos?: { telefono?: string | null } | null;
};

export type TecnofindDeps = {
  pushTimeline: (job: TecnofindJob, entry: Record<string, unknown>) => void;
  finishJob: (job: TecnofindJob, patch: Record<string, unknown>) => Promise<unknown>;
};

export type TecnofindResult = {
  ok: true;
  fase: "tecnofind";
  task_created: false;
  incidencia: LegacyTaskSkip | null;
};

/**
 * Fase tecnofind (no automatizada).
 *
 * Antes insertaba una tarea automática en `building_tasks` cuando faltaba
 * teléfono. Ese productor está retirado: ahora solo se registra la incidencia
 * en el timeline del job y el enriquecimiento continúa igual.
 */
export async function handleTecnofindCore(
  job: TecnofindJob,
  deps: TecnofindDeps,
): Promise<TecnofindResult> {
  const tienePhone = !!job?.datos?.telefono;
  let incidencia: LegacyTaskSkip | null = null;

  if (!tienePhone && job?.building_id) {
    incidencia = legacyTaskSkip("telefono_pendiente_tecnofind", {
      building_id: job.building_id,
      enrichment_job_id: job.id ?? null,
      titular: job.titular_nombre ?? null,
    });
    deps.pushTimeline(job, { fase: "tecnofind", nota: incidencia.reason, task_created: false });
  }

  await deps.finishJob(job, { estado: "ok", fase: "verificacion", datos: job?.datos });
  return { ok: true, fase: "tecnofind", task_created: false, incidencia };
}