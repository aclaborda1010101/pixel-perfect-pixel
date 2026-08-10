import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SALES_TASK_GROUPS,
  SALES_TASK_MODES,
  allocateByWeights,
  chooseNextGroup,
  emptyWeights,
  validateWeights,
  type WeightMap,
} from "@/lib/salesTaskModes";
import {
  coberturaDuracionNota,
  coberturaInicioNota,
  completionRate,
  fmtHoras,
  madridDayStart,
  mezclaEntries,
  periodRange,
  snapshotNota,
  MAX_PERIOD_DAYS,
  type SalesManagerRow,
} from "@/lib/salesManagerMetrics";
import { canStartTask, decideTaskStart, reopenPatch } from "@/lib/taskStart";
import { FEATURE_SALES_TASK_MODE_ALLOCATOR, FEATURE_FORCE_PASSWORD_EDGE_FN } from "@/lib/featureFlags";
import { decideAccess, GESTOR_PATH, PASSWORD_PATH, postPasswordChangePath } from "@/lib/access";
import {
  canExecute,
  canSelectBuildingTaskDirectly,
  canSelectProfile,
  canSelectUserRole,
  currentUserRole,
  finalizeSalesManagerSetupSim,
  getSalesManagerDashboardSim,
  reopenBuildingTaskSim,
  startBuildingTaskSim,
  type AppRole,
  type Claims,
  type TaskRow,
} from "@/lib/salesManagerPolicy";
import { clearMustChangePassword } from "../../supabase/functions/force_password_change/profile";

const SQL = readFileSync(
  "supabase/pending_migrations/20260811000000_sales_manager_phase_b.sql",
  "utf8",
);

// ---------------------------------------------------------------- roles
describe("current_user_role", () => {
  const c = (roles: AppRole[], uid: string | null = "u1"): Claims => ({ uid, roles });

  it("devuelve viewer como fallback y nunca NULL", () => {
    expect(currentUserRole(c([]))).toBe("viewer");
    expect(currentUserRole(c([], null))).toBe("viewer");
  });

  it("prioriza admin > sales_manager > operativos", () => {
    expect(currentUserRole(c(["comercial_zona", "sales_manager", "admin"]))).toBe("admin");
    expect(currentUserRole(c(["comercial_zona", "sales_manager"]))).toBe("sales_manager");
    expect(currentUserRole(c(["viewer", "comercial_zona"]))).toBe("comercial_zona");
  });

  it("la migración conserva el tipo de retorno app_role y no usa SQL dinámico", () => {
    expect(SQL).toMatch(/current_user_role\(\)\s*\nRETURNS public\.app_role/);
    expect(SQL).toContain("'viewer'::public.app_role");
    expect(SQL).not.toMatch(/EXECUTE\s+format\(/i);
  });
});

// ------------------------------------------------------------------ RLS
describe("RLS efectiva con identidades", () => {
  const team = [
    { manager_id: "mgr", member_id: "dav", active: true },
    { manager_id: "mgr", member_id: "old", active: false },
  ];
  const mgr: Claims = { uid: "mgr", roles: ["sales_manager"] };
  const dav: Claims = { uid: "dav", roles: ["comercial_zona"] };
  const admin: Claims = { uid: "adm", roles: ["admin"] };

  it("el gestor ve su perfil y el de sus miembros ACTIVOS, no otros", () => {
    expect(canSelectProfile(mgr, "mgr", team)).toBe(true);
    expect(canSelectProfile(mgr, "dav", team)).toBe(true);
    expect(canSelectProfile(mgr, "old", team)).toBe(false);
    expect(canSelectProfile(mgr, "ajeno", team)).toBe(false);
  });

  it("un comercial sólo se ve a sí mismo; el admin lo ve todo", () => {
    expect(canSelectUserRole(dav, "dav", team)).toBe(true);
    expect(canSelectUserRole(dav, "mgr", team)).toBe(false);
    expect(canSelectUserRole(admin, "quien-sea", team)).toBe(true);
  });

  it("nadie lee building_tasks ajenas directamente desde el panel", () => {
    expect(canSelectBuildingTaskDirectly()).toBe(false);
    expect(SQL).not.toMatch(/CREATE POLICY[^;]*ON public\.building_tasks/i);
  });

  it("las políticas históricas USING(true) se eliminan explícitamente", () => {
    expect(SQL).toContain("DROP POLICY IF EXISTS profiles_select_authenticated");
    expect(SQL).toContain("DROP POLICY IF EXISTS user_roles_select_authenticated");
  });

  it("los helpers internos son inaccesibles y sólo las RPC públicas se conceden", () => {
    expect(canExecute("_sm_is_manager_of", "authenticated")).toBe(false);
    expect(canExecute("_sm_is_manager_of", "anon")).toBe(false);
    expect(canExecute("get_sales_manager_dashboard", "authenticated")).toBe(true);
    expect(canExecute("get_sales_manager_dashboard", "anon")).toBe(false);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\._sm_[a-z_]+\([^)]*\) FROM PUBLIC, anon, authenticated/);
  });
});

