import { describe, it, expect } from "vitest";
import { propuestaEnLlano, tipoPorCodigo, esCorreccionDeDatos } from "@/lib/correcciones";

describe("nuevas guardas del Orquestador", () => {
  it("la guarda 7 propone dar de alta al titular con su porcentaje", () => {
    expect(propuestaEnLlano(7, { nombre: "ANA PEREZ", porcentaje: 12.5 })).toContain("ANA PEREZ");
    expect(propuestaEnLlano(7, { nombre: "ANA PEREZ", porcentaje: 12.5 })).toContain("12.5%");
  });
  it("la guarda 8 nunca separa nombres por su cuenta", () => {
    expect(propuestaEnLlano(8, { nombre: "A Y B" })).toMatch(/a mano/i);
    expect(tipoPorCodigo(8).automatico).toBe(false);
  });
  it("la guarda 9 exige confirmación humana", () => {
    expect(propuestaEnLlano(9, {})).toMatch(/a mano/i);
    expect(tipoPorCodigo(9).automatico).toBe(false);
  });
  it("las tres cuentan como correcciones de datos", () => {
    expect([7, 8, 9].every(esCorreccionDeDatos)).toBe(true);
  });
});
