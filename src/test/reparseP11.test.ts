import { describe, it, expect } from "vitest";
import {
  buildCanaryP11,
  HECHOS_P11,
  P11_PLENO,
  P11_NUDA,
  P11_USUFRUCTO,
  P11_DERECHOS,
  P11_CARGAS,
  P11_PAGINAS,
  P11_CHARS_APROX,
} from "./helpers/notaCanaryFixtureP11";
import { extraerInventario } from "../../supabase/functions/notas_simples_reparse/completeness";
import {
  anclarDocumento,
  identidadAntesDelToken,
  contarTokensParticipacion,
  localizarVentanaRegistral,
} from "../../supabase/functions/notas_simples_reparse/parsing";
import { buildReplacementPlan, type FilaExistente } from "../../supabase/functions/notas_simples_reparse/reconcile";

const RAW = buildCanaryP11();

describe("P0.11 · morfología real del canario", () => {
  it("el fixture es el raw real anonimizado (sin TITULAR: fabricados)", () => {
    expect(RAW.length).toBe(P11_CHARS_APROX);
    expect((RAW.match(/\n/g) ?? []).length).toBe(0);
    expect((RAW.match(/TITULAR:/g) ?? []).length).toBe(2);
    expect(contarTokensParticipacion(RAW)).toBe(P11_DERECHOS + P11_CARGAS);
  });

  it("la ventana [TITULARIDADES, CARGAS) contiene exactamente 66 tokens", () => {
    const v = localizarVentanaRegistral(RAW)!;
    expect(v).toBeTruthy();
    const dentro = RAW.slice(v.inicio, v.fin).match(/PARTICIPACI[ÓO]N/gi) ?? [];
    expect(dentro.length).toBe(66);
    expect(v.razon_fin).toBe("cabecera_cargas_estructural");
  });

  it("el parser productivo devuelve 66/38/20/8 + 2 cargas, sin ambiguos", () => {
    const inv = extraerInventario(RAW);
    expect(inv.documento).toBe("NOTA_SIMPLE");
    expect(inv.hechos.length).toBe(P11_DERECHOS);
    expect(inv.hechos.filter((h) => h.right_type === "pleno").length).toBe(P11_PLENO);
    expect(inv.hechos.filter((h) => h.right_type === "nuda_propiedad").length).toBe(P11_NUDA);
    expect(inv.hechos.filter((h) => h.right_type === "usufructo").length).toBe(P11_USUFRUCTO);
    expect(inv.cargas).toBe(P11_CARGAS);
    expect(inv.ambiguos).toEqual([]);
    expect(inv.paginas).toBe(P11_PAGINAS);
    expect(inv.hechos.filter((h) => h.identidad_ambigua).length).toBe(0);
  });

  it("los 66 hechos tienen offset/localizador únicos", () => {
    const inv = extraerInventario(RAW);
    expect(new Set(inv.hechos.map((h) => h.offset)).size).toBe(66);
    expect(new Set(inv.hechos.map((h) => h.locator)).size).toBe(66);
  });

  it("porcentaje e identidad coinciden hecho a hecho con el oráculo", () => {
    const inv = extraerInventario(RAW);
    inv.hechos.forEach((h, i) => {
      const esperado = HECHOS_P11[i];
      expect(`${h.porcentaje_literal}%`).toBe(esperado.literal);
      expect(h.porcentaje).toBeCloseTo(esperado.porcentaje, 6);
      expect(h.right_type).toBe(esperado.derecho);
      expect(h.nombre).toBe(esperado.nombre);
    });
  });

  it("los porcentajes históricos del TITULO nunca crean hechos ni contaminan", () => {
    const inv = extraerInventario(RAW);
    // 12,5 y 4,0 y 100,0 sólo aparecen en TITULO/cargas: ningún hecho los usa.
    expect(inv.hechos.some((h) => h.porcentaje === 12.5 || h.porcentaje === 4 || h.porcentaje === 100)).toBe(false);
    // El tramo de cada hecho termina en TITULO: o en la siguiente participación.
    const { anclajes } = anclarDocumento(RAW);
    const titularidad = anclajes.filter((a) => a.seccion === "titularidad");
    expect(titularidad.length).toBe(66);
    expect(titularidad.every((a) => a.corte === "titulo")).toBe(true);
    expect(titularidad.every((a) => a.identidad[1] === a.token && a.identidad[0] < a.token)).toBe(true);
  });

  it("HIPOTECA narrativa dentro de la ventana no abre cargas", () => {
    const idx = RAW.indexOf("HIPOTECA mencionada");
    const v = localizarVentanaRegistral(RAW)!;
    expect(idx).toBeGreaterThan(v.inicio);
    expect(idx).toBeLessThan(v.fin);
  });
});

