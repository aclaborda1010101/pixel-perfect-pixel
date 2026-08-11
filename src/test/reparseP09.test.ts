/**
 * REPARSEO P0.9 — parser independiente de saltos de línea, oráculo exacto del
 * canario real y reemplazo registral 29→66. Todo contra el código productivo.
 */
import { describe, it, expect } from "vitest";
import {
  buildCanaryText, HECHOS_CANARY, CANARY_CHARS, CANARY_PAGINAS,
  CANARY_DERECHOS, CANARY_PLENO, CANARY_NUDA, CANARY_USUFRUCTO, CANARY_CARGAS,
  CANARY_TITULARIDADES_OFFSET, CANARY_HIPOTECA_NARRATIVA_OFFSET, CANARY_CARGAS_OFFSET,
} from "./helpers/notaCanaryFixture";
import { extraerInventario, contarCapas, reconciliarCompletitud } from "../../supabase/functions/notas_simples_reparse/completeness";
import {
  construirExtracto, estadoTextoFuente, segmentarPaginas, segmentarSecciones, contarTokensParticipacion,
} from "../../supabase/functions/notas_simples_reparse/parsing";
import { buildReplacementPlan } from "../../supabase/functions/notas_simples_reparse/reconcile";

const TEXTO = buildCanaryText();

describe("P0.9 · morfología real del canario", () => {
  it("el fixture reproduce 27.574 chars, 0 saltos y 12 páginas", () => {
    expect(TEXTO.length).toBe(CANARY_CHARS);
    expect((TEXTO.match(/\n/g) ?? []).length).toBe(0);
    expect(Math.max(...segmentarPaginas(TEXTO).map((p) => p.page))).toBe(CANARY_PAGINAS);
    expect(contarTokensParticipacion(TEXTO)).toBe(CANARY_DERECHOS + CANARY_CARGAS); // 68
    expect(TEXTO.indexOf("TITULARIDADES")).toBe(CANARY_TITULARIDADES_OFFSET);
    expect(TEXTO.indexOf("HIPOTECA mencionada")).toBe(CANARY_HIPOTECA_NARRATIVA_OFFSET);
    expect(TEXTO.indexOf("CARGAS Y GRAVAMENES")).toBe(CANARY_CARGAS_OFFSET);
  });

  it("el inventario productivo devuelve EXACTO 66/38/20/8 y 2 cargas excluidas", () => {
    const inv = extraerInventario(TEXTO);
    expect(inv.documento).toBe("NOTA_SIMPLE");
    expect(inv.ambiguos).toEqual([]);
    expect(inv.hechos.length).toBe(CANARY_DERECHOS);
    expect(contarCapas(inv.hechos)).toEqual({
      pleno: CANARY_PLENO, nuda_propiedad: CANARY_NUDA, usufructo: CANARY_USUFRUCTO,
    });
    expect(inv.cargas).toBe(CANARY_CARGAS);
    expect(inv.paginas).toBe(CANARY_PAGINAS);
    expect(inv.diagnostico.saltos_de_linea).toBe(0);
  });

  it("cada hecho lleva offset, página y cita ancladas al texto real", () => {
    const inv = extraerInventario(TEXTO);
    for (const h of inv.hechos) {
      expect(h.page).toBeGreaterThanOrEqual(1);
      expect(h.page).toBeLessThanOrEqual(CANARY_PAGINAS);
      expect(TEXTO.slice(h.range[0], h.range[1])).toContain(h.cita.slice(0, 40));
      expect(h.offset).toBe(h.range[0]);
    }
    const esperados = HECHOS_CANARY.map((h) => `${h.nombre}|${h.derecho}|${h.porcentaje.toFixed(6)}`).sort();
    const reales = inv.hechos.map((h) => `${h.nombre}|${h.right_type}|${h.porcentaje.toFixed(6)}`).sort();
    expect(reales).toEqual(esperados);
  });

  it("la completitud 1:1 pasa con los 66 y falla con los 29 parciales", () => {
    const inv = extraerInventario(TEXTO);
    const todos = inv.hechos.map((h) => ({ nombre: h.nombre, rol: h.right_type, porcentaje: h.porcentaje }));
    expect(reconciliarCompletitud({ inventario: inv, materializados: todos }).ok).toBe(true);
    const parcial = reconciliarCompletitud({
      inventario: inv,
      materializados: todos.slice(0, 29).map((t) => ({ ...t, porcentaje: Number(t.porcentaje.toFixed(2)) })),
    });
    expect(parcial.ok).toBe(false);
    expect(parcial.expected).toBe(66);
    expect(parcial.materialized).toBe(29);
  });
});

