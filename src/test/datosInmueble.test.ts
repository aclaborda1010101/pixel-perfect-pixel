import { describe, it, expect } from "vitest";
import {
  normalizarPorcentaje,
  datosInmuebleDesdeHubspot,
  cambiosInmueble,
} from "../../supabase/functions/_shared/datosInmueble.ts";

describe("datos del inmueble desde HubSpot", () => {
  it("normaliza el porcentaje venga como venga", () => {
    expect(normalizarPorcentaje("84.37%")).toBe(84.37);
    expect(normalizarPorcentaje("33,63 %")).toBe(33.63);
    expect(normalizarPorcentaje(0.207)).toBe(20.7); // fracción → tanto por ciento
    expect(normalizarPorcentaje("100%")).toBe(100);
    expect(normalizarPorcentaje("120")).toBe(100); // nunca más de cien
    expect(normalizarPorcentaje("")).toBeNull();
    expect(normalizarPorcentaje(null)).toBeNull();
  });

  it("lee el caso de Calle Segovia 35 tal cual lo tiene el cliente", () => {
    const d = datosInmuebleDesdeHubspot({
      dealname: "Calle Segovia 35",
      address: "Calle Segovia 35",
      referencia_catastral: "9441101vk3794a0001ft",
      uso_principal: "Residencial",
      metros_cuadrados_viviendas: "2594",
      viviendas__unidades___clonada_: "53",
      porcentaje_terciario: "84.37%",
      porcentaje_residencial: "15.63%",
      dealstage: "1008375974",
    });
    expect(d.num_viviendas).toBe(53);
    expect(d.pct_terciario).toBe(84.37);
    expect(d.pct_residencial).toBe(15.63);
    expect(d.metros_viviendas).toBe(2594);
    expect(d.refcatastral).toBe("9441101VK3794A0001FT");
  });

  it("sobrescribe lo nuestro cuando HubSpot dice otra cosa", () => {
    const hs = datosInmuebleDesdeHubspot({
      dealname: "Calle Segovia 35",
      viviendas__unidades___clonada_: "53",
      porcentaje_terciario: "84.37%",
      metros_cuadrados_viviendas: "2594",
    });
    const { parche, cambios } = cambiosInmueble(
      { direccion: "Calle Segovia 35", num_viviendas: 28, pct_terciario: 12.88, metros_viviendas: 2594 },
      hs,
    );
    expect(parche.num_viviendas).toBe(53);
    expect(parche.pct_terciario).toBe(84.37);
    expect(parche.metros_viviendas).toBeUndefined(); // coincide dentro de tolerancia
    expect(parche.direccion).toBeUndefined();
    expect(cambios.map((c) => c.campo).sort()).toEqual(["num_viviendas", "pct_terciario"]);
  });

  it("nunca borra un dato nuestro si HubSpot no lo tiene", () => {
    const hs = datosInmuebleDesdeHubspot({ dealname: "Calle X 1" });
    const { parche } = cambiosInmueble({ direccion: "Calle X 1", num_viviendas: 10, pct_terciario: 5 }, hs);
    expect(parche).toEqual({});
  });
});
