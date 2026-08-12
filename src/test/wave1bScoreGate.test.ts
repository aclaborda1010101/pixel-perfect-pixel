import { describe, it, expect } from "vitest";
import { getDisplayScore, ownershipGate, isScoreFiable } from "@/components/comercial/scoring";

describe("Wave 1B · gate de titularidad en el score efectivo", () => {
  it("sin señal de gate es fail-closed: pendiente de titularidad", () => {
    const g = ownershipGate({});
    expect(g.titularidad_segura).toBe(false);
    expect(g.etiqueta).toBe("pendiente de titularidad");
  });

  it("con derechos operativos el gate abre", () => {
    expect(ownershipGate({ derechos_operativos: 2 }).titularidad_segura).toBe(true);
    expect(ownershipGate({ titularidad_segura: true }).etiqueta).toBe("operativa");
  });

  it("sin titularidad segura NO se usa el score de propietarios", () => {
    const b = { score_total: 90, score_activo: 40, score: 10 };
    expect(getDisplayScore(b, "total")).toBe(40);
    expect(isScoreFiable(b, "total")).toBe(false);
  });

  it("con titularidad segura el total es fiable", () => {
    const b = { score_total: 90, score_activo: 40, derechos_operativos: 1 };
    expect(getDisplayScore(b, "total")).toBe(90);
    expect(isScoreFiable(b, "total")).toBe(true);
  });

  it("el modo activo nunca depende del gate", () => {
    expect(getDisplayScore({ score_total: 90, score_activo: 55 }, "activo")).toBe(55);
  });
});

describe("edificio verificado · el total sí se muestra", () => {
  it("porcentajes_estado 'verificado' abre el gate", () => {
    const b = { score_total: 84.3, score_activo: 73.8, porcentajes_estado: "verificado" };
    expect(isScoreFiable(b, "total")).toBe(true);
    expect(getDisplayScore(b, "total")).toBe(84.3);
  });

  it("los estados no verificados siguen degradando al número del edificio", () => {
    for (const estado of ["a_revisar", "verificado_pendiente_matching", "sin_nota", "sin_propietarios", null]) {
      const b = { score_total: 84.3, score_activo: 73.8, porcentajes_estado: estado };
      expect(isScoreFiable(b, "total")).toBe(false);
      expect(getDisplayScore(b, "total")).toBe(73.8);
    }
  });
});