describe("P0.9 · negativos del parser", () => {
  it("documento de cargas puro: cero hechos, participaciones contadas como cargas", () => {
    const t = "NOTA SIMPLE INFORMATIVA. FINCA 1. CARGAS: HIPOTECA con PARTICIPACION 100% a favor de BANCO. AFECCION con PARTICIPACION 5%.";
    const inv = extraerInventario(t);
    expect(inv.hechos.length).toBe(0);
    expect(inv.cargas).toBe(2);
    expect(inv.ambiguos.length).toBeGreaterThan(0); // fail-closed: nunca "completo"
  });

  it("encabezados pegados al texto anterior se reconocen igual", () => {
    const t = "NOTA SIMPLE INFORMATIVA registro de la propiedad.TITULARIDADES:TITULAR: ANA GIL SORIA, DNI 00000001R, PARTICIPACION 50,000000% en pleno dominio.TITULAR: LUIS GIL SORIA, DNI 00000002W, PARTICIPACION 50,000000% en pleno dominio.CARGAS:HIPOTECA con PARTICIPACION 100% a favor de BANCO.";
    const inv = extraerInventario(t);
    expect(inv.hechos.length).toBe(2);
    expect(inv.cargas).toBe(1);
  });

  it("páginas sin salto de línea se numeran por posición", () => {
    const t = "NOTA SIMPLE. TITULARIDADES: TITULAR: A B C, PARTICIPACION 10,000000% en pleno dominio. Pagina 2 de 2 TITULAR: D E F, PARTICIPACION 90,000000% en usufructo.";
    const inv = extraerInventario(t);
    expect(inv.hechos.map((h) => h.page)).toEqual([1, 2]);
  });

  it("token histórico con PARTICIPACION y sin inventario falla cerrado, no NON_REGISTRY", () => {
    const t = "DOCUMENTO INTERNO SIN MARCAS. PARTICIPACION 33% pendiente de calificacion.";
    const inv = extraerInventario(t);
    expect(inv.hechos.length).toBe(0);
    expect(inv.documento).toBe("NOTA_SIMPLE");
    expect(inv.ambiguos[0].motivo).toMatch(/inventario_vacio_con_participaciones/);
    const c = reconciliarCompletitud({ inventario: inv, materializados: [] });
    expect(c.ok).toBe(false);
  });

  it("documento sin ninguna marca registral sigue siendo NON_REGISTRY_DOCUMENT", () => {
    const inv = extraerInventario("FACTURA 2026-001. IMPORTE 1.200 EUROS. GRACIAS POR SU CONFIANZA.");
    expect(inv.documento).toBe("NON_REGISTRY_DOCUMENT");
  });
});

describe("P0.9 · extracción completa por páginas", () => {
  it("cubre el documento entero (nunca slice(0,60000)) con ids de página y offsets", () => {
    const e = construirExtracto(TEXTO);
    expect(e.truncado).toBe(false);
    expect(e.paginas).toBe(CANARY_PAGINAS);
    expect(e.cubiertos).toBeGreaterThanOrEqual(TEXTO.length);
    expect(e.chunks.every((c) => c.page >= 1 && c.fin > c.inicio)).toBe(true);
    const unido = e.chunks.map((c) => TEXTO.slice(c.inicio, c.fin)).join("");
    for (const h of HECHOS_CANARY) expect(unido).toContain(h.cita);
  });

  it("PDF escaneado sin capa de texto => no_evaluable / OCR_required", () => {
    const r = estadoTextoFuente("   ");
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ estado: "no_evaluable", reason: "OCR_required" });
    expect(estadoTextoFuente(TEXTO).ok).toBe(true);
  });

  it("secciones de cargas quedan delimitadas por posición", () => {
    const zonas = segmentarSecciones(TEXTO);
    expect(zonas.some((z) => z.seccion === "titularidad")).toBe(true);
    expect(zonas.some((z) => z.seccion === "cargas")).toBe(true);
  });
});

describe("P0.9 · reemplazo registral 29 → 66", () => {
  const inv = extraerInventario(TEXTO);
  const deseados = inv.hechos.map((h) => ({
    nombre: h.nombre,
    cif_dni: h.doc,
    porcentaje: h.porcentaje,
    rol: h.right_type,
    rol_literal: h.right_type === "pleno" ? "pleno dominio" : h.right_type === "nuda_propiedad" ? "nuda propiedad" : "usufructo vitalicio",
    evidencia: { fuentes: [{ cita: h.cita, pagina: h.page, ruta: "titularidades" }] },
  })) as any[];

  /** Las 29 filas parciales reales: redondeadas a 2 decimales y sin rol_literal. */
  const legacy = deseados.slice(0, 29).map((d, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    nombre_extraido: d.nombre,
    cif_dni: d.cif_dni,
    porcentaje: Number(d.porcentaje.toFixed(2)),
    rol: d.rol,
    rol_literal: null,
    evidencia: null,
  }));

  it("planifica 66 derechos exactos sin bloquear por el redondeo antiguo", () => {
    const plan = buildReplacementPlan(legacy, deseados);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates.length + plan.inserts.length).toBe(66);
    expect(plan.updates.length).toBe(29);
    expect(plan.deletes.length).toBe(0);
    // Cada fila redondeada recibe el porcentaje EXACTO de la fuente.
    const conRedondeo = legacy.filter((l, i) => Math.abs(l.porcentaje - deseados[i].porcentaje) > 5e-7);
    const conPct = plan.updates.filter((u) => typeof u.patch.porcentaje === "number");
    expect(conPct.length).toBe(conRedondeo.length);
    for (const u of conPct) {
      expect(Math.abs(u.patch.porcentaje! * 100 - Math.round(u.patch.porcentaje! * 100))).toBeGreaterThan(1e-9);
    }
  });

  it("las filas huérfanas de la vieja versión se eliminan, no se dejan atrás", () => {
    const sobrante = {
      id: "00000000-0000-4000-8000-ffffffffffff",
      nombre_extraido: "TITULAR FANTASMA",
      cif_dni: null, porcentaje: 1.5, rol: "pleno", rol_literal: null, evidencia: null,
    };
    const plan = buildReplacementPlan([...legacy, sobrante], deseados);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.deletes).toEqual([sobrante.id]);
    expect(plan.updates.length + plan.inserts.length).toBe(66);
  });

  it("es idempotente: aplicado el conjunto exacto, no planifica cambios", () => {
    const yaAplicadas = deseados.map((d, i) => ({
      id: `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      nombre_extraido: d.nombre, cif_dni: d.cif_dni, porcentaje: d.porcentaje,
      rol: d.rol, rol_literal: d.rol_literal, evidencia: d.evidencia,
    }));
    const plan = buildReplacementPlan(yaAplicadas, deseados);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
    expect(plan.deletes).toEqual([]);
  });
});
