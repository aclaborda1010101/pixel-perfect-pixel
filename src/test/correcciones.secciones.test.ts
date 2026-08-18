import { describe, it, expect } from "vitest";
import { TIPOS_DATOS, TIPOS_TRABAJO, esCorreccionDeDatos, etiquetaEstado } from "@/lib/correcciones";
import { decideAccess } from "@/lib/access";

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

describe("Orquestador: acceso desde el panel del responsable", () => {
  it("sales_manager puede abrir /correcciones (antes se le redirigía al panel)", () => {
    expect(decideAccess({ role: "sales_manager", pathname: "/correcciones" })).toEqual({ type: "allow" });
  });
  it("admin también", () => {
    expect(decideAccess({ role: "admin", pathname: "/correcciones" })).toEqual({ type: "allow" });
  });
  it("sales_manager sigue sin acceder a /admin ni a otras rutas", () => {
    expect(decideAccess({ role: "sales_manager", pathname: "/admin/guardas" }).type).toBe("redirect");
    expect(decideAccess({ role: "sales_manager", pathname: "/edificios" }).type).toBe("redirect");
  });
  it("la ruta no cambia de comportamiento para el resto de roles", () => {
    expect(decideAccess({ role: "comercial_zona", pathname: "/correcciones" }).type).toBe("allow");
  });
});
