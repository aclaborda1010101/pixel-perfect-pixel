import { describe, it, expect } from "vitest";
import {
  decidirLeadStatus, indiceEstado, lotes, normalizar, ordenarOpciones,
} from "../../supabase/functions/_shared/hubspotWrite/leadStatus";

const orden = ordenarOpciones([
  { label: "En negociación", value: "EN_NEGOCIACION", displayOrder: 5 },
  { label: "No contactado", value: "NEW", displayOrder: 0 },
  { label: "Contactado", value: "CONNECTED", displayOrder: 2 },
  { label: "Primer contacto", value: "PRIMER", displayOrder: 3 },
  { label: "Intento de contacto", value: "ATTEMPTED", displayOrder: 1 },
  { label: "Evaluación", value: "EVAL", displayOrder: 4 },
]);
const objetivo = "CONNECTED";

describe("estado de ciclo en HubSpot", () => {
  it("ordena las opciones del portal", () => {
    expect(orden.map((o) => o.value)).toEqual(["NEW", "ATTEMPTED", "CONNECTED", "PRIMER", "EVAL", "EN_NEGOCIACION"]);
  });

  it("escribe cuando está vacío", () => {
    expect(decidirLeadStatus({ actual: null, orden, valorObjetivo: objetivo }))
      .toEqual({ accion: "escribir", valor: "CONNECTED" });
  });

  it("escribe cuando el estado es anterior", () => {
    for (const a of ["NEW", "ATTEMPTED", "No contactado", "intento de contacto"]) {
      expect(decidirLeadStatus({ actual: a, orden, valorObjetivo: objetivo }).accion).toBe("escribir");
    }
  });

  it("no pisa un estado igual o posterior", () => {
    for (const a of ["CONNECTED", "Contactado", "PRIMER", "Evaluación", "EN_NEGOCIACION"]) {
      expect(decidirLeadStatus({ actual: a, orden, valorObjetivo: objetivo }).accion).toBe("ya_resuelto");
    }
  });

  it("no toca estados no reconocidos", () => {
    const d = decidirLeadStatus({ actual: "ESTADO_RARO", orden, valorObjetivo: objetivo });
    expect(d.accion).toBe("no_aplicable");
  });

  it("no aplica si el portal no tiene el objetivo", () => {
    expect(decidirLeadStatus({ actual: null, orden, valorObjetivo: null }).accion).toBe("no_aplicable");
  });

  it("compara sin acentos ni mayúsculas", () => {
    expect(normalizar(" Evaluación ")).toBe("evaluacion");
    expect(indiceEstado("evaluacion", orden)).toBe(4);
  });

  it("trocea en lotes de 100 como exige la API", () => {
    const l = lotes(Array.from({ length: 250 }, (_, i) => i), 100);
    expect(l.map((x) => x.length)).toEqual([100, 100, 50]);
  });
});
