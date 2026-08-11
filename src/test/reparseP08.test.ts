import { describe, it, expect } from "vitest";
import {
  extraerInventario, reconciliarCompletitud, hechoKey, contarCapas, esDocumentoNoRegistral,
} from "../../supabase/functions/notas_simples_reparse/completeness.ts";
import {
  parsePorcentajeFuente, candidatosPorcentaje, porcentajeCanonico, redondearExacto,
} from "../../supabase/functions/notas_simples_reparse/porcentaje.ts";
import { canonizarPorcentajes, processNotaCore } from "../../supabase/functions/notas_simples_reparse/core.ts";
import { decidirAuth, timingSafeEqual, redactar } from "../../supabase/functions/notas_simples_reparse/auth.ts";
import { parseIdsStrict, handleReparseRequest } from "../../supabase/functions/notas_simples_reparse/handler.ts";
import { backupVerificado } from "../../supabase/functions/notas_simples_reparse/backup.ts";
import { normalizePorcentaje } from "../../supabase/functions/notas_simples_reparse/lib.ts";

// ---------------------------------------------------------------------------
// Fixture: corpus equivalente al canario real (66 participaciones registrales
// con porcentaje: 38 pleno, 20 nuda propiedad, 8 usufructo) + 2 CARGAS que
// también dicen PARTICIPACION y NO son titulares.
// ---------------------------------------------------------------------------
type Hecho = { nombre: string; dni: string; pct: string; derecho: string; page: number };

const DERECHOS = [
  ...Array.from({ length: 38 }, () => "del pleno dominio"),
  ...Array.from({ length: 20 }, () => "de la nuda propiedad"),
  ...Array.from({ length: 8 }, () => "del usufructo"),
];
const PCTS = ["0,109649", "1,041667", "6,25", "12,5", "3,333333"];

const HECHOS: Hecho[] = DERECHOS.map((derecho, i) => ({
  nombre: `TITULAR NUMERO ${String(i + 1).padStart(3, "0")} DE PRUEBA`,
  dni: `${String(10000000 + i)}A`,
  pct: PCTS[i % PCTS.length],
  derecho,
  page: 1 + Math.floor(i / 6),
}));

function linea(h: Hecho): string {
  return `TITULAR: ${h.nombre} con DNI ${h.dni} PARTICIPACION: ${h.pct}% ${h.derecho}.`;
}

function corpus(hechos: Hecho[] = HECHOS): string {
  const out: string[] = [
    "NOTA SIMPLE INFORMATIVA",
    "REGISTRO DE LA PROPIEDAD DE MADRID NUMERO CINCO",
    "IDUFIR 28001000123456",
  ];
  let page = 0;
  for (const h of hechos) {
    if (h.page !== page) {
      page = h.page;
      out.push(`Pág. ${page}`);
      out.push("TITULARIDADES");
    }
    out.push(linea(h));
  }
  out.push("Pág. 12");
  out.push("CARGAS");
  out.push("HIPOTECA a favor de BANCO EJEMPLO SA PARTICIPACION: 100% del pleno dominio en garantia.");
  out.push("AFECCION fiscal PARTICIPACION: 50% del pleno dominio durante cinco anyos.");
  return out.join("\n");
}

const ROL: Record<string, string> = {
  "del pleno dominio": "pleno",
  "de la nuda propiedad": "nuda_propiedad",
  "del usufructo": "usufructo",
};

/** Titular tal y como lo devuelve el LLM: con el porcentaje REDONDEADO. */
function titularLlm(h: Hecho, opts?: { redondear?: boolean }) {
  const exacto = Number(h.pct.replace(",", "."));
  return {
    nombre: h.nombre,
    cif_dni: h.dni,
    porcentaje: opts?.redondear === false ? exacto : Math.round(exacto * 100) / 100,
    rol: ROL[h.derecho],
    rol_literal: h.derecho,
    evidencia: { fuentes: [{ cita: linea(h), pagina: h.page }] },
  };
}

