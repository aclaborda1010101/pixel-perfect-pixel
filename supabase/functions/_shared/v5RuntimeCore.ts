/**
 * MOTOR V5 — P0.3. NÚCLEO SERVER-SIDE del runtime (sin UI, sin escrituras
 * directas). Todo lo que aquí se decide es PURO: la única puerta de
 * escritura es la RPC transaccional `commit_v5_generation_plan`, que
 * revalida flag/pausa/canario/slot/fingerprint antes de insertar 0 o 1
 * tarea production canónica.
 *
 * Este módulo es el ESPEJO SERVIDOR de src/lib/v5 (selección por déficit,
 * ventana móvil de 20, T6 exclusiva). La paridad se prueba en la suite.
 */

export const V5_RULES_VERSION_SERVER = "v5.0.0";
export const V5_SERVER_BUCKETS = ["T1", "T2_T3", "T4", "T5", "T6", "T8", "T9"] as const;
export type V5ServerBucket = (typeof V5_SERVER_BUCKETS)[number];
export const V5_WINDOW_SIZE_SERVER = 20;

// ---------------------------------------------------------------------
// 1. AUTORIZACIÓN DE LA INVOCACIÓN
// ---------------------------------------------------------------------

export type V5InvocationInput = {
  /** Llamada interna: cabecera de service role verificada por el handler. */
  isServiceRole: boolean;
  /** Roles reales del usuario autenticado (de la BD, nunca del cuerpo). */
  roles: readonly string[];
  /** Identidad autenticada, si la hay. */
  userId: string | null;
  body: Record<string, unknown> | null;
};

export type V5InvocationDecision = {
  allowed: boolean;
  status: number;
  reason: string;
  /** Comerciales a procesar; vacío = todos los pendientes en la cola. */
  userIds: string[];
  mode: "internal" | "admin" | "denied";
};

const ADMIN_ROLES = ["admin", "manager", "sales_manager"];

/**
 * Un `authenticated` cualquiera NO puede pasar user_ids, ni `replace`, ni
 * borrar. Sólo service role (invocación interna) o admin/gestor.
 */
export function decideV5Invocation(input: V5InvocationInput): V5InvocationDecision {
  const body = input.body ?? {};
  const rawIds = Array.isArray(body.user_ids) ? body.user_ids : [];
  const userIds = rawIds.filter((v): v is string => typeof v === "string" && v.trim() !== "");
  const dangerous =
    body.replace === true || body.delete === true || body.force === true || body.purge === true;

  if (input.isServiceRole) {
    return {
      allowed: !dangerous,
      status: dangerous ? 400 : 200,
      reason: dangerous
        ? "Operaciones destructivas (replace/delete/force/purge) no existen en el runtime V5."
        : "Invocación interna (service role).",
      userIds,
      mode: dangerous ? "denied" : "internal",
    };
  }

  if (!input.userId) {
    return { allowed: false, status: 401, reason: "Sin sesión válida.", userIds: [], mode: "denied" };
  }
  const isAdmin = input.roles.some((r) => ADMIN_ROLES.includes(r));
  if (!isAdmin) {
    return {
      allowed: false,
      status: 403,
      reason: "El runtime V5 sólo lo invocan el sistema o un admin/gestor autorizado.",
      userIds: [],
      mode: "denied",
    };
  }
  if (dangerous) {
    return {
      allowed: false,
      status: 400,
      reason: "Operaciones destructivas no existen en el runtime V5.",
      userIds: [],
      mode: "denied",
    };
  }
  return { allowed: true, status: 200, reason: "Admin/gestor autorizado.", userIds, mode: "admin" };
}

// ---------------------------------------------------------------------
// 2. ADAPTADOR REAL DB → CONTEXTO V5 (FAIL CLOSED)
// ---------------------------------------------------------------------

export type V5AssignmentRow = {
  building_id: string;
  user_id: string | null;
  status: string | null;
};

export type V5BuildingRow = {
  id: string;
  /** Titularidad verificada disponible (null = desconocido, NO asumible). */
  ownership_universe_complete: boolean | null;
  titulares: unknown[] | null;
  nota_simple_estado: string | null;
  identidad_verificada: boolean | null;
  evidencia_disponible: boolean | null;
};

export type V5ServerIncident = {
  id: string;
  field: string;
  observed: string | null;
  expected: string | null;
  source: string;
  action: string;
  blocking: boolean;
};

export type V5ServerBuildingContext = {
  buildingId: string;
  comercialId: string;
  ownershipUniverseComplete: boolean;
  incidents: V5ServerIncident[];
  /** Candidatos personales YA calculados aguas arriba (owner-level). */
  personal: V5ServerCandidate[];
};

