import { describe, it, expect } from "vitest";
import {
  textoVinculo,
  etiquetaVinculo,
  lineaInfluenciador,
  textoOrigen,
  agrupaPorPropietario,
  resumenVinculacion,
  VINCULOS,
} from "@/lib/influenciadores";

describe("influenciadores · lenguaje llano", () => {
  it("traduce el vínculo a como lo diría una persona", () => {
    expect(textoVinculo("hijo_de")).toBe("su hijo/a");
    expect(textoVinculo("abogado_de")).toBe("su abogado");
    expect(textoVinculo("loquesea")).toBe("persona de su entorno");
  });

  it("etiqueta del desplegable", () => {
    expect(etiquetaVinculo("conyuge_de")).toBe("Cónyuge");
    expect(etiquetaVinculo(null)).toBe("Otro vínculo");
    expect(VINCULOS.length).toBeGreaterThanOrEqual(10);
  });

  it("monta la línea de la llamada y no inventa teléfono", () => {
    expect(
      lineaInfluenciador({ owner_id: "1", nombre: "Ana Domingo Gutiérrez", telefono: "600111222", relation_type: "hijo_de" }),
    ).toBe("Ana Domingo Gutiérrez — su hijo/a — 600111222");
    expect(lineaInfluenciador({ owner_id: "1", nombre: "Ana", relation_type: "hijo_de" })).toContain("sin teléfono");
  });

  it("explica de dónde sale el dato", () => {
    expect(textoOrigen("hubspot")).toBe("HubSpot");
    expect(textoOrigen("apellido")).toContain("apellido");
    expect(textoOrigen(undefined)).toContain("sin especificar");
  });
});

describe("influenciadores · agrupación por propietario", () => {
  const props = [
    { owner_id: "manolo", nombre: "Manuel Gutiérrez" },
    { owner_id: "otro", nombre: "Pedro Ruiz" },
  ];

  it("cuelga cada influenciador de su propietario y nunca de otro", () => {
    const { grupos, sinVincular } = agrupaPorPropietario(props, [
      { owner_id: "hija", nombre: "Ana", propietario_owner_id: "manolo", relation_type: "hijo_de" },
    ]);
    expect(grupos).toHaveLength(1);
    expect(grupos[0].propietario.owner_id).toBe("manolo");
    expect(grupos[0].influenciadores).toHaveLength(1);
    expect(sinVincular).toHaveLength(0);
  });

  it("los no vinculados van a su grupo aparte", () => {
    const { grupos, sinVincular } = agrupaPorPropietario(props, [
      { owner_id: "x", nombre: "Desconocido", propietario_owner_id: null, relation_type: "otro_vinculo" },
    ]);
    expect(grupos).toHaveLength(0);
    expect(sinVincular).toHaveLength(1);
  });

  it("si el propietario no está en la lista visible, no lo cuelga de nadie", () => {
    const { grupos, sinVincular } = agrupaPorPropietario(props, [
      { owner_id: "hija", nombre: "Ana", propietario_owner_id: "fantasma", relation_type: "hijo_de" },
    ]);
    expect(grupos).toHaveLength(0);
    expect(sinVincular.map((x) => x.owner_id)).toEqual(["hija"]);
  });

  it("resume el resultado sin adornos", () => {
    expect(resumenVinculacion({ vinculados: 12, sin_vincular: 40, ambiguos: 7 })).toBe(
      "12 vinculados a un propietario concreto · 40 sin vincular · 7 con más de un candidato posible, dejados a revisión",
    );
  });
});
