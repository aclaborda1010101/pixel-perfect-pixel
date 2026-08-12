import { describe, it, expect } from "vitest";
import { derechoTags, AYUDA_DERECHOS } from "@/components/comercial/DerechoTags";

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
