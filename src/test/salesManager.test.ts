import { describe, it, expect } from "vitest";
import {
  SALES_TASK_GROUPS,
  SALES_TASK_MODES,
  allocateByWeights,
  emptyWeights,
  validateWeights,
} from "@/lib/salesTaskModes";
import {
  coberturaNota,
  completionRate,
  fmtHoras,
  madridDayStart,
  mezclaEntries,
  periodRange,
  type SalesManagerRow,
} from "@/lib/salesManagerMetrics";
import { canStartTask } from "@/lib/taskStart";
import { FEATURE_SALES_TASK_MODE_ALLOCATOR, FEATURE_FORCE_PASSWORD_EDGE_FN } from "@/lib/featureFlags";
import { decideAccess, GESTOR_PATH, PASSWORD_PATH, postPasswordChangePath } from "@/lib/access";

describe("modos de reparto", () => {
  it("T-02 y T-03 comparten un único grupo y T-07 está deshabilitada", () => {
    const g = SALES_TASK_GROUPS.find((x) => x.code === "T2_T3")!;
    expect(g.members).toEqual(["T-02", "T-03"]);
    expect(SALES_TASK_GROUPS.find((x) => x.code === "T7")!.enabled).toBe(false);
  });

  it("hay 3 plantillas + manual y equilibrado no define porcentajes", () => {
    expect(SALES_TASK_MODES.map((m) => m.code).sort()).toEqual(
      ["equilibrado", "iniciar_conversaciones", "manual", "seguimiento"].sort(),
    );
    const eq = SALES_TASK_MODES.find((m) => m.code === "equilibrado")!;
    expect(eq.followsEngineDefault).toBe(true);
    expect(eq.requiresWeights).toBe(false);
  });

  it("rechaza pesos negativos, grupos desconocidos y sumas != 100", () => {
    expect(validateWeights({ T1: -1 } as any).valid).toBe(false);
    expect(validateWeights({ NOPE: 100 } as any).errors.join()).toContain("Grupo desconocido");
    expect(validateWeights({ T1: 50, T2_T3: 40 }).valid).toBe(false);
    expect(validateWeights({ T1: 50, T2_T3: 50 })).toMatchObject({ valid: true, total: 100 });
  });

  it("obliga a peso 0 en el grupo deshabilitado", () => {
    expect(validateWeights({ T1: 90, T7: 10 }).valid).toBe(false);
    expect(validateWeights({ T1: 100, T7: 0 }).valid).toBe(true);
  });

  it("emptyWeights suma 0 y contiene todos los grupos", () => {
    const w = emptyWeights();
    expect(Object.keys(w).length).toBe(SALES_TASK_GROUPS.length);
    expect(Object.values(w).reduce((a, b) => a + (b ?? 0), 0)).toBe(0);
  });
});

describe("reparto determinista por déficit", () => {
  const weights = { T1: 50, T2_T3: 30, T8: 20 } as const;

  it("es determinista: mismas entradas, mismas salidas", () => {
    const a = allocateByWeights(10, weights);
    const b = allocateByWeights(10, weights);
    expect(a).toEqual(b);
    expect(a.T1 + a.T2_T3 + a.T8).toBe(10);
  });

  it("respeta la proporción y la disponibilidad real", () => {
    const a = allocateByWeights(10, weights);
    expect(a.T1).toBe(5);
    const b = allocateByWeights(10, weights, { T1: 2 });
    expect(b.T1).toBe(2);
    expect(b.T1 + b.T2_T3 + b.T8).toBe(10);
  });

  it("no reparte nada sin pesos o con total 0", () => {
    expect(allocateByWeights(0, weights).T1).toBe(0);
    expect(Object.values(allocateByWeights(5, {})).every((v) => v === 0)).toBe(true);
  });

  it("el adaptador está detrás de una feature flag desactivada", () => {
    expect(FEATURE_SALES_TASK_MODE_ALLOCATOR).toBe(false);
    expect(FEATURE_FORCE_PASSWORD_EDGE_FN).toBe(false);
  });
});

describe("intervalos temporales", () => {
  it("periodRange devuelve [from, to) y 7 días exactos", () => {
    const now = new Date("2026-03-10T15:00:00.000Z");
    const { from, to } = periodRange("semana", now);
    expect(to.getTime()).toBeGreaterThan(from.getTime());
    const dias = Math.round((to.getTime() - from.getTime()) / 86_400_000);
    expect(dias).toBe(7);
  });

  it("hoy es un único día natural de Madrid", () => {
    const now = new Date("2026-08-10T22:30:00.000Z"); // ya es día 11 en Madrid
    const { from, to } = periodRange("hoy", now);
    expect(Math.round((to.getTime() - from.getTime()) / 86_400_000)).toBe(1);
    expect(from.getTime()).toBe(madridDayStart(now).getTime());
  });
});

describe("métricas del panel", () => {
  const row: SalesManagerRow = {
    user_id: "u1",
    full_name: "David",
    creadas: 10,
    completadas: 6,
    pending: 2,
    in_progress: 1,
    blocked: 1,
    skipped: 0,
    unknown: 0,
    vencidas: 1,
    con_plazo: 4,
    en_plazo: 3,
    con_inicio: 5,
    cobertura_inicio_pct: 50,
    media_horas: 2.5,
    mediana_horas: 2,
    muestra_duracion: 4,
    mezcla: { T1: 4, T2_T3: 6 },
  };

  it("calcula cumplimiento en plazo", () => {
    expect(completionRate(row)).toBe(75);
    expect(completionRate({ ...row, con_plazo: 0 })).toBeNull();
  });

  it("informa de la cobertura de inicio real", () => {
    expect(coberturaNota(row)).toContain("4 de 10");
    expect(coberturaNota(row)).toContain("50%");
    expect(coberturaNota(row)).toContain("histórico");
  });

  it("formatea duraciones y mezcla sin regex de estados", () => {
    expect(fmtHoras(null)).toBe("—");
    expect(fmtHoras(0.5)).toBe("30 min");
    expect(mezclaEntries(row)[0]).toEqual(["T2_T3", 6]);
  });
});

describe("arranque de tarea", () => {
  it("sólo se puede empezar una tarea pendiente sin inicio previo", () => {
    expect(canStartTask({ status: "pending", started_at: null })).toBe(true);
    expect(canStartTask({ status: "pending", started_at: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(canStartTask({ status: "in_progress", started_at: null })).toBe(false);
    expect(canStartTask(null)).toBe(false);
  });
});

describe("acceso del gestor", () => {
  it("sales_manager sólo entra en su panel", () => {
    expect(decideAccess({ role: "sales_manager", pathname: GESTOR_PATH })).toEqual({ type: "allow" });
    expect(decideAccess({ role: "sales_manager", pathname: "/admin" })).toEqual({
      type: "redirect",
      to: GESTOR_PATH,
    });
  });

  it("el cambio de contraseña obligatorio manda sobre todo lo demás", () => {
    expect(
      decideAccess({ role: "sales_manager", pathname: GESTOR_PATH, mustChangePassword: true }),
    ).toEqual({ type: "redirect", to: PASSWORD_PATH });
    expect(postPasswordChangePath("sales_manager")).toBe(GESTOR_PATH);
  });

  it("un comercial no accede al panel del gestor", () => {
    expect(decideAccess({ role: "comercial_zona", pathname: GESTOR_PATH })).toEqual({
      type: "redirect",
      to: "/",
    });
  });
});