// ---------- 1) Inventario determinista ----------
describe("P0.8 · inventario de hechos registrales", () => {
  it("extrae 66 titularidades y excluye las 2 cargas", () => {
    const inv = extraerInventario(corpus());
    expect(inv.documento).toBe("NOTA_SIMPLE");
    expect(inv.hechos.length).toBe(66);
    expect(inv.cargas).toBe(2);
    expect(inv.ambiguos).toEqual([]);
    expect(contarCapas(inv.hechos)).toEqual({ pleno: 38, nuda_propiedad: 20, usufructo: 8 });
  });

  it("cada hecho lleva identidad, derecho, porcentaje literal y localizador", () => {
    const inv = extraerInventario(corpus());
    for (const h of inv.hechos) {
      expect(h.nombre.length).toBeGreaterThan(3);
      expect(["pleno", "nuda_propiedad", "usufructo"]).toContain(h.right_type);
      expect(h.porcentaje).toBeGreaterThan(0);
      expect(h.porcentaje_literal).toMatch(/\d/);
      expect(h.page).toBeGreaterThan(0);
      expect(h.range[1]).toBeGreaterThan(h.range[0]);
      expect(h.cita).toContain("PARTICIPACION");
      expect(h.seccion).toBe("titularidad");
    }
    // No se pierde precisión en el inventario.
    expect(inv.hechos[0].porcentaje).toBe(0.109649);
    expect(inv.hechos[1].porcentaje).toBe(1.041667);
  });

  it("participación con dos porcentajes o sin derecho es ambigua y bloquea", () => {
    const txt = [
      "NOTA SIMPLE INFORMATIVA", "Pág. 1", "TITULARIDADES",
      "TITULAR: ANA LOPEZ PARTICIPACION: 50% y 25% del pleno dominio.",
      "TITULAR: LUIS PEREZ PARTICIPACION: 10% de la finca.",
    ].join("\n");
    const inv = extraerInventario(txt);
    expect(inv.hechos.length).toBe(0);
    expect(inv.ambiguos.map((a) => a.motivo)).toEqual([
      "participacion_con_varios_porcentajes",
      "participacion_sin_derecho",
    ]);
  });

  it("un documento que no es nota simple => NON_REGISTRY_DOCUMENT", () => {
    expect(esDocumentoNoRegistral("<html><body>error 404 de HubSpot</body></html>")).toBe(true);
    expect(esDocumentoNoRegistral(corpus())).toBe(false);
  });
});

// ---------- 2) Completitud fail-closed ----------
describe("P0.8 · reconciliación 1:1", () => {
  const inv = extraerInventario(corpus());
  const todos = HECHOS.map((h) => ({
    nombre: h.nombre,
    rol: ROL[h.derecho],
    porcentaje: Number(h.pct.replace(",", ".")),
  }));

  it("66/66 con capas exactas => ok", () => {
    const c = reconciliarCompletitud({ inventario: inv, materializados: todos });
    expect(c.ok).toBe(true);
    expect(c.expected).toBe(66);
    expect(c.materialized).toBe(66);
    expect(c.capas_materializadas).toEqual({ pleno: 38, nuda_propiedad: 20, usufructo: 8 });
    expect(c.cargas_excluidas).toBe(2);
  });

  it("el caso real 29/66 => NO ok, motivo con el déficit", () => {
    const c = reconciliarCompletitud({ inventario: inv, materializados: todos.slice(0, 29) });
    expect(c.ok).toBe(false);
    expect(c.expected).toBe(66);
    expect(c.materialized).toBe(29);
    expect(c.motivo).toBe("completeness_incompleta:faltan_37");
  });

  it("filas extra o duplicadas también bloquean", () => {
    const extra = reconciliarCompletitud({
      inventario: inv,
      materializados: [...todos, { nombre: "FANTASMA", rol: "pleno", porcentaje: 1 }],
    });
    expect(extra.ok).toBe(false);
    expect(extra.motivo).toMatch(/filas_extra/);

    const dup = reconciliarCompletitud({ inventario: inv, materializados: [...todos, todos[0]] });
    expect(dup.ok).toBe(false);
  });

  it("un porcentaje redondeado rompe la clave 1:1 (no se cuela)", () => {
    const roto = todos.map((t, i) => (i === 0 ? { ...t, porcentaje: 0.11 } : t));
    const c = reconciliarCompletitud({ inventario: inv, materializados: roto });
    expect(c.ok).toBe(false);
    expect(hechoKey({ nombre: todos[0].nombre, rol: "pleno", porcentaje: 0.109649 }))
      .not.toBe(hechoKey({ nombre: todos[0].nombre, rol: "pleno", porcentaje: 0.11 }));
  });
});

