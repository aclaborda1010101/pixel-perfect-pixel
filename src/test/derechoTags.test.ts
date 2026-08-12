import { describe, it, expect } from "vitest";
import { derechoTags, grupoDerecho, AYUDA_DERECHOS } from "@/components/comercial/DerechoTags";

describe("etiquetas de tipo de derecho", () => {
  it("muestra pleno y nuda cuando ambos tienen valor", () => {
    const t = derechoTags({ pct_pleno: 4.46, pct_nuda: 2.7 });
    expect(t.map((x) => x.etiqueta)).toEqual(["Pleno 4,46%", "Nuda 2,70%"]);
  });

  it("muestra el usufructo aunque no haya propiedad", () => {
    const t = derechoTags({ pct_propiedad: null, pct_usufructo: 1.07 } as any);
    expect(t.map((x) => x.etiqueta)).toEqual(["Usufructo 1,07%"]);
  });

  it("con solo pleno dominio muestra una única etiqueta", () => {
    const t = derechoTags({ pct_pleno: 5.57 });
    expect(t).toHaveLength(1);
    expect(t[0].etiqueta).toBe("Pleno 5,57%");
  });

  it("no muestra nada cuando no hay valores (edificios en revisión)", () => {
    expect(derechoTags({})).toEqual([]);
    expect(derechoTags({ pct_pleno: null, pct_nuda: 0, pct_usufructo: undefined })).toEqual([]);
  });

  it("la leyenda usa lenguaje llano", () => {
    expect(AYUDA_DERECHOS).toContain("cuotas y tareas");
    expect(AYUDA_DERECHOS.toLowerCase()).not.toMatch(/motor|backlog|v5|disparador/);
  });
});

describe("grupoDerecho", () => {
  it("clasifica propiedad, solo usufructo y sin derecho", () => {
    expect(grupoDerecho({ pct_propiedad: 7.6, pct_pleno: 7.6 })).toBe("propiedad");
    expect(grupoDerecho({ pct_nuda: 3 })).toBe("propiedad");
    expect(grupoDerecho({ pct_usufructo: 20 })).toBe("usufructo");
    expect(grupoDerecho({})).toBe("sin_derecho");
    expect(grupoDerecho({ pct_propiedad: 5, pct_invalido: true })).toBe("sin_derecho");
  });
});

describe("chapita de influenciador", () => {
  it("solo marca a los que vienen con es_influencer", () => {
    expect(esInfluenciador({ es_influencer: true })).toBe(true);
    expect(esInfluenciador({ es_influencer: false })).toBe(false);
    expect(esInfluenciador({})).toBe(false);
  });

  it("usa lenguaje llano y el filtro se llama Influenciadores", () => {
    expect(TEXTO_INFLUENCIADOR).toContain("nota simple");
    for (const prohibido of ["disparador", "v5", "backlog", "motor", "guarda", "orquestador"]) {
      expect(TEXTO_INFLUENCIADOR.toLowerCase()).not.toContain(prohibido);
    }
    const ficha = readFileSync("src/pages/comercial/EdificioDetalle.tsx", "utf8");
    expect(ficha).toContain("Influenciadores (${conteoGrupos.sin_derecho})");
    expect(ficha).not.toContain("Sin derecho en la nota (");
  });
});