// ------------------------------------------------------------- alta/equipo
describe("alta de gestor y equipo", () => {
  const base = () => ({
    authUsers: [
      { id: "carlos", email: "carlos@afflux.es" },
      { id: "dav", email: "david.casero@afflux.es" },
      { id: "raro", email: "raro@afflux.es" },
    ],
    roles: [
      { user_id: "carlos", role: "viewer" as AppRole },
      { user_id: "carlos", role: "agent" as AppRole },
      { user_id: "dav", role: "comercial_zona" as AppRole },
      { user_id: "raro", role: "viewer" as AppRole },
    ],
    team: [] as { manager_id: string; member_id: string; active: boolean }[],
  });
  const admin: Claims = { uid: "adm", roles: ["admin"] };

  it("deja EXACTAMENTE el rol sales_manager y borra los anteriores", () => {
    const db = base();
    const r = finalizeSalesManagerSetupSim(
      admin,
      { user_id: "carlos", expected_email: "carlos@afflux.es", full_name: "Carlos", members: ["dav"] },
      db,
    );
    expect(r).toMatchObject({ ok: true, roles_borrados: 2, rol: "sales_manager", miembros: 1 });
    expect(db.roles.filter((x) => x.user_id === "carlos")).toEqual([
      { user_id: "carlos", role: "sales_manager" },
    ]);
  });

  it("no crea usuarios ni acepta email o miembros inválidos", () => {
    const db = base();
    expect(
      finalizeSalesManagerSetupSim(
        admin,
        { user_id: "nuevo", expected_email: "x@afflux.es", full_name: "X", members: [] },
        db,
      ),
    ).toMatchObject({ ok: false });
    expect(
      finalizeSalesManagerSetupSim(
        admin,
        { user_id: "carlos", expected_email: "otro@afflux.es", full_name: "C", members: [] },
        db,
      ),
    ).toMatchObject({ ok: false });
    expect(
      finalizeSalesManagerSetupSim(
        admin,
        { user_id: "carlos", expected_email: "carlos@afflux.es", full_name: "C", members: ["raro"] },
        db,
      ),
    ).toMatchObject({ ok: false, error: expect.stringContaining("comercial_zona") });
  });

  it("las FK del equipo son ON DELETE CASCADE y prohíben manager = member", () => {
    expect(SQL).toMatch(/manager_id[^,]*REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/member_id[^,]*REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
    expect(SQL).toMatch(/CHECK \(manager_id <> member_id\)/);
  });
});

// -------------------------------------------------------------- dashboard
describe("dashboard: ventanas separadas", () => {
  const from = new Date("2026-03-02T00:00:00Z");
  const to = new Date("2026-03-09T00:00:00Z");
  const now = new Date("2026-03-09T10:00:00Z");
  const t = (o: Partial<TaskRow>): TaskRow => ({
    id: Math.random().toString(36).slice(2),
    user_id: "dav",
    status: "pending",
    started_at: null,
    completed_at: null,
    created_at: "2026-03-03T09:00:00Z",
    ...o,
  });

  it("incluye miembros SIN actividad con ceros", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "vacio", full_name: "Sin actividad" }],
      [],
      from, to, now,
    );
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ created_in_period: 0, completed_in_period: 0 });
  });

  it("creada ANTES y cerrada DENTRO cuenta sólo como cerrada", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "dav", full_name: "David" }],
      [t({ created_at: "2026-02-01T09:00:00Z", completed_at: "2026-03-04T09:00:00Z", status: "completed" })],
      from, to, now,
    );
    expect(d.rows[0].created_in_period).toBe(0);
    expect(d.rows[0].completed_in_period).toBe(1);
  });

  it("creada DENTRO y cerrada FUERA cuenta sólo como creada", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "dav", full_name: "David" }],
      [t({ created_at: "2026-03-03T09:00:00Z", completed_at: "2026-03-20T09:00:00Z", status: "completed" })],
      from, to, now,
    );
    expect(d.rows[0].created_in_period).toBe(1);
    expect(d.rows[0].completed_in_period).toBe(0);
  });

  it("T2 y T3 se suman en un único grupo antes del JSON", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "dav", full_name: "David" }],
      [
        t({ task_key: "v5:2026-03-03:T-02:abc" }),
        t({ task_key: "v5:2026-03-03:T-03:def" }),
        t({ task_key: "v5:2026-03-03:T-01:ghi" }),
        t({ task_key: "manual" }),
      ],
      from, to, now,
    );
    expect(d.rows[0].mezcla_creadas).toEqual({ T2_T3: 2, T1: 1, unknown: 1 });
  });

  it("estados desconocidos van a unknown y el snapshot es foto actual", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "dav", full_name: "David" }],
      [t({ status: "zombi", created_at: "2020-01-01T00:00:00Z" })],
      from, to, now,
    );
    expect(d.rows[0].snapshot.unknown).toBe(1);
    expect(d.rows[0].snapshot.as_of).toBe(now.toISOString());
  });

  it("la duración sólo cuenta cierres con inicio real", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "dav", full_name: "David" }],
      [
        t({ status: "completed", started_at: "2026-03-03T09:00:00Z", completed_at: "2026-03-03T11:00:00Z" }),
        t({ status: "completed", completed_at: "2026-03-04T11:00:00Z" }),
      ],
      from, to, now,
    );
    expect(d.rows[0].completed_in_period).toBe(2);
    expect(d.rows[0].con_duracion).toBe(1);
    expect(d.rows[0].media_horas).toBe(2);
    expect(d.rows[0].cobertura_duracion_pct).toBe(50);
  });

  it("rechaza intervalos de más de 31 días", () => {
    expect(() =>
      getSalesManagerDashboardSim([], [], new Date("2026-01-01T00:00:00Z"), new Date("2026-03-01T00:00:00Z")),
    ).toThrow(/31/);
    expect(SQL).toContain("intervalo máximo 31 días");
  });

  it("la RPC no finge histórico con now() ni expone datos sensibles", () => {
    expect(SQL).not.toMatch(/completed_at\s*=\s*now\(\)/i);
    expect(SQL).not.toMatch(/'email'\s*,/);
  });
});

