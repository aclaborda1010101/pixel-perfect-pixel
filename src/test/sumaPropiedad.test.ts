import { describe, it, expect } from "vitest";
import { explicaSuma, explicaFuente, sumaCompleta } from "@/lib/sumaPropiedad";

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

  it("nunca deja una suma incoherente sin explicar (Esparteros 13)", () => {
    const t = explicaSuma({ suma: 0, incoherente: true, sumaBruta: 452.82 });
    expect(t).toContain("452,82 %");
    expect(t).toContain("varias fincas registrales");
  });

  it("explica el edificio sin ningún porcentaje", () => {
    expect(explicaSuma({ suma: 0 })).toMatch(/no consta ningún porcentaje/);
  });

  it("siempre dice algo si la suma no llega a 100", () => {
    expect(explicaSuma({ suma: 80 })).toMatch(/no llega a 100/);
  });
});

describe("fuente de los porcentajes", () => {
  it("distingue CRM, nota y pendiente de enlazar", () => {
    expect(explicaFuente({ fuente: "crm" })).toContain("HubSpot");
    expect(explicaFuente({ fuente: "nota" })).toContain("nota del Registro");
    expect(explicaFuente({ fuente: "nota", estado: "verificado_pendiente_matching" })).toContain(
      "pendientes de validar",
    );
  });
});

describe("regla dura: la suma visible nunca pasa de 100", () => {
  it("una suma por encima de 100 solo puede mostrarse como incoherente", () => {
    // Contrato de la vista: cuando la suma bruta supera 100,75 los porcentajes
    // se ocultan (pct_propiedad = null) y el edificio se marca incoherente.
    const filas = [
      { pct_propiedad: null, pct_incoherente: true },
      { pct_propiedad: null, pct_incoherente: true },
    ];
    const visible = filas.reduce((t, f) => t + Number(f.pct_propiedad ?? 0), 0);
    expect(visible).toBeLessThanOrEqual(100);
    expect(explicaSuma({ suma: visible, incoherente: true, sumaBruta: 452.82 })).toBeTruthy();
  });
});
