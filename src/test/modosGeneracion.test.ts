import { describe, it, expect } from "vitest";
import { MODOS, TIPOS_TAREA, validarMezcla, puedeCambiarModo } from "@/lib/modosGeneracion";
import { elegirTipo, MIX_POR_DEFECTO, type Tipo } from "@/lib/generadorTareas";

const mezclaDe = (code: string) => MODOS.find((m) => m.code === code)!.mezcla!;

describe("modos de generación", () => {
  it("los porcentajes acordados por el cliente son exactos", () => {
    expect(mezclaDe("apertura")).toMatchObject({ "T-02_03": 60, "T-01": 20, "T-04": 20 });
    expect(mezclaDe("equilibrado")).toMatchObject({ "T-02_03": 40, "T-01": 20, "T-04": 40 });
    expect(mezclaDe("seguimiento")).toMatchObject({ "T-02_03": 15, "T-01": 10, "T-04": 75 });
    for (const code of ["apertura", "equilibrado", "seguimiento"]) {
      expect(validarMezcla(mezclaDe(code)).valida).toBe(true);
    }
  });

  it("el reparto por defecto del generador es Equilibrado", () => {
    expect(MIX_POR_DEFECTO).toMatchObject(mezclaDe("equilibrado"));
  });

  it("rechaza una suma distinta de 100 con mensaje claro", () => {
    const mala = { ...mezclaDe("apertura"), "T-01": 30 };
    const v = validarMezcla(mala);
    expect(v.valida).toBe(false);
    expect(v.errores.join(" ")).toContain("sumar exactamente 100");
  });

  it("rechaza tipos desconocidos y valores no enteros", () => {
    expect(validarMezcla({ ...mezclaDe("apertura"), T1: 0 } as any).valida).toBe(false);
    expect(validarMezcla({ ...mezclaDe("apertura"), "T-01": 20.5 } as any).valida).toBe(false);
  });

  it("solo admin y sales_manager pueden cambiar el modo", () => {
    expect(puedeCambiarModo("admin")).toBe(true);
    expect(puedeCambiarModo("sales_manager")).toBe(true);
    expect(puedeCambiarModo("comercial_zona")).toBe(false);
    expect(puedeCambiarModo(null)).toBe(false);
  });

  function simular(mix: Record<string, number>, n: number) {
    const historico: string[] = [];
    for (let i = 0; i < n; i++) {
      historico.push(elegirTipo({ mix, historico, disponibles: TIPOS_TAREA as readonly Tipo[] }));
    }
    const cuenta: Record<string, number> = {};
    for (const h of historico) cuenta[h] = (cuenta[h] ?? 0) + 1;
    return cuenta;
  }

  it("la mezcla generada tiende a los porcentajes del modo activo", () => {
    const ap = simular(mezclaDe("apertura"), 100);
    expect(ap["T-02_03"]).toBeGreaterThanOrEqual(55);
    expect(ap["T-01"]).toBeGreaterThanOrEqual(15);
    expect(ap["T-04"]).toBeGreaterThanOrEqual(15);
    const sg = simular(mezclaDe("seguimiento"), 100);
    expect(sg["T-04"]).toBeGreaterThan(sg["T-02_03"]);
    expect(sg["T-04"]).toBeGreaterThanOrEqual(70);
  });
});
