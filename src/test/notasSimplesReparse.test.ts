import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  normalizeRol,
  normalizeTitular,
  titularKey,
  sanitize,
  sanitizeDeep,
} from "../../supabase/functions/notas_simples_reparse/lib";

describe("normalizeRol", () => {
  it("desconocido/vacío -> otro (nunca pleno)", () => {
    for (const v of ["", "   ", null, undefined, "titular registral", "xyz", 42, {}]) {
      expect(normalizeRol(v as unknown)).toBe("otro");
    }
  });
  it("conserva ganancial", () => {
    expect(normalizeRol("ganancial")).toBe("ganancial");
    expect(normalizeRol("Sociedad de gananciales")).toBe("ganancial");
  });
  it("conserva pleno explícito y sus aliases", () => {
    expect(normalizeRol("pleno")).toBe("pleno");
    expect(normalizeRol("pleno_dominio")).toBe("pleno");
    expect(normalizeRol("Pleno Dominio")).toBe("pleno");
    expect(normalizeRol("plena propiedad")).toBe("pleno");
  });
  it("nuda propiedad y usufructo", () => {
    expect(normalizeRol("nuda propiedad")).toBe("nuda_propiedad");
    expect(normalizeRol("NUDA_PROPIEDAD")).toBe("nuda_propiedad");
    expect(normalizeRol("usufructo vitalicio")).toBe("usufructo");
  });
});

describe("titularKey", () => {
  it("no colapsa nuda propiedad y usufructo del mismo nombre y %", () => {
    const a = titularKey({ nombre: "María Ñoño", cif_dni: "12345678Z", porcentaje: 50, rol: "nuda_propiedad" });
    const b = titularKey({ nombre: "María Ñoño", cif_dni: "12345678Z", porcentaje: 50, rol: "usufructo" });
    expect(a).not.toBe(b);
  });
  it("distingue por DNI y colapsa duplicados idénticos", () => {
    expect(titularKey({ nombre: "Juan", cif_dni: "111", porcentaje: 50, rol: "pleno" }))
      .not.toBe(titularKey({ nombre: "Juan", cif_dni: "222", porcentaje: 50, rol: "pleno" }));
    expect(titularKey({ nombre: " juan  perez ", cif_dni: "1234-5678 z", porcentaje: "50", rol: "pleno_dominio" }))
      .toBe(titularKey({ nombre_extraido: "Juan Pérez", cif_dni: "12345678Z", porcentaje: 50, rol: "pleno" }));
  });
});

describe("saneado", () => {
  it("elimina NUL y control, conserva tildes y Unicode", () => {
    expect(sanitize("Peñ\u0000a Ñ\u0007ó ü — 石")).toBe("Peñ a Ñ ó ü — 石");
    expect(sanitize("línea\nuno\ttab")).toBe("línea\nuno\ttab");
  });
  it("sanea recursivamente objetos y arrays", () => {
    const out = sanitizeDeep({ a: "x\u0000y", b: [{ c: "ñ\u001Fz" }], n: 3, z: null });
    expect(out).toEqual({ a: "x y", b: [{ c: "ñ z" }], n: 3, z: null });
  });
});

describe("normalizeTitular", () => {
  it("rol desconocido -> otro y conserva rol_literal", () => {
    const t = normalizeTitular({ nombre: "ACME S.L.", rol: "concesión administrativa", porcentaje: "33,5" })!;
    expect(t.rol).toBe("otro");
    expect(t.rol_literal).toBe("concesión administrativa");
    expect(t.porcentaje).toBe(33.5);
  });
  it("no inventa evidencia", () => {
    expect(normalizeTitular({ nombre: "Ana" })!.evidencia).toBeNull();
    expect(normalizeTitular({ nombre: "Ana", evidencia: { cita: "URBANA…", pagina: 2 } })!.evidencia)
      .toEqual({ cita: "URBANA…", pagina: 2 });
  });
  it("descarta titulares sin nombre y sanea strings", () => {
    expect(normalizeTitular({ nombre: "  " })).toBeNull();
    expect(normalizeTitular({ nombre: "Jo\u0000sé" })!.nombre).toBe("Jo sé");
  });
});

describe("orden de escritura (estático)", () => {
  const src = readFileSync(
    path.resolve(__dirname, "../../supabase/functions/notas_simples_reparse/index.ts"),
    "utf8",
  );
  it("un fallo de insert de titular devuelve ok:false y no marca la nota", () => {
    expect(src).toContain("titular_insert_fail");
    expect(src.indexOf("titular_insert_fail")).toBeLessThan(src.indexOf('.from("notas_simples").update'));
  });
  it("no existe fallback a rol pleno", () => {
    expect(src).not.toMatch(/rol:\s*t\.rol\s*\?\?\s*"pleno"/);
  });
});