export type V5ServerCandidate = {
  taskCode: V5ServerBucket;
  subjectType: "owner" | "building";
  subjectId: string;
  buildingId: string;
  comercialId: string;
  blocking?: boolean;
  urgent?: boolean;
  triggerFingerprint: string;
  taskKey: string;
  title: string;
  reason: string;
  eligibilitySnapshot: Record<string, unknown>;
};

/** Hash determinista (FNV-1a 64 en hex) sobre JSON canónico. */
export function fingerprint(value: unknown): string {
  const json = canonicalJson(value);
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < json.length; i++) {
    h ^= BigInt(json.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

export function buildTaskKey(c: {
  taskCode: string;
  buildingId: string;
  subjectId: string;
  triggerFingerprint: string;
}): string {
  return `v5:${V5_RULES_VERSION_SERVER}:${c.taskCode}:${c.buildingId}:${c.subjectId}:${c.triggerFingerprint}`;
}

/**
 * Adaptador REAL: SÓLO asignaciones activas con `user_id` EXACTO. Nunca hay
 * fallback por nombre de comercial. Si falta la evidencia requerida
 * (titularidad, nota, identidad) no se inventa nada: o se emite una T6
 * trazable, o el edificio devuelve cero candidatos.
 */
export function mapDbToV5Context(input: {
  comercialId: string;
  assignments: readonly V5AssignmentRow[];
  buildings: readonly V5BuildingRow[];
  personal?: readonly V5ServerCandidate[];
}): { buildings: V5ServerBuildingContext[]; notes: string[] } {
  const notes: string[] = [];
  const active = new Set(
    input.assignments
      .filter((a) => a.status === "active" && a.user_id === input.comercialId)
      .map((a) => a.building_id),
  );
  for (const a of input.assignments) {
    if (a.user_id !== input.comercialId) {
      notes.push(`Asignación de otro comercial descartada: ${a.building_id}`);
    } else if (a.status !== "active") {
      notes.push(`Asignación no activa descartada: ${a.building_id} (${String(a.status)})`);
    }
  }

  const out: V5ServerBuildingContext[] = [];
  for (const b of input.buildings) {
    if (!active.has(b.id)) {
      notes.push(`Edificio ${b.id} sin asignación activa del comercial: fuera del universo.`);
      continue;
    }
    const incidents: V5ServerIncident[] = [];
    const missing = (field: string, expected: string) =>
      incidents.push({
        id: `falta_${field}`,
        field,
        observed: "no disponible",
        expected,
        source: `db:buildings:${b.id}`,
        action: `Obtener ${field} verificado antes de contactar.`,
        blocking: true,
      });

    if (b.ownership_universe_complete !== true) missing("titularidad", "universo de titularidad completo");
    if (!Array.isArray(b.titulares) || b.titulares.length === 0) missing("titulares", "al menos un titular con evidencia");
    if (b.nota_simple_estado !== "lista") missing("nota_simple", "nota simple lista");
    if (b.identidad_verificada !== true) missing("identidad", "identidad del titular verificada");
    if (b.evidencia_disponible !== true) missing("evidencia", "evidencia registral citable");

    const personal = (input.personal ?? []).filter(
      (c) => c.buildingId === b.id && c.comercialId === input.comercialId,
    );
    out.push({
      buildingId: b.id,
      comercialId: input.comercialId,
      ownershipUniverseComplete: b.ownership_universe_complete === true,
      incidents,
      personal,
    });
  }
  return { buildings: out, notes };
}

/**
 * T6 se calcula PRIMERO y es EXCLUSIVA del edificio: si hay cualquier
 * incidencia bloqueante válida, exactamente UNA T6 agrupada y NINGUNA
 * personal.
 */
export function candidatesForBuilding(ctx: V5ServerBuildingContext): {
  candidates: V5ServerCandidate[];
  suppressed: string[];
} {
  if (ctx.incidents.length === 0) return { candidates: [...ctx.personal], suppressed: [] };
  const trigger = {
    incidencias: ctx.incidents
      .map((i) => ({ id: i.id, campo: i.field, fuente: i.source, bloqueante: i.blocking }))
      .sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
  const fp = fingerprint(trigger);
  const t6: V5ServerCandidate = {
    taskCode: "T6",
    subjectType: "building",
    subjectId: ctx.buildingId,
    buildingId: ctx.buildingId,
    comercialId: ctx.comercialId,
    blocking: ctx.incidents.some((i) => i.blocking),
    triggerFingerprint: fp,
    taskKey: buildTaskKey({
      taskCode: "T6",
      buildingId: ctx.buildingId,
      subjectId: ctx.buildingId,
      triggerFingerprint: fp,
    }),
    title: "Verificar datos del edificio antes de contactar",
    reason: `Incidencias por resolver: ${ctx.incidents.length}`,
    eligibilitySnapshot: {
      incidencias: trigger.incidencias,
      suprimidas: ctx.personal.map((p) => ({ subject_id: p.subjectId, task_code: p.taskCode })),
    },
  };
  return { candidates: [t6], suppressed: ctx.personal.map((p) => p.taskKey) };
}

// ---------------------------------------------------------------------
// 3. SELECCIÓN (espejo de selectNextByMode)
// ---------------------------------------------------------------------

export type V5ServerWindowEntry = { taskKey: string; bucket: string };
export type V5ServerMix = Record<string, number>;

export function validateServerMix(mix: V5ServerMix | null | undefined): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!mix || typeof mix !== "object") return { valid: false, errors: ["Modo sin pesos guardados: no activable."] };
  let total = 0;
  for (const [code, raw] of Object.entries(mix)) {
    if (code === "T7") {
      if (Number(raw) !== 0) errors.push("T7 sólo admite 0.");
      continue;
    }
    if (!(V5_SERVER_BUCKETS as readonly string[]).includes(code)) {
      errors.push(`Bucket desconocido: ${code}`);
      continue;
    }
    const v = Number(raw);
    if (!Number.isInteger(v) || v < 0 || v > 100) errors.push(`Peso inválido en ${code}`);
    else total += v;
  }
  for (const b of V5_SERVER_BUCKETS) if (!(b in mix)) errors.push(`Falta el bucket ${b}`);
  if (total !== 100) errors.push(`La suma debe ser 100 (actual: ${total}).`);
  return { valid: errors.length === 0, errors };
}

/** Selecciona 0 o 1 candidato: urgencia primero, luego déficit por modo. */
export function selectServerNext(input: {
  comercialId: string;
  candidates: readonly V5ServerCandidate[];
  mix: V5ServerMix | null;
  window?: readonly V5ServerWindowEntry[];
}): { selected: V5ServerCandidate | null; reasons: string[]; window: V5ServerWindowEntry[] } {
  const windowIn = (input.window ?? []).slice(0, V5_WINDOW_SIZE_SERVER);
  const mixCheck = validateServerMix(input.mix);
  if (!mixCheck.valid) return { selected: null, reasons: mixCheck.errors, window: [...windowIn] };
  const mix = { ...(input.mix as V5ServerMix) };
  delete mix.T7;

  const inWindow = new Set(windowIn.map((e) => e.taskKey));
  const seen = new Set<string>();
  const reasons: string[] = [];
  const pool = [...input.candidates]
    .filter((c) => {
      if (c.comercialId !== input.comercialId) {
        reasons.push(`Candidato de otro comercial descartado: ${c.taskKey}`);
        return false;
      }
      if (!(V5_SERVER_BUCKETS as readonly string[]).includes(c.taskCode)) return false;
      if (inWindow.has(c.taskKey) || seen.has(c.taskKey)) return false;
      seen.add(c.taskKey);
      return true;
    })
    .sort((a, b) => (a.taskKey < b.taskKey ? -1 : a.taskKey > b.taskKey ? 1 : 0));

  const urgent = pool.find((c) => (c.taskCode === "T8" && c.urgent) || (c.taskCode === "T6" && c.blocking));
  let chosen: V5ServerCandidate | null = urgent ?? null;
  if (!chosen) {
    const counts: Record<string, number> = {};
    for (const b of V5_SERVER_BUCKETS) counts[b] = 0;
    for (const e of windowIn) if (e.bucket in counts) counts[e.bucket] += 1;
    const total = windowIn.length + 1;
    let best = -Infinity;
    for (const b of V5_SERVER_BUCKETS) {
      const weight = mix[b] ?? 0;
      if (weight <= 0) continue;
      const available = pool.filter((c) => c.taskCode === b);
      if (available.length === 0) continue;
      const deficit = (weight / 100) * total - counts[b];
      if (deficit > best + 1e-9) {
        best = deficit;
        chosen = available[0];
      }
    }
  }
  if (!chosen) reasons.push("Sin candidato elegible para el reparto del modo.");
  const window = chosen
    ? [{ taskKey: chosen.taskKey, bucket: chosen.taskCode }, ...windowIn].slice(0, V5_WINDOW_SIZE_SERVER)
    : [...windowIn];
  return { selected: chosen, reasons, window };
}

// ---------------------------------------------------------------------
// 4. CICLO: lease → contexto → motor → RPC commit (0/1)
// ---------------------------------------------------------------------

export type V5RuntimeConfig = {
  enabled: boolean;
  paused: boolean;
  config_review_required: boolean;
  canary_user_ids: string[] | null;
};

export type V5ServerRepo = {
  readConfig(): Promise<V5RuntimeConfig>;
  claimRequests(limit: number, userIds: string[]): Promise<{ id: string; comercial_id: string; lease_token: string }[]>;
  loadContext(comercialId: string): Promise<{
    buildings: V5ServerBuildingContext[];
    mix: V5ServerMix | null;
    window: V5ServerWindowEntry[];
    slotOccupied: boolean;
    tombstones: string[];
  } | null>;
  /** RPC transaccional: revalida TODO y devuelve la fila insertada o null. */
  commitPlan(input: {
    comercialId: string;
    requestId: string;
    leaseToken: string;
    candidate: V5ServerCandidate;
    modeSnapshot: Record<string, unknown>;
    startsAt: string;
    dueDate: string;
  }): Promise<{ id: string } | null>;
  releaseRequest(requestId: string, leaseToken: string, outcome: string, detail: string): Promise<void>;
};

export type V5CycleOutcome =
  | "inserted"
  | "flag_off"
  | "paused"
  | "config_review"
  | "not_in_canary"
  | "slot_ocupado"
  | "sin_candidato"
  | "contexto_no_fiable"
  | "commit_rechazado";

export type V5CycleResult = {
  comercialId: string;
  outcome: V5CycleOutcome;
  inserted: { id: string; taskKey: string } | null;
  reasons: string[];
};

export function isCanaryEnabled(config: V5RuntimeConfig, comercialId: string): boolean {
  if (!config.canary_user_ids || config.canary_user_ids.length === 0) return true;
  return config.canary_user_ids.includes(comercialId);
}

/** Ventana temporal REAL de la tarea production: nunca vencida. */
export function productionWindow(now: Date): { startsAt: string; dueDate: string } {
  return {
    startsAt: now.toISOString(),
    dueDate: new Date(now.getTime() + 3 * 86400000).toISOString(),
  };
}

export async function runServerCycle(
  comercialId: string,
  request: { id: string; leaseToken: string },
  repo: V5ServerRepo,
  opts: { config: V5RuntimeConfig; now?: Date },
): Promise<V5CycleResult> {
  const now = opts.now ?? new Date();
  const base = { comercialId, inserted: null, reasons: [] as string[] };
  const cfg = opts.config;

  const stop = (outcome: V5CycleOutcome, reason: string): V5CycleResult => ({
    ...base,
    outcome,
    reasons: [reason],
  });

  if (!cfg.enabled) return stop("flag_off", "Flag del runtime V5 OFF: cero escrituras.");
  if (cfg.paused) return stop("paused", "Generación pausada desde el panel: cero escrituras.");
  if (cfg.config_review_required) return stop("config_review", "Configuración pendiente de revisión.");
  if (!isCanaryEnabled(cfg, comercialId)) return stop("not_in_canary", "Comercial fuera del canario.");

  let ctx: Awaited<ReturnType<V5ServerRepo["loadContext"]>> = null;
  try {
    ctx = await repo.loadContext(comercialId);
  } catch (e) {
    return stop("contexto_no_fiable", `Adaptador DB→V5 no fiable: ${(e as Error)?.message ?? String(e)}`);
  }
  if (!ctx) return stop("contexto_no_fiable", "Sin contexto fiable: fail-closed, no se inserta.");
  if (ctx.slotOccupied) return stop("slot_ocupado", "El comercial ya tiene su tarea automática abierta.");

  const reasons: string[] = [];
  const candidates: V5ServerCandidate[] = [];
  for (const b of ctx.buildings) {
    const r = candidatesForBuilding(b);
    if (r.suppressed.length > 0) {
      reasons.push(`${b.buildingId}: T6 exclusiva, ${r.suppressed.length} personales suprimidas.`);
    }
    candidates.push(...r.candidates);
  }
  const tomb = new Set(ctx.tombstones);
  const fresh = candidates.filter((c) => !tomb.has(c.taskKey));

  const sel = selectServerNext({ comercialId, candidates: fresh, mix: ctx.mix, window: ctx.window });
  reasons.push(...sel.reasons);
  if (!sel.selected) return { ...base, outcome: "sin_candidato", reasons };

  const win = productionWindow(now);
  const ins = await repo.commitPlan({
    comercialId,
    requestId: request.id,
    leaseToken: request.leaseToken,
    candidate: sel.selected,
    modeSnapshot: { mix: ctx.mix, ventana: sel.window.length, motivo: reasons.slice(0, 5) },
    startsAt: win.startsAt,
    dueDate: win.dueDate,
  });
  if (!ins) {
    return { ...base, outcome: "commit_rechazado", reasons: [...reasons, "La RPC transaccional rechazó el plan."] };
  }
  return {
    comercialId,
    outcome: "inserted",
    inserted: { id: ins.id, taskKey: sel.selected.taskKey },
    reasons,
  };
}
