/**
 * MOTOR V5 — FASE A.1 (enmienda). VOCABULARIO CANÓNICO DE ESTADOS.
 *
 * Única fuente de verdad para el estado de las tareas NO-legacy y para la
 * definición de "slot automático ocupado". La migración pendiente, los
 * helpers y la UI usan EXACTAMENTE esta definición: un typo, un `queued`
 * o cualquier valor libre NO puede eludir las invariantes.
 */

/** Estados canónicos reales. No hay alias: 'queued', 'todo', 'done'… no existen. */
export const V5_TASK_STATUSES = [
  "pending",
  "in_progress",
  "blocked",
  "completed",
  "skipped",
  "no_procede",
  "superseded",
  "cancelled",
] as const;
export type V5TaskStatus = (typeof V5_TASK_STATUSES)[number];

/** Abiertos: siguen vivos en la cola del comercial. */
export const V5_OPEN_STATUSES = ["pending", "in_progress", "blocked"] as const;
/** Terminales: cierran el ciclo. */
export const V5_TERMINAL_STATUSES = [
  "completed",
  "skipped",
  "no_procede",
  "superseded",
  "cancelled",
] as const;

/**
 * SLOT AUTOMÁTICO OCUPADO = production en pending|in_progress.
 *
 * DECISIÓN EXPLÍCITA: `blocked` NO ocupa slot. Una tarea bloqueada sigue
 * siendo visible como incidencia (y se cuenta aparte en las métricas), pero
 * no puede congelar para siempre la generación automática del comercial: si
 * lo hiciera, un bloqueo sin resolver dejaría al comercial sin tareas de
 * forma indefinida. Por eso los índices/constraints y los helpers filtran
 * SÓLO por pending|in_progress.
 */
export const V5_SLOT_OCCUPYING_STATUSES = ["pending", "in_progress"] as const;
export type V5SlotStatus = (typeof V5_SLOT_OCCUPYING_STATUSES)[number];

/** Estados desde los que se admite reapertura explícita (incluye blocked). */
export const V5_REOPENABLE_STATUSES = [
  "completed",
  "skipped",
  "no_procede",
  "blocked",
  "cancelled",
] as const;

export function isV5TaskStatus(status: unknown): status is V5TaskStatus {
  return typeof status === "string" && (V5_TASK_STATUSES as readonly string[]).includes(status);
}

export function isOpenStatus(status: unknown): boolean {
  return isV5TaskStatus(status) && (V5_OPEN_STATUSES as readonly string[]).includes(status);
}

export function isTerminalStatus(status: unknown): boolean {
  return isV5TaskStatus(status) && (V5_TERMINAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Un valor desconocido NUNCA se considera slot ocupado ni iniciable: se
 * rechaza explícitamente aguas arriba (assertV5TaskStatus).
 */
export function occupiesAutomaticSlot(task: {
  generationMode?: string | null;
  status?: string | null;
}): boolean {
  return (
    task.generationMode === "production" &&
    isV5TaskStatus(task.status) &&
    (V5_SLOT_OCCUPYING_STATUSES as readonly string[]).includes(task.status)
  );
}

export function countOccupiedSlots(
  tasks: readonly { generationMode?: string | null; status?: string | null }[],
): number {
  return tasks.filter(occupiesAutomaticSlot).length;
}

/** Fail-closed: cualquier valor fuera del vocabulario aborta. */
export function assertV5TaskStatus(status: unknown): V5TaskStatus {
  if (!isV5TaskStatus(status)) {
    throw new Error(`Estado de tarea no canónico: ${JSON.stringify(status)}`);
  }
  return status;
}

/** Literal SQL compartido, para que migración y código no diverjan. */
export function sqlStatusList(statuses: readonly string[]): string {
  return statuses.map((s) => `'${s}'`).join(",");
}