// ---------- 3) Porcentaje exacto ----------
describe("P0.8 · precisión exacta", () => {
  it("fracciones exactas: 1/2 = 50, nunca 12", () => {
    expect(parsePorcentajeFuente("1/2")!.valor).toBe(50);
    expect(parsePorcentajeFuente("1/3")!.valor).toBe(33.333333);
    expect(parsePorcentajeFuente("1/2")!.forma).toBe("fraccion");
    expect(parsePorcentajeFuente("0/5")).toBeNull();
    expect(parsePorcentajeFuente("3/2")).toBeNull(); // 150% fuera de rango
  });

  it("normalizePorcentaje conserva 6 decimales (ya no round(2))", () => {
    expect(normalizePorcentaje("0,109649")).toBe(0.109649);
    expect(normalizePorcentaje("1,041667")).toBe(1.041667);
    expect(redondearExacto(1.0416665)).toBe(1.041667);
  });

  it("gana la fuente sobre el redondeo del LLM y ambos quedan en diagnóstico", () => {
    const cita = linea(HECHOS[0]);
    const p = porcentajeCanonico({ cita, porcentajeLlm: 0.11 });
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.fuente.valor).toBe(0.109649);
      expect(p.llm).toBe(0.11);
      expect(p.discrepancia).toBe(true);
    }
  });

  it("dos porcentajes en la misma cita sin localizador => bloquea", () => {
    const p = porcentajeCanonico({ cita: "PARTICIPACION: 50% y 25% del pleno dominio", porcentajeLlm: 50 });
    expect(p.ok).toBe(false);
    expect((p as any).reason).toBe("porcentaje_ambiguo");
    expect(candidatosPorcentaje("50% y 25%").length).toBe(2);
  });

  it("canonizarPorcentajes exige nombre + derecho + % en LA MISMA cita", () => {
    const inv = extraerInventario(corpus());
    const ok = canonizarPorcentajes(
      HECHOS.slice(0, 3).map((h) => ({
        nombre: h.nombre, cif_dni: h.dni, porcentaje: 0.11,
        rol: ROL[h.derecho] as any, rol_literal: h.derecho, rol_diagnostico: null,
        evidencia: { fuentes: [{ cita: linea(h), pagina: h.page }] },
      })) as any,
      { inventario: inv },
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value[0].porcentaje).toBe(0.109649);
      expect(ok.value[0].porcentaje_diagnostico).toMatchObject({ llm: 0.11, fuente: 0.109649 });
    }

    // Nombre y derecho en citas distintas => no está probado en la misma cita.
    const roto = canonizarPorcentajes([{
      nombre: HECHOS[0].nombre, cif_dni: null, porcentaje: 50, rol: "pleno" as any,
      rol_literal: "pleno dominio", rol_diagnostico: null,
      evidencia: { fuentes: [{ cita: "PARTICIPACION: 50% del pleno dominio.", pagina: 1 }] },
    }] as any, {});
    expect(roto.ok).toBe(false);
    expect((roto as any).reason).toBe("cita_sin_identidad");

    const derechoMal = canonizarPorcentajes([{
      nombre: HECHOS[0].nombre, cif_dni: null, porcentaje: 0.11, rol: "usufructo" as any,
      rol_literal: "usufructo", rol_diagnostico: null,
      evidencia: { fuentes: [{ cita: linea(HECHOS[0]), pagina: 1 }] },
    }] as any, {});
    expect(derechoMal.ok).toBe(false);
    expect((derechoMal as any).reason).toBe("cita_derecho_discrepante");
  });
});

// ---------- 4) processNotaCore extremo a extremo ----------
function repoFake(applied: { calls: any[] }) {
  return {
    listTitulares: async () => ({ rows: [], error: null }),
    updateTitular: async () => ({ rows: 0, error: "prohibido" }),
    insertTitular: async () => ({ rows: 0, error: "prohibido" }),
    finalizeNota: async () => ({ rows: 0, error: "prohibido" }),
    applyPlan: async (args: any) => {
      applied.calls.push(args);
      return { ok: true, updated: 0, inserted: args.inserts.length, finalized: true, error: null };
    },
  } as any;
}

