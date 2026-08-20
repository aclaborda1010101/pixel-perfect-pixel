import { describe, it, expect } from "vitest";
import { estadoDesdeDatos, explicaEstado, sumaCuadra, SUMA_MIN, SUMA_MAX } from "@/lib/estadoEdificio";

describe("regla única del estado de propiedad", () => {
  it("sin personas cargadas es sin propietarios", () => {
    expect(estadoDesdeDatos({ nPersonas: 0, suma: 0 })).toBe("sin_propietarios");
  });

  it("sin nota y sin cuotas es sin nota", () => {
    expect(estadoDesdeDatos({ nPersonas: 4, suma: 0, nTitulares: 0 })).toBe("sin_nota");
  });

  it("suma correcta y todos emparejados es verificado", () => {
    expect(estadoDesdeDatos({ nPersonas: 5, suma: 100, nTitulares: 5, titularesSinFicha: 0 })).toBe("verificado");
  });

  it("suma correcta con titulares sin ficha es pendiente de emparejar", () => {
    expect(estadoDesdeDatos({ nPersonas: 5, suma: 99.98, nTitulares: 6, titularesSinFicha: 1 })).toBe(
      "verificado_pendiente_matching",
    );
  });

  it("hay datos pero la suma no cuadra: en revisión", () => {
    expect(estadoDesdeDatos({ nPersonas: 5, suma: 72, nTitulares: 7 })).toBe("a_revisar");
    expect(estadoDesdeDatos({ nPersonas: 5, suma: 130, nTitulares: 7 })).toBe("a_revisar");
  });
});

describe("un estado nunca puede contradecir su suma", () => {
  const muestras = [
    { nPersonas: 9, suma: 100, nTitulares: 9, titularesSinFicha: 0 },
    { nPersonas: 9, suma: 100, nTitulares: 10, titularesSinFicha: 1 },
    { nPersonas: 9, suma: 67.49, nTitulares: 12, titularesSinFicha: 3 },
    { nPersonas: 9, suma: 452.82, nTitulares: 57, titularesSinFicha: 0 },
    { nPersonas: 0, suma: 0, nTitulares: 0, titularesSinFicha: 0 },
    { nPersonas: 3, suma: 0, nTitulares: 0, titularesSinFicha: 0 },
    { nPersonas: 1, suma: 99.25, nTitulares: 1, titularesSinFicha: 0 },
    { nPersonas: 1, suma: 100.75, nTitulares: 1, titularesSinFicha: 0 },
    { nPersonas: 1, suma: 99.24, nTitulares: 1, titularesSinFicha: 0 },
    { nPersonas: 1, suma: 100.76, nTitulares: 1, titularesSinFicha: 0 },
  ];

  it("verificado implica suma entre 99,25 y 100,75 y cero titulares sin ficha", () => {
    for (const m of muestras) {
      const e = estadoDesdeDatos(m);
      if (e === "verificado") {
        expect(sumaCuadra(m.suma)).toBe(true);
        expect(m.titularesSinFicha ?? 0).toBe(0);
      }
      if (e === "verificado_pendiente_matching") {
        expect(m.suma).toBeGreaterThanOrEqual(SUMA_MIN);
        expect(m.suma).toBeLessThanOrEqual(SUMA_MAX);
        expect(m.titularesSinFicha ?? 0).toBeGreaterThan(0);
      }
      if (e === "a_revisar") expect(sumaCuadra(m.suma)).toBe(false);
      if (e === "sin_propietarios") expect(m.nPersonas).toBe(0);
    }
  });

  it("todo estado va siempre acompañado de una explicación en una línea", () => {
    for (const m of muestras) {
      const t = explicaEstado(estadoDesdeDatos(m), { suma: m.suma, titularesSinFicha: m.titularesSinFicha });
      expect(t.length).toBeGreaterThan(20);
      expect(t).not.toMatch(/matching|null|undefined/);
    }
  });
});

describe("explicaciones concretas", () => {
  it("pendiente de emparejar dice cuántos faltan", () => {
    expect(explicaEstado("verificado_pendiente_matching", { titularesSinFicha: 2 })).toContain(
      "faltan 2 propietarios",
    );
  });
  it("sin propietarios invita a actualizar desde HubSpot", () => {
    expect(explicaEstado("sin_propietarios")).toContain("Actualizar");
  });
});