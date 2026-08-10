import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { operationalTaskBadge, v5TaskCodeFromKey } from "@/lib/operationalTasks";
import { fetchVisibleUserTasks } from "@/lib/dashboardTasks";
import { handleTecnofindCore } from "../../supabase/functions/enrichment-agent/tecnofind";
import { tecnofindIncidenciaTrasVerificacion } from "../../supabase/functions/enrichment-apply-verification/tasks";

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) PRODUCTORES EDGE: cero inserts en building_tasks
// ---------------------------------------------------------------------------
describe("contención legacy · productores enrichment", () => {
  it("enrichment-agent (tecnofind) no escribe tareas y termina el job igual", async () => {
    const from = vi.fn(() => {
      throw new Error("ningún productor de enrichment puede tocar la base de tareas");
    });
    const supabase = { from };
    const timeline: any[] = [];
    const finished: any[] = [];

    const res = await handleTecnofindCore(
      { id: "job-1", building_id: "b1", titular_nombre: "ANA", datos: { telefono: null } },
      {
        pushTimeline: (_j, e) => { timeline.push(e); },
        finishJob: async (_j, patch) => { finished.push(patch); (supabase as any); return null; },
      },
    );

    expect(from).not.toHaveBeenCalled();
    expect(res.task_created).toBe(false);
    expect(res.incidencia?.incidencia).toBe("telefono_pendiente_tecnofind");
    // El enriquecimiento continúa: el job se cierra y avanza de fase.
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ estado: "ok", fase: "verificacion" });
    // Nunca vuelve a afirmar "tarea creada".
    expect(JSON.stringify(timeline)).not.toContain("tarea creada");
    expect(JSON.stringify(res)).not.toContain("tarea creada");
  });

  it("tecnofind con teléfono presente no genera incidencia ni tarea", async () => {
    const res = await handleTecnofindCore(
      { id: "job-2", building_id: "b1", datos: { telefono: "600000000" } },
      { pushTimeline: () => {}, finishJob: async () => null },
    );
    expect(res.incidencia).toBeNull();
    expect(res.task_created).toBe(false);
  });

  it("enrichment-apply-verification devuelve incidencia sin cliente de base ni tarea", () => {
    const inc = tecnofindIncidenciaTrasVerificacion({
      buildingId: "b1", telefono: null, ownerId: "o1", jobId: "j1",
    });
    expect(inc).toMatchObject({ task_created: false, legacy_task_engine_retired: true });
    expect(JSON.stringify(inc)).not.toContain("tarea creada");
    // La función no acepta cliente de base: no puede escribir.
    expect(tecnofindIncidenciaTrasVerificacion.length).toBe(1);
    expect(tecnofindIncidenciaTrasVerificacion({ buildingId: "b1", telefono: "600" })).toBeNull();
  });

  it("el pipeline de enriquecimiento sigue siendo alcanzable y no escribe tareas", () => {
    const src = readFileSync(
      resolve(ROOT, "supabase/functions/enrichment-pipeline-start/index.ts"), "utf8",
    );
    expect(src.length).toBeGreaterThan(0);
    // Sigue invocando el enriquecimiento…
    expect(src).toContain("enrichment-agent");
    // …y jamás produce building_tasks por esa ruta.
    expect(src).not.toContain("building_tasks");
  });

  it("ninguna función enrichment menciona building_tasks", () => {
    for (const f of [
      "supabase/functions/enrichment-agent/index.ts",
      "supabase/functions/enrichment-agent/tecnofind.ts",
      "supabase/functions/enrichment-apply-verification/index.ts",
      "supabase/functions/enrichment-apply-verification/tasks.ts",
    ]) {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      expect(src.length).toBeGreaterThan(0);
      expect(src, f).not.toContain("building_tasks");
      expect(src, f).not.toContain("tarea creada");
    }
  });
});

