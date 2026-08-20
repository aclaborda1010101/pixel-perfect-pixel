import { describe, it, expect } from "vitest";
import { explicaSuma, sumaCompleta } from "@/lib/sumaPropiedad";

describe("explicación de la suma de propiedad", () => {
  it("no explica nada cuando la suma cuadra", () => {
    expect(sumaCompleta(99.98)).toBe(true);
    expect(explicaSuma({ suma: 99.98 })).toBeNull();
  });

  it("explica el caso de varias fincas (Ribera de Curtidores 10)", () => {
    const t = explicaSuma({ suma: 67.49, nFincas: 2 });
    expect(t).toContain("2 fincas registrales");
    expect(t).toContain("finca a finca");
  });

  it("explica los titulares sin ficha con su porcentaje", () => {
    const t = explicaSuma({ suma: 76, titularesSinFicha: 2, pctSinFicha: 24 });
    expect(t).toContain("faltan 2 propietarios por dar de alta");
    expect(t).toContain("24 %");
  });

  it("combina ambas causas", () => {
    const t = explicaSuma({ suma: 50, nFincas: 3, titularesSinFicha: 1, pctSinFicha: 10 });
    expect(t).toContain("3 fincas");
    expect(t).toContain("1 propietario");
  });

  it("siempre dice algo si la suma no llega a 100", () => {
    expect(explicaSuma({ suma: 80 })).toMatch(/no llega a 100/);
    expect(explicaSuma({ suma: 140 })).toMatch(/pasa de 100/);
  });
});
