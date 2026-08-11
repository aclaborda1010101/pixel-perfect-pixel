import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative } from "node:path";
import { operationalTaskBadge, v5TaskCodeFromKey } from "@/lib/operationalTasks";
import { fetchVisibleUserTasks } from "@/lib/dashboardTasks";
import { handleTecnofindCore } from "../../supabase/functions/enrichment-agent/tecnofind";
import { tecnofindIncidenciaTrasVerificacion } from "../../supabase/functions/enrichment-apply-verification/tasks";
import { insertManualBuildingTask } from "@/lib/taskWriters";
import { insertV5CallQueueTask, insertV5CanonicalTask } from "../../supabase/functions/_shared/taskWriters";
import { buildV5TaskKey } from "@/lib/v5/model";
import {
  scanBuildingTaskWrites,
  classifyBuildingTaskWrites,
  AUTHORIZED_WRITERS,
} from "./helpers/taskWriteGuard";

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

function walkSql(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkSql(p, out);
    else if (/\.sql$/i.test(entry)) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1) PRODUCTORES EDGE: cero inserts en building_tasks
// ---------------------------------------------------------------------------
describe("contención legacy · productores enrichment", () => {
  it("enrichment-agent (tecnofind) usa el repo inyectado y jamás toca building_tasks", async () => {
    // Repo REAL inyectado: el core escribe timeline y cierre a través de él.
    const ops: Array<{ table: string; op: string; payload: any }> = [];
    const fakeDb = {
      from(table: string) {
        const chain: any = {
          insert: (payload: any) => { ops.push({ table, op: "insert", payload }); return chain; },
          update: (payload: any) => { ops.push({ table, op: "update", payload }); return chain; },
          eq: () => chain,
          then: (res: any) => Promise.resolve({ data: null, error: null }).then(res),
        };
        return chain;
      },
    };
    const fromSpy = vi.spyOn(fakeDb, "from");

    const res = await handleTecnofindCore(
      { id: "job-1", building_id: "b1", titular_nombre: "ANA", datos: { telefono: null } },
      {
        pushTimeline: (job, e) => {
          fakeDb.from("enrichment_jobs").update({ id: job.id, timeline_entry: e });
        },
        finishJob: async (job, patch) => {
          await fakeDb.from("enrichment_jobs").update({ id: job.id, ...patch });
          return null;
        },
      },
    );

    // El enriquecimiento SÍ ocurre a través del repo inyectado…
    expect(fromSpy).toHaveBeenCalled();
    expect(ops.map((o) => o.table)).toEqual(["enrichment_jobs", "enrichment_jobs"]);
    // …y CERO escrituras sobre tareas.
    expect(ops.filter((o) => o.table === "building_tasks")).toEqual([]);
    expect(fromSpy.mock.calls.flat()).not.toContain("building_tasks");
    expect(res.task_created).toBe(false);
    expect(res.incidencia?.incidencia).toBe("telefono_pendiente_tecnofind");
    // El job se cierra y avanza de fase.
    expect(ops.at(-1)?.payload).toMatchObject({ estado: "ok", fase: "verificacion" });
    expect(JSON.stringify(ops)).not.toContain("tarea creada");
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
      expect(src, f).not.toMatch(/from\s*\(\s*["'`]building_tasks["'`]/);
      expect(src, f).not.toMatch(/(insert|update|delete)\s+into\s+building_tasks/i);
      expect(src, f).not.toContain("tarea creada");
    }
  });
});

// ---------------------------------------------------------------------------
// 2) GUARDA DE ARQUITECTURA: inventario REAL de escritores de building_tasks
// ---------------------------------------------------------------------------
describe("guarda de arquitectura · escritores de building_tasks", () => {
  const files = [
    ...walk(resolve(ROOT, "src")),
    ...walkSql(resolve(ROOT, "supabase/functions")),
    ...walkSql(resolve(ROOT, "supabase/migrations")),
    ...walkSql(resolve(ROOT, "supabase/pending_migrations")),
    ...walk(resolve(ROOT, "supabase/functions")),
  ].filter((f) => !/[\\/]test[\\/]|\.test\.tsx?$/.test(f));

  const rel = (f: string) => relative(ROOT, f).replace(/\\/g, "/");
  const sources: Record<string, string> = {};
  for (const f of files) sources[rel(f)] = readFileSync(f, "utf8");

  const ops = Object.entries(sources).flatMap(([f, src]) => scanBuildingTaskWrites(f, src));

  it("inventaría TODAS las operaciones y no hay ninguna sin clasificar", () => {
    expect(files.length).toBeGreaterThan(50);
    const { authorized, violations } = classifyBuildingTaskWrites(ops, sources);
    expect(violations.map((v) => `${v.file}:${v.line} ${v.reason}`)).toEqual([]);
    // Autorizadas EXCLUSIVAMENTE por función, no por archivo.
    expect(authorized.map((o) => `${o.file}#${o.fn}`).sort()).toEqual([
      "src/lib/taskWriters.ts#insertManualBuildingTask",
      "supabase/functions/_shared/taskWriters.ts#insertV5CallQueueTask",
      "supabase/functions/_shared/taskWriters.ts#insertV5CanonicalTask",
      "supabase/pending_migrations/20260815000000_v5_engine_p03_runtime_connect.sql#public.commit_v5_generation_plan",
    ]);
    expect(authorized.every((o) => AUTHORIZED_WRITERS[`${o.file}#${o.fn}`])).toBe(true);
  });

  it("los updates de ciclo de vida no cuentan como creación", () => {
    const ciclo =
      'await db.from("building_tasks").update({ status: "completed" }).eq("id", id);\n' +
      'await db.from("building_tasks").delete().eq("id", id);';
    expect(scanBuildingTaskWrites("src/pages/comercial/Tareas.tsx", ciclo)).toEqual([]);
    // Y además las pantallas reales ya no escriben: cierran vía RPC.
    expect(sources["src/pages/comercial/Tareas.tsx"]).toContain("resolveBuildingTask(");
    expect(sources["src/pages/comercial/Tareas.tsx"]).not.toContain(".update({");
  });

  it("los callsites autorizados pasan por su helper con payload válido", () => {
    const v5 = sources["supabase/functions/assign_daily_call_queue/index.ts"];
    expect(v5).toContain("insertV5CallQueueTask(sb, row)");
    expect(v5).toContain("task_type: 'call_queue'");
    expect(v5).toMatch(/const taskKey = `v5:\$\{hoy\}:\$\{c\.task_code\}:\$\{idKey\}`/);
    const manual = sources["src/components/comercial/BuildingTasksSection.tsx"];
    expect(manual).toContain("insertManualBuildingTask(supabase as any, {");
    expect(scanBuildingTaskWrites("x.tsx", manual)).toEqual([]);
  });

  it("PRUEBA NEGATIVA: insert colado en un archivo autorizado, pero fuera del helper", () => {
    for (const unit of Object.keys(AUTHORIZED_WRITERS)) {
      const file = unit.split("#")[0];
      const fixture = sources[file] +
        `\nexport async function colado(client: any) {\n` +
        `  await client.from("building_tasks").insert({ task_type: "auto" });\n}\n`;
      const fixtureOps = scanBuildingTaskWrites(file, fixture);
      const { violations } = classifyBuildingTaskWrites(fixtureOps, { ...sources, [file]: fixture });
      expect(violations.map((v) => v.reason).join(" "), file).toContain("#colado");
    }
  });

  it("PRUEBA NEGATIVA: bypasses estructurales que la regex antigua no veía", () => {
    const casos: Array<[string, string]> = [
      ["const tabla = \"building_tasks\";\nawait db.from(tabla).insert({ a: 1 });", "const literal"],
      ["const t = \"building_tasks\";\nconst alias = t;\nawait db.from(alias).upsert([{ a: 1 }]);", "alias"],
      ["const tasks = db.from(\"building_tasks\");\nawait tasks.insert({ a: 1 });", "variable anclada"],
      ["await db\n  .from(\"building_tasks\")\n  ?.insert({ a: 1 });", "multilínea + optional chaining"],
      ["await client.from(TABLA_DESCONOCIDA).insert({ a: 1 });", "fail-closed"],
    ];
    for (const [src, etiqueta] of casos) {
      const found = scanBuildingTaskWrites("supabase/functions/nuevo/index.ts", src);
      expect(found.length, etiqueta).toBe(1);
      const { violations } = classifyBuildingTaskWrites(found, {
        "supabase/functions/nuevo/index.ts": src,
      });
      expect(violations.length, etiqueta).toBe(1);
    }
  });

  it("PRUEBA NEGATIVA: mutación del payload después del assert invalida el contrato", () => {
    const file = "supabase/functions/_shared/taskWriters.ts";
    const mutado = sources[file].replace(
      "  assertV5CallQueueRow(row);\n  return await client",
      "  assertV5CallQueueRow(row);\n  (row as any).task_key = \"v5:2020-01-01:T-01:x\";\n  return await client",
    );
    expect(mutado).not.toBe(sources[file]);
    const { violations } = classifyBuildingTaskWrites(
      scanBuildingTaskWrites(file, mutado), { ...sources, [file]: mutado },
    );
    expect(violations.map((v) => v.reason).join(" ")).toContain("se muta después de validar");
  });

  it("PRUEBA NEGATIVA: assert presente en OTRA función no autoriza la escritura", () => {
    const file = "src/lib/taskWriters.ts";
    const trucado = sources[file].replace(
      "export async function insertManualBuildingTask(client: ClientLike, input: unknown) {\n  const row = buildManualTaskRow(input);",
      "export function validarAparte(input: unknown) { return buildManualTaskRow(input); }\n" +
      "export async function insertManualBuildingTask(client: ClientLike, input: unknown) {\n  const row = input as any;",
    );
    expect(trucado).not.toBe(sources[file]);
    const { violations } = classifyBuildingTaskWrites(
      scanBuildingTaskWrites(file, trucado), { ...sources, [file]: trucado },
    );
    expect(violations.map((v) => v.reason).join(" ")).toContain("no está dominada");
  });

  it("SQL: schema/case/identificadores citados, INSERT/UPSERT/MERGE y cuerpos de RPC", () => {
    const malicioso = [
      'INSERT INTO public."building_tasks" (id) SELECT id FROM buildings;',
      'insert into BUILDING_TASKS (id) values (1) on conflict (task_key) do nothing;',
      'MERGE INTO public.building_tasks t USING x ON t.id = x.id;',
      'CREATE OR REPLACE FUNCTION public.rpc_colado() RETURNS void AS $f$ BEGIN\n' +
      '  INSERT INTO public.building_tasks (id) VALUES (gen_random_uuid());\nEND $f$ LANGUAGE plpgsql;',
    ].join("\n");
    const found = scanBuildingTaskWrites("supabase/pending_migrations/9999_x.sql", malicioso);
    expect(found.map((o) => o.op)).toEqual(["insert", "upsert", "merge", "insert"]);
    expect(found.at(-1)?.fn).toBe("public.rpc_colado");
    const { violations, authorized } = classifyBuildingTaskWrites(found, {
      "supabase/pending_migrations/9999_x.sql": malicioso,
    });
    expect(authorized).toEqual([]);
    expect(violations).toHaveLength(4);
  });

  it("SQL: la RPC canónica de Fase C se autoriza por función y contrato, no por migración", () => {
    const buena =
      'CREATE OR REPLACE FUNCTION public.commit_v5_generation_plan(p jsonb) RETURNS uuid AS $f$\n' +
      'BEGIN\n  PERFORM public.v5_assert_canonical_task_key(p->>\'task_key\');\n' +
      "  INSERT INTO public.building_tasks (task_key, generation_mode) VALUES (p->>'task_key', 'production');\n" +
      "  RETURN NULL;\nEND $f$ LANGUAGE plpgsql;";
    const okOps = scanBuildingTaskWrites("supabase/pending_migrations/fase_c.sql", buena);
    const okCls = classifyBuildingTaskWrites(okOps, { "supabase/pending_migrations/fase_c.sql": buena });
    expect(okCls.violations).toEqual([]);
    expect(okCls.authorized).toHaveLength(1);

    // Misma migración, otra función: NO autorizada.
    const mixta = buena + "\nCREATE OR REPLACE FUNCTION public.otra() RETURNS void AS $g$ BEGIN\n" +
      "  INSERT INTO public.building_tasks (id) VALUES (gen_random_uuid());\nEND $g$ LANGUAGE plpgsql;";
    const mixtaCls = classifyBuildingTaskWrites(
      scanBuildingTaskWrites("supabase/pending_migrations/fase_c.sql", mixta),
      { "supabase/pending_migrations/fase_c.sql": mixta },
    );
    expect(mixtaCls.authorized).toHaveLength(1);
    expect(mixtaCls.violations.map((v) => v.reason).join(" ")).toContain("public.otra");

    // Contrato incompleto: la RPC autorizada sin validación canónica falla.
    const floja = buena.replace("PERFORM public.v5_assert_canonical_task_key(p->>'task_key');", "");
    const flojaCls = classifyBuildingTaskWrites(
      scanBuildingTaskWrites("supabase/pending_migrations/fase_c.sql", floja),
      { "supabase/pending_migrations/fase_c.sql": floja },
    );
    expect(flojaCls.authorized).toEqual([]);
    expect(flojaCls.violations.map((v) => v.reason).join(" ")).toContain("contrato");
  });

  it("el motor legacy sigue siendo no-op", async () => {
    const mod = await import("@/lib/buildingTasks");
    expect(mod.LEGACY_TASK_ENGINE_RETIRED).toBe(true);
    await expect(mod.syncBuildingTasks("b1", "u1")).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 2b) WRITERS: payload válido escribe, payload auto/legacy se rechaza
// ---------------------------------------------------------------------------
describe("writers autorizados · contrato de payload", () => {
  function fakeRepo() {
    const rows: any[] = [];
    const q: any = {
      insert: (row: any) => { rows.push(row); return { ...q, __row: row }; },
      select: () => q,
      maybeSingle: async () => ({ data: { id: "t1", task_key: rows.at(-1)?.task_key }, error: null }),
      then: undefined,
    };
    return { rows, from: (t: string) => { expect(t).toBe("building_tasks"); return q; } };
  }

  const v5Row = {
    building_id: "b1", user_id: "u1", task_type: "call_queue",
    task_key: "v5:2026-08-10:T-04:o1", title: "T-04 Cadencia — Goya 4",
    description: "x", priority: "medium", status: "pending",
    due_date: "2026-08-10T18:00:00.000Z",
  };

  it("writer histórico (flag OFF) solo acepta el formato de fecha legacy", async () => {
    const repo = fakeRepo();
    await insertV5CallQueueTask(repo as any, v5Row);
    expect(repo.rows).toHaveLength(1);
    // Una clave canónica NO entra por el writer histórico.
    await expect(insertV5CallQueueTask(repo as any, {
      ...v5Row,
      task_key: buildV5TaskKey({ taskCode: "T2_T3", buildingId: "b1", subjectId: "o1", triggerFingerprint: "fp" }),
    })).rejects.toThrow(/task_key inválida/);
    expect(repo.rows).toHaveLength(1);
  });

  it("writer V5 rechaza payload auto/legacy o incompleto", async () => {
    const repo = fakeRepo();
    await expect(insertV5CallQueueTask(repo as any, { ...v5Row, task_key: "call_queue:2026-01-01:o1" }))
      .rejects.toThrow(/task_key inválida/);
    await expect(insertV5CallQueueTask(repo as any, { ...v5Row, task_type: "auto" }))
      .rejects.toThrow(/call_queue/);
    const { due_date, ...sinDue } = v5Row as any;
    await expect(insertV5CallQueueTask(repo as any, sinDue)).rejects.toThrow(/due_date/);
    expect(repo.rows).toHaveLength(0);
  });

  it("writer canónico usa buildV5TaskKey real y exige todas las columnas Motor", async () => {
    const repo = fakeRepo();
    const taskKey = buildV5TaskKey({
      taskCode: "T2_T3", buildingId: "b1", subjectId: "o1", triggerFingerprint: "fp-1",
    });
    expect(taskKey.split(":")).toHaveLength(6);
    const canonical = {
      building_id: "b1", user_id: "u1", task_type: "call_queue", task_key: taskKey,
      title: "WhatsApp — Goya 4", description: "x", priority: "medium", status: "pending",
      starts_at: "2026-08-10T08:00:00.000Z", due_date: "2026-08-10T18:00:00.000Z",
      generation_mode: "production", rules_version: taskKey.split(":")[1],
      task_code: "T2_T3", subject_type: "owner", subject_id: "o1",
      trigger_fingerprint: "fp-1", eligibility_snapshot: {}, mode_snapshot: {},
    };
    await insertV5CanonicalTask(repo as any, canonical);
    expect(repo.rows).toHaveLength(1);

    // Falta una columna Motor -> rechazo.
    const { mode_snapshot, ...sinSnapshot } = canonical as any;
    await expect(insertV5CanonicalTask(repo as any, sinSnapshot)).rejects.toThrow(/snapshots/);
    // Discordancia clave/columna -> rechazo.
    await expect(insertV5CanonicalTask(repo as any, { ...canonical, task_code: "T4" }))
      .rejects.toThrow(/task_code no concuerda/);
    // Clave histórica disfrazada de canónica -> rechazo.
    await expect(insertV5CanonicalTask(repo as any, { ...canonical, task_key: "v5:2026-08-10:T-04:o1" }))
      .rejects.toThrow(/task_key inválida/);
    expect(repo.rows).toHaveLength(1);
  });

  it("writer manual escribe task_type manual sin task_key", async () => {
    const repo = fakeRepo();
    await insertManualBuildingTask(repo as any, {
      building_id: "b1", user_id: "u1", created_by: "u1",
      subject_type: "building", subject_id: "b1", manual_subtype: "otro",
      title: " Llamar ", priority: "high",
      starts_at: "2026-08-15T09:00:00.000Z", due_date: "2026-08-16T09:00:00.000Z",
    });
    expect(repo.rows[0]).toMatchObject({
      task_type: "manual", generation_mode: "manual", task_key: null,
      status: "pending", title: "Llamar", manual_subtype: "otro",
      due_date: "2026-08-16T09:00:00.000Z",
    });
  });

  it("writer manual rechaza payload automático", async () => {
    const repo = fakeRepo();
    await expect(insertManualBuildingTask(repo as any, {
      building_id: "b1", user_id: "u1", created_by: "u1", subject_type: "building",
      subject_id: "b1", manual_subtype: "otro", title: "x", priority: "high",
      starts_at: "2026-08-15T09:00:00.000Z", due_date: "2026-08-16T09:00:00.000Z",
      task_type: "call_queue",
    })).rejects.toThrow(/manual/);
    await expect(insertManualBuildingTask(repo as any, {
      building_id: "b1", user_id: "u1", created_by: "u1", subject_type: "building",
      subject_id: "b1", manual_subtype: "otro", title: "x", priority: "high",
      starts_at: "2026-08-15T09:00:00.000Z", due_date: "2026-08-16T09:00:00.000Z",
      task_key: "v5:v5a.1:T4:b1:o1:fp",
    })).rejects.toThrow(/task_key/);
    expect(repo.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 3) UI: badge de origen y dashboard sin edificios
// ---------------------------------------------------------------------------
describe("badge de origen de tarea", () => {
  it("una task_key v5 con task_type=call_queue se etiqueta V5, nunca Manual", () => {
    const badge = operationalTaskBadge({ task_type: "call_queue", task_key: "v5:2026-08-10:T-04:abc" });
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
      { id: "1", task_type: "call_queue", task_key: "v5:2026-08-10:T-04:o1" },
      { id: "2", task_type: "manual", task_key: null },
      { id: "3", task_type: "auto", task_key: "call_queue:2026-01-01:o9" },
    ]);
    const tasks = await fetchVisibleUserTasks(client as any, "u1");
    expect(client.calls).toEqual(["building_tasks"]);
    expect(tasks.map((t: any) => t.id)).toEqual(["1", "2"]);
  });

});