// ---------------------------------------------------------------------------
// 2) GUARDA DE ARQUITECTURA: inventario de escritores de building_tasks
// ---------------------------------------------------------------------------
const WRITE_RX =
  /(from\s*\(\s*["'`]building_tasks["'`][^)]*\)[\s\S]{0,200}?\.(insert|upsert|update|delete)\s*\(|(insert|update|delete)\s+(into\s+)?(public\.)?building_tasks)/gi;

/** Allowlist EXPLÍCITA: motor V5 productivo/simulación aprobada + creación manual. */
const ALLOWED_WRITERS = new Set<string>([
  "supabase/functions/assign_daily_call_queue/index.ts", // V5 productivo / simulación aprobada
  "src/components/comercial/BuildingTasksSection.tsx",   // creación manual + cierre/borrado por el usuario
  "src/pages/comercial/Tareas.tsx",                      // cierre/reapertura manual por el usuario
]);

describe("guarda de arquitectura · escritores de building_tasks", () => {
  const files = [
    ...walk(resolve(ROOT, "src")),
    ...walk(resolve(ROOT, "supabase/functions")),
  ].filter((f) => !/[\\/]test[\\/]|\.test\.tsx?$/.test(f));

  it("inventaría los escritores y falla si alguno está fuera de la allowlist", () => {
    const writers: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      WRITE_RX.lastIndex = 0;
      if (WRITE_RX.test(src)) writers.push(relative(ROOT, f).replace(/\\/g, "/"));
    }
    expect(files.length).toBeGreaterThan(50);
    const noAutorizados = writers.filter((w) => !ALLOWED_WRITERS.has(w));
    expect(noAutorizados, `escritores de building_tasks no autorizados: ${noAutorizados.join(", ")}`)
      .toEqual([]);
  });

  it("los escritores permitidos siguen existiendo (V5 y creación manual)", () => {
    const v5 = readFileSync(resolve(ROOT, "supabase/functions/assign_daily_call_queue/index.ts"), "utf8");
    expect(v5).toMatch(/from\('building_tasks'\)\.insert|from\("building_tasks"\)\.insert/);
    expect(v5).toContain("v5:");
    const manual = readFileSync(resolve(ROOT, "src/components/comercial/BuildingTasksSection.tsx"), "utf8");
    expect(manual).toContain('task_type: "manual"');
  });

  it("el motor legacy sigue siendo no-op", async () => {
    const mod = await import("@/lib/buildingTasks");
    expect(mod.LEGACY_TASK_ENGINE_RETIRED).toBe(true);
    await expect(mod.syncBuildingTasks("b1", "u1")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3) UI: badge de origen y dashboard sin edificios
// ---------------------------------------------------------------------------
describe("badge de origen de tarea", () => {
  it("una task_key v5 con task_type=call_queue se etiqueta V5, nunca Manual", () => {
    const badge = operationalTaskBadge({ task_type: "call_queue", task_key: "v5:2026-08-10:T4:abc" });
    expect(badge.label).toBe("V5 · T4");
    expect(badge.label).not.toContain("Manual");
    expect(operationalTaskBadge({ task_type: "call_queue", task_key: "v5:v5a.1:T2_T3:b:o:f" }).label)
      .toBe("V5 · T2_T3");
    expect(operationalTaskBadge({ task_type: "call_queue", task_key: "v5:sin-codigo" }).label).toBe("V5");
  });

  it("solo task_type=manual se etiqueta Manual", () => {
    expect(operationalTaskBadge({ task_type: "manual", task_key: null }).label).toBe("Manual");
    expect(operationalTaskBadge({ task_type: "auto", task_key: "call_queue:2026-01-01:x" }).label)
      .toBe("Legacy");
  });

  it("v5TaskCodeFromKey ignora claves no V5", () => {
    expect(v5TaskCodeFromKey("call_queue:T4:x")).toBeNull();
    expect(v5TaskCodeFromKey(null)).toBeNull();
  });
});

describe("dashboard comercial · tareas visibles sin edificios", () => {
  function fakeClient(rows: any[]) {
    const calls: string[] = [];
    const q: any = {
      select: () => q, eq: () => q, in: () => q, or: () => q,
      order: () => Promise.resolve({ data: rows, error: null }),
    };
    return { calls, from: (t: string) => { calls.push(t); return q; } };
  }

  it("devuelve tareas V5 y manuales aunque el comercial tenga cero edificios", async () => {
    const client = fakeClient([
      { id: "1", task_type: "call_queue", task_key: "v5:2026-08-10:T4:o1" },
      { id: "2", task_type: "manual", task_key: null },
      { id: "3", task_type: "auto", task_key: "call_queue:2026-01-01:o9" },
    ]);
    const tasks = await fetchVisibleUserTasks(client as any, "u1");
    expect(client.calls).toEqual(["building_tasks"]);
    expect(tasks.map((t: any) => t.id)).toEqual(["1", "2"]);
  });

  it("el dashboard carga las tareas ANTES del early return por cero edificios", () => {
    const src = readFileSync(resolve(ROOT, "src/pages/comercial/Dashboard.tsx"), "utf8");
    const idxTasks = src.indexOf("fetchVisibleUserTasks");
    const idxEarly = src.indexOf("buildingIds.length === 0");
    expect(idxTasks).toBeGreaterThan(0);
    expect(idxEarly).toBeGreaterThan(idxTasks);
    // El early return devuelve las tareas y mantiene el enriquecimiento de edificio.
    const early = src.slice(idxEarly, idxEarly + 500);
    expect(early).toContain("tasks");
  });
});