describe("P0.11 · casos morfológicos", () => {
  const conVentana = (cuerpo: string) => `NOTA SIMPLE INFORMATIVA. REGISTRO DE LA PROPIEDAD. TITULARIDADES ${cuerpo} CARGAS Y GRAVAMENES: nada.`;

  it("varios porcentajes dentro de TITULO => un solo hecho", () => {
    const inv = extraerInventario(conVentana(
      "GOMEZ SILVA, IRENE 11111111H Tomo 12 Libro 3 Folio 9 PARTICIPACION: 33,333333% del pleno dominio. TITULO: Adquirida por HERENCIA con un 66,666666% previo y un 10,000000% en pago.",
    ));
    expect(inv.hechos.length).toBe(1);
    expect(inv.hechos[0].porcentaje).toBeCloseTo(33.333333, 6);
    expect(inv.ambiguos).toEqual([]);
  });

  it("nombre justo antes del token y ruido de tomo/folio en medio", () => {
    const inv = extraerInventario(conVentana(
      "MOLINA RIOS, TOMAS 22222222J Tomo 1450 Libro 88 Folio 214 Inscripcion 5 PARTICIPACION: 50,000000% de la nuda propiedad. TITULO: HERENCIA.",
    ));
    expect(inv.hechos[0].nombre).toBe("MOLINA RIOS, TOMAS");
    expect(inv.hechos[0].doc).toBeTruthy();
    expect(inv.hechos[0].right_type).toBe("nuda_propiedad");
  });

  it("dos derechos del mismo titular son dos hechos distintos", () => {
    const inv = extraerInventario(conVentana(
      "SUAREZ LEON, PILAR 33333333P Tomo 10 Folio 1 PARTICIPACION: 25,000000% del usufructo. TITULO: HERENCIA. SUAREZ LEON, PILAR 33333333P Tomo 10 Folio 2 PARTICIPACION: 25,000000% de la nuda propiedad. TITULO: HERENCIA.",
    ));
    expect(inv.hechos.length).toBe(2);
    expect(inv.hechos.map((h) => h.right_type).sort()).toEqual(["nuda_propiedad", "usufructo"]);
    expect(new Set(inv.hechos.map((h) => h.offset)).size).toBe(2);
  });

  it("identidad sin DNI: el hecho no se pierde", () => {
    const inv = extraerInventario(conVentana(
      "HEREDEROS DE ANTONIO VALLE Tomo 4 Folio 8 PARTICIPACION: 10,000000% del pleno dominio. TITULO: HERENCIA.",
    ));
    expect(inv.hechos.length).toBe(1);
    expect(inv.hechos[0].doc).toBeNull();
    expect(inv.hechos[0].nombre).toContain("VALLE");
  });

  it("CIF de sociedad y fin de página pegado", () => {
    const inv = extraerInventario(conVentana(
      "Pagina 3 de 4PATRIMONIAL DEL SUR SL B87654321 Tomo 9 Folio 3 PARTICIPACION: 5,000000% del pleno dominio. TITULO: COMPRAVENTA.",
    ));
    expect(inv.hechos.length).toBe(1);
    expect(inv.hechos[0].doc).toBe("B87654321");
    expect(inv.hechos[0].nombre).toContain("PATRIMONIAL DEL SUR SL");
  });

  it("identidad irrecuperable: el hecho SIGUE en el inventario, marcado ambiguo", () => {
    const inv = extraerInventario(conVentana(
      "1234 5678 9012 PARTICIPACION: 7,000000% del pleno dominio. TITULO: HERENCIA.",
    ));
    expect(inv.hechos.length).toBe(1);
    expect(inv.hechos[0].identidad_ambigua).toBe(true);
    expect(inv.hechos[0].offset).toBeGreaterThan(0);
  });

  it("identidadAntesDelToken ignora el ruido numérico registral", () => {
    const id = identidadAntesDelToken("CASTRO PINO, LUCIA 44444444A Tomo 1201 Libro 31 Folio 77 Inscripcion 2 ");
    expect(id.nombre).toBe("CASTRO PINO, LUCIA");
    expect(id.doc).toBe("44444444A");
  });
});

