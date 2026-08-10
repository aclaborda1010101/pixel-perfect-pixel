import { describe, expect, it } from "vitest";
import { agruparPorCapa, type TitularCapa } from "./titularidadCapas";

function t(p: Partial<TitularCapa>): TitularCapa {
  return {
    building_id: "b", nota_id: "n", fecha_emision_nota: null,
    titular_id: Math.random().toString(36).slice(2),
    nombre_extraido: "X", cif_dni: null, porcentaje: null, rol: "pleno",
    es_sociedad: false, tiene_contacto_crm: true, ...p,
  };
}

describe("agruparPorCapa", () => {
  it("no mezcla capas: usufructo y nuda propiedad suman por separado", () => {
    const capas = agruparPorCapa([
      t({ rol: "usufructo", porcentaje: 100 }),
      t({ rol: "nuda_propiedad", porcentaje: 50 }),
      t({ rol: "nuda_propiedad", porcentaje: 50 }),
    ]);
    expect(capas.map((c) => c.rol)).toEqual(["nuda_propiedad", "usufructo"]);
    expect(capas.map((c) => c.suma)).toEqual([100, 100]);
    expect(capas.every((c) => c.completa)).toBe(true);
  });

  it("regresión Abel 7: sin titulares no hay capas ni suma plana", () => {
    expect(agruparPorCapa([])).toEqual([]);
  });

  it("regresión Palencia 3: capa contradictoria se marca incompleta, no se compensa con otra capa", () => {
    const capas = agruparPorCapa([
      t({ rol: "pleno", porcentaje: 50 }),
      t({ rol: "usufructo", porcentaje: 50 }),
    ]);
    // la suma plana daría 100 y pasaría el control: por capa ambas fallan
    expect(capas.find((c) => c.rol === "pleno")?.completa).toBe(false);
    expect(capas.find((c) => c.rol === "usufructo")?.completa).toBe(false);
  });

  it("capa sin porcentajes queda con suma nula y no se da por completa", () => {
    const [capa] = agruparPorCapa([t({ rol: "otro", porcentaje: null })]);
    expect(capa.suma).toBeNull();
    expect(capa.completa).toBe(false);
  });
});