describe("intervalos temporales (Madrid + DST)", () => {
  it("periodRange devuelve [from, to) y 7 días exactos", () => {
    const { from, to } = periodRange("semana", new Date("2026-03-10T15:00:00.000Z"));
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(7);
  });

  it("hoy es un único día natural de Madrid", () => {
    const now = new Date("2026-08-10T22:30:00.000Z"); // ya es día 11 en Madrid
    const { from, to } = periodRange("hoy", now);
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(1);
    expect(from.getTime()).toBe(madridDayStart(now).getTime());
  });

  it("el día del cambio de hora sigue empezando a medianoche local", () => {
    // 29-03-2026: Madrid pasa de CET a CEST a las 02:00 locales.
    const dst = madridDayStart(new Date("2026-03-29T12:00:00Z"));
    expect(dst.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    const invierno = madridDayStart(new Date("2026-01-15T12:00:00Z"));
    expect(invierno.toISOString()).toBe("2026-01-14T23:00:00.000Z");
  });

  it("el cliente no puede pedir más de 31 días", () => {
    expect(MAX_PERIOD_DAYS).toBe(31);
  });
});

// ------------------------------------------------------------------ modos
describe("modos de reparto", () => {
  const full = (extra: WeightMap): WeightMap => ({ ...emptyWeights(), ...extra });

  it("el catálogo es el V5 canónico, T7 deshabilitada y sin etiquetas inventadas", () => {
    expect(SALES_TASK_GROUPS.find((x) => x.code === "T2_T3")!.members).toEqual(["T-02", "T-03"]);
    expect(SALES_TASK_GROUPS.find((x) => x.code === "T7")!.enabled).toBe(false);
    expect(SALES_TASK_GROUPS.every((g) => g.label.includes("pendiente validar"))).toBe(true);
  });

  it("equilibrado no define porcentajes propios", () => {
    const eq = SALES_TASK_MODES.find((m) => m.code === "equilibrado")!;
    expect(eq.followsEngineDefault).toBe(true);
    expect(eq.requiresWeights).toBe(false);
  });

  it("exige TODOS los grupos: faltantes, extras y T7 != 0 fallan", () => {
    expect(validateWeights({ T1: 100 }).valid).toBe(false); // faltan grupos
    expect(validateWeights(full({ T1: 100, NOPE: 0 } as any)).errors.join()).toContain("desconocido");
    expect(validateWeights(full({ T1: 90, T7: 10 })).valid).toBe(false);
    expect(validateWeights(full({ T1: 100 })).valid).toBe(true);
  });

  it("rechaza decimales, strings, NaN, negativos y sumas != 100", () => {
    expect(validateWeights(full({ T1: 99.5, T2_T3: 0.5 })).valid).toBe(false);
    expect(validateWeights(full({ T1: "100" } as any)).valid).toBe(false);
    expect(validateWeights(full({ T1: Number.NaN })).valid).toBe(false);
    expect(validateWeights(full({ T1: -10, T2_T3: 110 })).valid).toBe(false);
    expect(validateWeights(full({ T1: 50, T2_T3: 40 })).valid).toBe(false);
    expect(validateWeights(null).valid).toBe(false);
  });

  it("chooseNextGroup elige UNA cesta y respeta la proporción a la larga", () => {
    const w = full({ T1: 50, T2_T3: 30, T8: 20 });
    const counts: Record<string, number> = {};
    for (let i = 0; i < 100; i++) {
      const g = chooseNextGroup(w, counts)!;
      expect(typeof g).toBe("string");
      counts[g] = (counts[g] ?? 0) + 1;
    }
    expect(counts.T1).toBe(50);
    expect(counts.T2_T3).toBe(30);
    expect(counts.T8).toBe(20);
  });

  it("no elige cestas sin candidatos elegibles", () => {
    const w = full({ T1: 100 });
    expect(chooseNextGroup(w, {}, { T1: 0 })).toBeNull();
  });

  it("allocateByWeights es determinista y no inventa candidatos", () => {
    const w = full({ T1: 50, T2_T3: 50 });
    expect(allocateByWeights(10, w)).toEqual(allocateByWeights(10, w));
    const b = allocateByWeights(10, w, { T1: 2 });
    expect(b.T1).toBe(2);
  });

  it("el motor productivo sigue detrás de flags apagadas", () => {
    expect(FEATURE_SALES_TASK_MODE_ALLOCATOR).toBe(false);
    expect(FEATURE_FORCE_PASSWORD_EDGE_FN).toBe(false);
    expect(SQL).toContain("revalida");
  });
});

// -------------------------------------------------------------- started_at
describe("inicio, reapertura y cierre", () => {
  const dav: Claims = { uid: "dav", roles: ["comercial_zona"] };
  const now = new Date("2026-03-05T10:00:00Z");
  const mk = (o: Partial<TaskRow>): TaskRow => ({
    id: "t1", user_id: "dav", status: "pending", started_at: null,
    completed_at: null, created_at: "2026-03-01T00:00:00Z", ...o,
  });

  it("sólo arranca una tarea pendiente", () => {
    const t = mk({});
    expect(startBuildingTaskSim(dav, t, now)).toMatchObject({ ok: true, written: true });
    expect(t.status).toBe("in_progress");
    expect(t.started_at).toBe(now.toISOString());
  });

  it("volver a arrancar una tarea ya iniciada es éxito idempotente y no reescribe", () => {
    const t = mk({ status: "in_progress", started_at: "2026-03-04T08:00:00Z" });
    const r = startBuildingTaskSim(dav, t, now);
    expect(r).toMatchObject({ ok: true, written: false });
    expect(t.started_at).toBe("2026-03-04T08:00:00Z");
  });

  it("rechaza estados no iniciables y tareas ajenas", () => {
    for (const s of ["completed", "skipped", "no_procede", "blocked"]) {
      expect(startBuildingTaskSim(dav, mk({ status: s }), now)).toMatchObject({ ok: false });
    }
    expect(startBuildingTaskSim(dav, mk({ user_id: "otro" }), now)).toMatchObject({
      ok: false, error: expect.stringContaining("no te pertenece"),
    });
  });

  it("la reapertura limpia started_at para no arrastrar duraciones falsas", () => {
    const t = mk({ status: "completed", started_at: "2026-03-01T09:00:00Z", completed_at: "2026-03-02T09:00:00Z" });
    reopenBuildingTaskSim(dav, t);
    expect(t).toMatchObject({ status: "pending", started_at: null, completed_at: null });
    expect(reopenPatch()).toEqual({ status: "pending", started_at: null, completed_at: null });
  });

  it("completar sin inicio está permitido pero no computa duración", () => {
    const d = getSalesManagerDashboardSim(
      [{ user_id: "dav", full_name: "D" }],
      [mk({ status: "completed", completed_at: "2026-03-05T09:00:00Z" })],
      new Date("2026-03-02T00:00:00Z"), new Date("2026-03-09T00:00:00Z"), now,
    );
    expect(d.rows[0].completed_in_period).toBe(1);
    expect(d.rows[0].media_horas).toBeNull();
  });

  it("la UI ofrece Empezar en la lista principal y en la cola comercial", () => {
    expect(canStartTask({ status: "pending", started_at: null })).toBe(true);
    expect(decideTaskStart({ status: "in_progress", started_at: "x" }).action).toBe("noop_ok");
    expect(decideTaskStart({ status: "completed" }).action).toBe("reject");
    for (const f of [
      "src/pages/comercial/Tareas.tsx",
      "src/pages/comercial/Dashboard.tsx",
      "src/components/comercial/BuildingTasksSection.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src).toContain("startBuildingTask");
      expect(src).toContain("Empezar");
    }
  });
});

// -------------------------------------------------------------- contraseña
describe("cambio de contraseña obligatorio", () => {
  const client = (results: { data: unknown[] | null; error: { code?: string } | null }[]) => {
    let i = 0;
    return {
      from: () => ({
        update: () => ({
          eq: () => ({ select: async () => results[Math.min(i++, results.length - 1)] }),
        }),
      }),
    } as any;
  };
  const noSleep = async () => {};

  it("una sola fila actualizada = éxito", async () => {
    const r = await clearMustChangePassword(client([{ data: [{ id: "u" }], error: null }]), "u", { sleep: noSleep });
    expect(r).toEqual({ ok: true, stage: "done" });
  });

  it("cero filas (perfil inexistente) = estado parcial, sin reintentar", async () => {
    const r = await clearMustChangePassword(client([{ data: [], error: null }]), "u", { sleep: noSleep });
    expect(r).toMatchObject({ ok: false, stage: "partial", reason: "sin_fila" });
  });

  it("varias filas = estado parcial", async () => {
    const r = await clearMustChangePassword(
      client([{ data: [{ id: "a" }, { id: "b" }], error: null }]), "u", { sleep: noSleep },
    );
    expect(r).toMatchObject({ ok: false, reason: "multiples_filas" });
  });

  it("un error transitorio se reintenta y no expone el detalle interno", async () => {
    const r = await clearMustChangePassword(
      client([{ data: null, error: { code: "57014" } }, { data: [{ id: "u" }], error: null }]),
      "u",
      { sleep: noSleep },
    );
    expect(r).toEqual({ ok: true, stage: "done" });
  });

  it("con la flag apagada la UI falla CERRADA antes de tocar la contraseña", () => {
    const src = readFileSync("src/pages/auth/CambiarPasswordObligatorio.tsx", "utf8");
    expect(src).toContain("if (!FEATURE_FORCE_PASSWORD_EDGE_FN)");
    expect(src).toContain("no está activado");
    // No queda ninguna vía directa desde el navegador.
    expect(src).not.toContain("auth.updateUser");
  });

  it("la edge function no devuelve el mensaje interno de Auth", () => {
    const src = readFileSync("supabase/functions/force_password_change/index.ts", "utf8");
    expect(src).not.toContain("pwErr.message");
    expect(src).toContain("clearMustChangePassword");
  });
});

// ------------------------------------------------------------------ acceso
describe("acceso del gestor", () => {
  it("sales_manager sólo entra en su panel", () => {
    expect(decideAccess({ role: "sales_manager", pathname: GESTOR_PATH })).toEqual({ type: "allow" });
    expect(decideAccess({ role: "sales_manager", pathname: "/admin" })).toEqual({
      type: "redirect", to: GESTOR_PATH,
    });
  });

  it("el cambio de contraseña obligatorio manda sobre todo lo demás", () => {
    expect(decideAccess({ role: "sales_manager", pathname: GESTOR_PATH, mustChangePassword: true })).toEqual({
      type: "redirect", to: PASSWORD_PATH,
    });
    expect(postPasswordChangePath("sales_manager")).toBe(GESTOR_PATH);
  });

  it("un comercial no accede al panel del gestor", () => {
    expect(decideAccess({ role: "comercial_zona", pathname: GESTOR_PATH })).toEqual({
      type: "redirect", to: "/",
    });
  });
});

// ------------------------------------------------------- métricas y textos
describe("métricas del panel", () => {
  const row: SalesManagerRow = {
    user_id: "u1", full_name: "David",
    created_in_period: 10, completed_in_period: 8,
    con_plazo: 4, en_plazo: 3, con_duracion: 4,
    media_horas: 2.5, mediana_horas: 2,
    cobertura_inicio_creadas: 5, cobertura_inicio_pct: 50, cobertura_duracion_pct: 50,
    snapshot: {
      pending: 2, in_progress: 1, blocked: 1, skipped: 0, completed: 8, unknown: 0,
      vencidas_ahora: 1, as_of: "2026-03-09T10:00:00.000Z",
    },
    mezcla_creadas: { T1: 4, T2_T3: 6 },
  };

  it("calcula cumplimiento sobre los cierres del periodo", () => {
    expect(completionRate(row)).toBe(75);
    expect(completionRate({ ...row, con_plazo: 0 })).toBeNull();
  });

  it("diferencia cobertura de inicio y de duración completa", () => {
    expect(coberturaInicioNota(row)).toContain("5 de 10");
    expect(coberturaDuracionNota(row)).toContain("4 de 8");
    expect(snapshotNota(row)).toContain("No corresponde al periodo");
  });

  it("formatea duraciones y ordena la mezcla", () => {
    expect(fmtHoras(null)).toBe("—");
    expect(fmtHoras(0.5)).toBe("30 min");
    expect(mezclaEntries(row)[0]).toEqual(["T2_T3", 6]);
  });
});
