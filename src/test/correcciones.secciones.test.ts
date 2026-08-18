import { describe, it, expect } from "vitest";
import { TIPOS_DATOS, TIPOS_TRABAJO, esCorreccionDeDatos, etiquetaEstado } from "@/lib/correcciones";

describe("secciones de correcciones", () => {
  it("la sección de datos contiene guardas 1, 2 y 6", () => {
    expect(TIPOS_DATOS.map((t) => t.codigo).sort()).toEqual([1, 2, 6]);
  });
  it("el trabajo comercial es solo la guarda 4", () => {
    expect(TIPOS_TRABAJO.map((t) => t.codigo)).toEqual([4]);
  });
  it("la guarda 4 no cuenta como corrección de datos", () => {
    expect(esCorreccionDeDatos(4)).toBe(false);
    expect(esCorreccionDeDatos(1)).toBe(true);
  });
  it("existe etiqueta para archivadas", () => {
    expect(etiquetaEstado("obsoleta")).toBe("Archivada · ya no aplica");
  });
});