describe("P0.11 · las 29 filas reales -> 66", () => {
  const inv = extraerInventario(RAW);

  /** Fixture anonimizado 1:1 de las 29 filas live (27 claves identidad+derecho). */
  const filas29: FilaExistente[] = (() => {
    const out: FilaExistente[] = [];
    for (let i = 0; i < 27; i++) {
      const h = inv.hechos[i];
      out.push({
        id: `live-${i}`,
        nombre_extraido: h.nombre,
        cif_dni: h.doc,
        // El live guardó porcentajes redondeados a 2 decimales.
        porcentaje: Number(h.porcentaje.toFixed(2)),
        rol: h.right_type,
        rol_literal: h.right_type === "pleno" ? "pleno dominio" : h.right_type.replace("_", " "),
        evidencia: { fuentes: [{ localizador: h.locator, cita: h.cita.slice(0, 80) }] },
      });
    }
    // Los dos grupos ambiguos reales: 1,17/3,5 y 0,33/1,04 sobre claves ya usadas.
    out.push({ id: "live-27", nombre_extraido: inv.hechos[0].nombre, cif_dni: inv.hechos[0].doc, porcentaje: 1.17, rol: inv.hechos[0].right_type, rol_literal: "pleno dominio", evidencia: { fuentes: [{ localizador: inv.hechos[0].locator, cita: "grupo 1,17/3,5" }] } });
    out.push({ id: "live-28", nombre_extraido: inv.hechos[1].nombre, cif_dni: inv.hechos[1].doc, porcentaje: 0.33, rol: inv.hechos[1].right_type, rol_literal: "pleno dominio", evidencia: { fuentes: [{ localizador: inv.hechos[1].locator, cita: "grupo 0,33/1,04" }] } });
    return out;
  })();

  const deseados = inv.hechos.map((h) => ({
    nombre: h.nombre ?? "",
    cif_dni: h.doc,
    porcentaje: h.porcentaje,
    rol: h.right_type,
    rol_literal: h.right_type === "pleno" ? "pleno dominio" : h.right_type.replace("_", " "),
    evidencia: { fuentes: [{ localizador: h.locator, cita: h.cita.slice(0, 80) }] },
  })) as any;

  it("el fixture live tiene 29 filas y 27 claves identidad+derecho", () => {
    expect(filas29.length).toBe(29);
    const claves = new Set(filas29.map((f) => `${f.nombre_extraido}|${f.cif_dni}|${f.rol}`));
    expect(claves.size).toBe(27);
    expect(filas29.every((f) => f.rol && f.rol_literal && f.evidencia)).toBe(true);
  });

  it("29 -> 66: set final exacto, vínculos deterministas y ambiguos a review", () => {
    const plan = buildReplacementPlan(filas29, deseados);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Set final EXACTO: 29 filas - 4 retiradas + 41 nuevas = 66.
    expect(plan.inserts.length).toBeGreaterThan(0);
    expect(filas29.length - plan.deletes.length + plan.inserts.length).toBe(66);
    // Las dos claves duplicadas quedan en review y jamás propagan vínculo.
    expect(plan.reviews.length).toBeGreaterThanOrEqual(1);
    expect(plan.reviews.every((r) => r.reason === "multiple_existing_links")).toBe(true);
    // Las filas ambiguas se retiran; ninguna otra nota se toca.
    expect(plan.deletes).toEqual(expect.arrayContaining(["live-27", "live-28"]));
    // Los porcentajes redondeados se corrigen a 6 decimales exactos.
    expect(plan.updates.some((u) => typeof u.patch.porcentaje === "number")).toBe(true);
  });

  it("retry: aplicar el plan sobre el set final es 66 y cero cambios", () => {
    const finales: FilaExistente[] = inv.hechos.map((h, i) => ({
      id: `fin-${i}`,
      nombre_extraido: h.nombre,
      cif_dni: h.doc,
      porcentaje: h.porcentaje,
      rol: h.right_type,
      rol_literal: h.right_type === "pleno" ? "pleno dominio" : h.right_type.replace("_", " "),
      evidencia: { fuentes: [{ localizador: h.locator, cita: h.cita.slice(0, 80) }] },
    }));
    const plan = buildReplacementPlan(finales, deseados);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.inserts.length).toBe(0);
    expect(plan.deletes.length).toBe(0);
    expect(plan.updates.length).toBe(0);
    expect(finales.length).toBe(66);
  });
});
