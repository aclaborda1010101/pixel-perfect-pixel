/**
 * MOTOR V5 — P0.2. ADAPTADOR RUNTIME (apagado por flag).
 *
 * Orquestación transaccional e idempotente POR COMERCIAL:
 *   lock → contexto/candidatos/modo/overrides/tareas V5 completas →
 *   computeEligibility → reconcile (revalidateOpenTasks) → verificar slot →
 *   selectNextProduction (0/1) → insertar UNA con task_key única → liberar.
 *
 * Nunca lote arbitrario, nunca cobertura forzada, nunca tareas de otro
 * comercial. `blocked` participa en dedupe pero NO ocupa slot. Las tareas
 * manuales humanas (generation_mode='manual') no se tocan jamás.
 */

import { revalidateOpenTasks, type V5ExistingTask, type V5TerminalRecord } from "./revalidate.ts";
import { selectNextByMode, type V5ModeConfig, type V5WindowEntry } from "./modes.ts";
import type { V5BuildingContext, V5Candidate } from "./model.ts";
import { occupiesAutomaticSlot } from "./status.ts";

/** Fila V5 tal y como vive en building_tasks (proyección mínima). */
export type V5TaskRow = V5ExistingTask & {
  id: string;
  userId: string | null;
  generationMode: "legacy" | "production" | "manual";
};

export type V5RuntimeContext = {
  comercialId: string;
  buildings: V5BuildingContext[];
  /** TODAS las tareas V5 del comercial: abiertas, blocked y terminales. */
  tasks: V5TaskRow[];
  modeConfig: V5ModeConfig;
  window: V5WindowEntry[];
  history?: V5TerminalRecord[];
};

export type V5RuntimeRepository = {
  acquireLock(comercialId: string): Promise<string | null>;
  releaseLock(comercialId: string, token: string): Promise<void>;
  /** Debe fallar cerrado (lanzar/devolver null) si el mapeo V2→V5 no es fiable. */
  loadContext(comercialId: string): Promise<V5RuntimeContext | null>;
  insertProductionTask(input: {
    comercialId: string;
    candidate: V5Candidate;
    modeSnapshot: Record<string, unknown>;
    lockToken: string;
  }): Promise<{ id: string } | null>;
};

export type V5RuntimeOutcome =
  | "inserted"
  | "slot_ocupado"
  | "sin_candidato"
  | "flag_off"
  | "lock_no_adquirido"
  | "contexto_no_fiable"
  | "insert_fallido";

export type V5RuntimeResult = {
  outcome: V5RuntimeOutcome;
  comercialId: string;
  inserted: { id: string; taskKey: string } | null;
  reasons: string[];
  window: V5WindowEntry[];
};

/** Tareas que compiten por el ÚNICO slot automático del comercial. */
export function occupiedSlotTasks(tasks: readonly V5TaskRow[]): V5TaskRow[] {
  return tasks.filter((t) => occupiesAutomaticSlot(t));
}

/**
 * Selección determinista de como mucho UNA tarea production nueva.
 * Devuelve `null` si el slot está ocupado o no hay candidato fresco.
 */
export function selectNextProduction(ctx: V5RuntimeContext, opts: { now?: Date } = {}): {
  candidate: V5Candidate | null;
  modeSnapshot: Record<string, unknown>;
  window: V5WindowEntry[];
  reasons: string[];
} {
  const now = opts.now ?? new Date();
  const reasons: string[] = [];

  if (occupiedSlotTasks(ctx.tasks).length > 0) {
    return { candidate: null, modeSnapshot: {}, window: ctx.window, reasons: ["slot_ocupado"] };
  }

  const fresh: V5Candidate[] = [];
  for (const building of ctx.buildings) {
    const buildingTasks = ctx.tasks.filter(
      (t) => t.buildingId === building.buildingId && t.generationMode === "production",
    );
    const reconciled = revalidateOpenTasks(building, buildingTasks, { now, history: ctx.history });
    reasons.push(
      `${building.buildingId}: ${reconciled.valid.length} válidas, ${reconciled.updated.length} actualizadas, ` +
        `${reconciled.superseded.length} sustituidas, ${reconciled.dedupeOnly.length} sólo-dedupe, ${reconciled.fresh.length} nuevas`,
    );
    fresh.push(...reconciled.fresh);
  }

  const sel = selectNextByMode({
    comercialId: ctx.comercialId,
    candidates: fresh.filter((c) => (c.comercialId ?? null) === ctx.comercialId),
    config: ctx.modeConfig,
    window: ctx.window,
    now,
  });
  reasons.push(...sel.reasons);
  return { candidate: sel.selected, modeSnapshot: sel.modeSnapshot, window: sel.window, reasons };
}

/**
 * Ciclo completo para UN comercial. Idempotente: dos ejecuciones
 * concurrentes no pueden crear dos tareas (lock + slot + task_key única).
 */
