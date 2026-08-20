import { describe, it, expect } from "vitest";
import { cabeceraCoherencia, evolucion, tendencia, saludBase, type ReglaCoherencia } from "@/lib/coherencia";

const regla = (p: Partial<ReglaCoherencia>): ReglaCoherencia => ({
  codigo: "x", nombre: "x", explicacion: "x", n_casos: 0, error: null,
  aceptada: false, aceptada_motivo: null, medido_at: null, historico: [], ...p,
});

describe("auditor de coherencia", () => {
  it("suma solo reglas no aceptadas y devuelve las tres peores", () => {
    const c = cabeceraCoherencia([
      regla({ codigo: "a", n_casos: 10 }),
      regla({ codigo: "b", n_casos: 50 }),
      regla({ codigo: "c", n_casos: 5 }),
      regla({ codigo: "d", n_casos: 100, aceptada: true }),
      regla({ codigo: "e", n_casos: 0 }),
      regla({ codigo: "f", n_casos: 7 }),
    ]);
    expect(c.total).toBe(72);
    expect(c.enCero).toBe(1);
    expect(c.peores.map((r) => r.codigo)).toEqual(["b", "a", "f"]);
  });

  it("cuenta reglas con error de medición", () => {
    expect(cabeceraCoherencia([regla({ n_casos: -1 })]).conError).toBe(1);
  });

  it("pinta la evolución de más antigua a más reciente", () => {
    expect(evolucion([{ n: 12 }, { n: 120 }, { n: 457 }])).toBe("457 → 120 → 12");
    expect(evolucion([])).toBe("");
  });

  it("detecta si una regla mejora o empeora", () => {
    expect(tendencia([{ n: 3 }, { n: 9 }])).toBe("mejora");
    expect(tendencia([{ n: 9 }, { n: 3 }])).toBe("empeora");
    expect(tendencia([{ n: 3 }, { n: 3 }])).toBe("igual");
    expect(tendencia([{ n: 3 }])).toBe("igual");
  });

  it("resume la salud de la base en lenguaje llano", () => {
    expect(saludBase(0).tono).toBe("bien");
    expect(saludBase(30).tono).toBe("atencion");
    expect(saludBase(900).tono).toBe("mal");
  });
});