describe("P0.8 · núcleo con completitud", () => {
  it("66/66 finaliza y persiste porcentajes exactos", async () => {
    const applied = { calls: [] as any[] };
    const r = await processNotaCore(
      {
        repo: repoFake(applied),
        extract: async () => ({ data: { titulares: HECHOS.map((h) => titularLlm(h)) } as any, model: "test" }),
      },
      { notaId: "n1", claimToken: "c1", structured: {}, textoFuente: corpus() },
    );
    expect(r.ok).toBe(true);
    expect(r.finalized).toBe(true);
    expect(r.completeness?.ok).toBe(true);
    expect(r.completeness?.expected).toBe(66);
    expect(applied.calls[0].completeness.ok).toBe(true);
    expect(applied.calls[0].inserts.length).toBe(66);
    expect(applied.calls[0].inserts[0].porcentaje).toBe(0.109649);
  });

  it("29 de 66 => NO finaliza, sin escribir, con JSON de completitud", async () => {
    const applied = { calls: [] as any[] };
    const r = await processNotaCore(
      {
        repo: repoFake(applied),
        extract: async () => ({ data: { titulares: HECHOS.slice(0, 29).map((h) => titularLlm(h)) } as any, model: "test" }),
      },
      { notaId: "n1", claimToken: "c1", structured: {}, textoFuente: corpus() },
    );
    expect(r.ok).toBe(false);
    expect(r.finalized).toBe(false);
    expect(applied.calls.length).toBe(0);
    expect(r.completeness?.expected).toBe(66);
    expect(r.completeness?.materialized).toBe(29);
    expect(r.reason).toMatch(/completeness_incompleta/);
  });

  it("documento no registral => 0 titulares, fatal, sin LLM", async () => {
    const applied = { calls: [] as any[] };
    let llamado = false;
    const r = await processNotaCore(
      {
        repo: repoFake(applied),
        extract: async () => { llamado = true; return { data: null, error: "no debería" } as any; },
      },
      { notaId: "n1", claimToken: "c1", structured: {}, textoFuente: "<html>404 not found</html>" },
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("NON_REGISTRY_DOCUMENT");
    expect((r as any).fatal).toBe(true);
    expect(llamado).toBe(false);
    expect(applied.calls.length).toBe(0);
  });
});

// ---------- 5) Endpoint: auth, ids y límites ----------
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/reparse", { method: "POST", headers, body: JSON.stringify(body) });

describe("P0.8 · endpoint fail-closed", () => {
  const SECRET = "s3creto-interno-de-pruebas-1234567890";

  it("sin credencial => 401; credencial inválida => 401", async () => {
    const r1 = await handleReparseRequest(req({}), {}, async () => ({ id: "x", ok: true }), { internalSecret: SECRET });
    expect(r1.status).toBe(401);
    const r2 = await handleReparseRequest(
      req({}, { "x-internal-secret": "mal" }), {}, async () => ({ id: "x", ok: true }), { internalSecret: SECRET },
    );
    expect(r2.status).toBe(401);
  });

  it("JWT con rol no autorizado => 403; service_role => pasa la puerta", async () => {
    const viewer = await decidirAuth({
      headers: { authorization: "Bearer token.jwt.viewer" },
      verifyJwt: () => ({ ok: true, role: "viewer" }),
    });
    expect(viewer).toMatchObject({ ok: false, status: 403 });
    const svc = await decidirAuth({
      headers: { authorization: "Bearer token.jwt.svc" },
      verifyJwt: () => ({ ok: true, role: "service_role" }),
    });
    expect(svc).toMatchObject({ ok: true, principal: "service", via: "jwt" });
  });

  it("sin auth configurada el endpoint NO queda abierto (503)", async () => {
    const d = await decidirAuth({ headers: { authorization: "Bearer lo-que-sea" } });
    expect(d).toMatchObject({ ok: false, status: 503 });
  });

  it("ids inválidos fallan cerrado y jamás caen al lote general", async () => {
    expect(parseIdsStrict(["no-uuid"])).toMatchObject({ ok: false, reason: "id_invalido" });
    expect(parseIdsStrict(["11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"]))
      .toMatchObject({ ok: false, reason: "id_duplicado" });
    expect(parseIdsStrict([])).toMatchObject({ ok: true, ids: [] });

    const r = await handleReparseRequest(
      req({ ids: ["no-uuid"] }, { "x-internal-secret": SECRET }), {},
      async () => ({ id: "x", ok: true }), { internalSecret: SECRET },
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error_message).toMatch(/id_invalido/);
  });

  it("comparación en tiempo constante y redacción de secretos", () => {
    expect(timingSafeEqual(SECRET, SECRET)).toBe(true);
    expect(timingSafeEqual("", "")).toBe(false);
    expect(redactar("Authorization: Bearer eyJabcdefghijklmno"))
      .not.toMatch(/eyJabcdefghijklmno/);
  });
});

// ---------- 6) Backup verificado antes del overwrite ----------
describe("P0.8 · backup verificado", () => {
  const bytes = new TextEncoder().encode("%PDF-1.7 contenido original");

  it("verifica bytes y sha256 releídos del destino", async () => {
    const store = new Map<string, Uint8Array>();
    const r = await backupVerificado({
      upload: async (p, b) => { store.set(p, b); return {}; },
      download: async (p) => store.get(p) ?? null,
    }, { fileUrl: "nota.pdf", bytes, now: 1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.size).toBe(bytes.length);
  });

  it("si el backup no verifica, el resultado es fallo (no se sobrescribe)", async () => {
    const corrupto = await backupVerificado({
      upload: async () => ({}),
      download: async () => new TextEncoder().encode("otra cosa distinta aqui"),
    }, { fileUrl: "nota.pdf", bytes, now: 1 });
    expect(corrupto.ok).toBe(false);

    const sinSubida = await backupVerificado({
      upload: async () => ({ error: { message: "quota" } }),
      download: async () => bytes,
    }, { fileUrl: "nota.pdf", bytes, now: 1 });
    expect(sinSubida).toMatchObject({ ok: false });
    expect((sinSubida as any).reason).toMatch(/upload_fail/);

    const vacio = await backupVerificado({
      upload: async () => ({}),
      download: async () => null,
    }, { fileUrl: "nota.pdf", bytes, now: 1 });
    expect(vacio).toMatchObject({ ok: false, reason: "readback_vacio" });
  });
});