export async function runV5CycleForComercial(
  comercialId: string,
  repo: V5RuntimeRepository,
  opts: { enabled: boolean; now?: Date },
): Promise<V5RuntimeResult> {
  const base = { comercialId, inserted: null, reasons: [] as string[], window: [] as V5WindowEntry[] };
  if (!opts.enabled) {
    return { ...base, outcome: "flag_off", reasons: ["Flag V5 runtime OFF: no se genera nada."] };
  }

  const token = await repo.acquireLock(comercialId);
  if (!token) return { ...base, outcome: "lock_no_adquirido", reasons: ["Otro ciclo tiene el lock."] };

  try {
    let ctx: V5RuntimeContext | null = null;
    try {
      ctx = await repo.loadContext(comercialId);
    } catch (e) {
      return {
        ...base,
        outcome: "contexto_no_fiable",
        reasons: [`Adaptador V2→V5 no fiable: ${(e as Error)?.message ?? String(e)}`],
      };
    }
    if (!ctx) {
      return { ...base, outcome: "contexto_no_fiable", reasons: ["Sin contexto V5 fiable: fail-closed, no se inserta."] };
    }

    const sel = selectNextProduction(ctx, { now: opts.now });
    if (!sel.candidate) {
      const occupied = occupiedSlotTasks(ctx.tasks).length > 0;
      return {
        ...base,
        outcome: occupied ? "slot_ocupado" : "sin_candidato",
        reasons: sel.reasons,
        window: sel.window,
      };
    }

    const ins = await repo.insertProductionTask({
      comercialId,
      candidate: sel.candidate,
      modeSnapshot: sel.modeSnapshot,
      lockToken: token,
    });
    if (!ins) {
      return { ...base, outcome: "insert_fallido", reasons: [...sel.reasons, "insert rechazado (clave única/slot)"] , window: sel.window };
    }
    return {
      comercialId,
      outcome: "inserted",
      inserted: { id: ins.id, taskKey: sel.candidate.taskKey },
      reasons: sel.reasons,
      window: sel.window,
    };
  } finally {
    await repo.releaseLock(comercialId, token);
  }
}

/** Estados de cierre que disparan reposición de EXACTAMENTE una tarea. */
export const V5_REPLENISH_TRIGGER_STATUSES = [
  "completed",
  "skipped",
  "no_procede",
  "blocked",
  "cancelled",
] as const;

export function shouldReplenishAfter(status: string): boolean {
  return (V5_REPLENISH_TRIGGER_STATUSES as readonly string[]).includes(status);
}

/**
 * Reposición idempotente tras cerrar/bloquear una tarea: reutiliza el mismo
 * ciclo (lock + slot + clave única), de modo que un retry no duplica.
 */
export async function requestReplenishment(
  comercialId: string,
  closedStatus: string,
  repo: V5RuntimeRepository,
  opts: { enabled: boolean; now?: Date },
): Promise<V5RuntimeResult | null> {
  if (!shouldReplenishAfter(closedStatus)) return null;
  return await runV5CycleForComercial(comercialId, repo, opts);
}

/**
 * DEMO: misma selección, en memoria, máximo 20 iteraciones virtuales.
 * CERO repositorio y CERO tabla.
 */
export function runV5DemoCycle(ctx: V5RuntimeContext, opts: { now?: Date; max?: number } = {}): {
  proposals: { taskKey: string; taskCode: string; buildingId: string; subjectId: string }[];
  reasons: string[];
} {
  const max = Math.min(opts.max ?? 20, 20);
  const proposals: { taskKey: string; taskCode: string; buildingId: string; subjectId: string }[] = [];
  const reasons: string[] = [];
  let window = [...ctx.window];
  const virtualTasks: V5TaskRow[] = ctx.tasks.filter((t) => !occupiesAutomaticSlot(t));

  for (let i = 0; i < max; i++) {
    const sel = selectNextProduction({ ...ctx, tasks: virtualTasks, window }, { now: opts.now });
    if (!sel.candidate) {
      reasons.push(...sel.reasons);
      break;
    }
    proposals.push({
      taskKey: sel.candidate.taskKey,
      taskCode: sel.candidate.taskCode,
      buildingId: sel.candidate.buildingId,
      subjectId: sel.candidate.subjectId,
    });
    window = sel.window;
    // Iteración virtual: la propuesta se marca como terminal en memoria.
    virtualTasks.push({
      id: `demo-${i}`,
      userId: ctx.comercialId,
      generationMode: "production",
      status: "completed",
      taskKey: sel.candidate.taskKey,
      taskCode: sel.candidate.taskCode,
      subjectType: sel.candidate.subjectType,
      subjectId: sel.candidate.subjectId,
      buildingId: sel.candidate.buildingId,
      triggerFingerprint: sel.candidate.triggerFingerprint,
    });
  }
  return { proposals, reasons };
}
