import { describe, it, expect, vi } from "vitest";
import {
  inspectPdf, looksLikePdf, detectEncrypted, fitsSingleDocument, MAX_DOC_PAGES,
} from "../../supabase/functions/notas_simples_reparse/pdf.ts";
import {
  buildDocumentMessages, buildProviders, callChat, isRetryableStatus,
  PRIMARY_MODEL, FALLBACK_MODEL, MAX_OUTPUT_TOKENS,
} from "../../supabase/functions/notas_simples_reparse/llm.ts";
import {
  decideReingest, shouldReplaceStored, fetchHubspotPdf, REINGEST_FLAG,
} from "../../supabase/functions/notas_simples_reparse/reingest.ts";
import { validarTitularesNuevos, decidirTitulares, processNotaCore } from "../../supabase/functions/notas_simples_reparse/core.ts";
import { normalizeTitularChecked, citaAnclada, citaVerificable } from "../../supabase/functions/notas_simples_reparse/lib.ts";
import { processNotaWithClaim } from "../../supabase/functions/notas_simples_reparse/handler.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const pad = (n: number) => "x".repeat(n);
const pdfBytes = (pages: number, extra = "") =>
  enc(`%PDF-1.7\n${pad(2000)}\n${Array.from({ length: pages }, (_, i) => `/Type /Page /N${i} `).join("\n")}\n${extra}`);

// ---------- 1) Validación real del binario ----------
describe("P0.7 · validación de PDF", () => {
  it("HTML disfrazado de .pdf (caso e50b9fca) => pdf_no_es_pdf", async () => {
    const i = await inspectPdf(enc("<!DOCTYPE html><html>" + pad(50000)));
    expect(i.ok).toBe(false);
    expect(i.reason).toBe("pdf_no_es_pdf");
    expect(looksLikePdf(enc("<!DOCTYPE html>"))).toBe(false);
  });

  it("vacío, truncado y cifrado tienen motivo exacto", async () => {
    expect((await inspectPdf(new Uint8Array(0))).reason).toBe("pdf_vacio");
    expect((await inspectPdf(enc("%PDF-1.4 mini"))).reason).toBe("pdf_truncado");
    const cif = await inspectPdf(enc(`%PDF-1.7\n${pad(2000)}\ntrailer <</Encrypt 5 0 R>>`));
    expect(cif.reason).toBe("pdf_cifrado");
    expect(detectEncrypted(enc(`%PDF${pad(100)} /Encrypt `))).toBe(true);
  });

  it("PDF con 0 páginas reales => pdf_sin_paginas, y con páginas => ok + hash", async () => {
    const cero = await inspectPdf(pdfBytes(3), { countPages: async () => 0 });
    expect(cero.ok).toBe(false);
    expect(cero.reason).toBe("pdf_sin_paginas");
    const bien = await inspectPdf(pdfBytes(3), { countPages: async () => 3 });
    expect(bien.ok).toBe(true);
    expect(bien.pageCount).toBe(3);
    expect(bien.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("es total: un contador que lanza no rompe la inspección", async () => {
    const i = await inspectPdf(pdfBytes(2), { countPages: async () => { throw new Error("boom"); } });
    expect(i.ok).toBe(false);
    expect(i.reason).toBe("pdf_sin_paginas");
  });

  it("tope determinista de páginas/tamaño para el envío documental", async () => {
    const grande = await inspectPdf(pdfBytes(2), { countPages: async () => MAX_DOC_PAGES + 1 });
    expect(fitsSingleDocument(grande)).toBe(false);
    const chico = await inspectPdf(pdfBytes(2), { countPages: async () => 3 });
    expect(fitsSingleDocument(chico)).toBe(true);
  });
});

// ---------- 2) LLM: bloque documento, modelos y reintentos ----------
describe("P0.7 · LLM", () => {
  it("PDF escaneado va como bloque DOCUMENTO, nunca como image_url", () => {
    const [m] = buildDocumentMessages({ base64: "QUJD", filename: "n.pdf", needTitulares: true, pageCount: 4 }) as any[];
    const tipos = m.content.map((c: any) => c.type);
    expect(tipos).toContain("file");
    expect(tipos).not.toContain("image_url");
    expect(m.content[1].file.file_data.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(m.content[0].text).toContain("4 páginas");
  });

  it("no queda ningún modelo inválido: primary/fallback son Gemini del gateway", () => {
    const ps = buildProviders("k");
    expect(ps.map((p) => p.model)).toEqual([PRIMARY_MODEL, FALLBACK_MODEL]);
    expect(JSON.stringify(ps)).not.toContain("gpt-5.6-luna");
    expect(ps.every((p) => p.url.includes("ai.gateway.lovable.dev"))).toBe(true);
    expect(buildProviders("")).toEqual([]);
  });

  it("429/5xx se reintentan; un 400 de input NO se reintenta y pasa al siguiente modelo", async () => {
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(400)).toBe(false);

    const calls: string[] = [];
    const fetchImpl = vi.fn(async (_u: string, init: any) => {
      const model = JSON.parse(init.body).model;
      calls.push(model);
      if (model === PRIMARY_MODEL) {
        return { ok: false, status: 400, text: async () => "invalid input", json: async () => ({}) };
      }
      if (calls.filter((c) => c === FALLBACK_MODEL).length === 1) {
        return { ok: false, status: 429, text: async () => "rate", json: async () => ({}) };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: '{"direccion":"X"}' } }] }) };
    });
    const r = await callChat({ providers: buildProviders("k"), messages: [], fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(r.data).toEqual({ direccion: "X" });
    expect(calls.filter((c) => c === PRIMARY_MODEL)).toHaveLength(1); // 400 sin reintento ciego
    expect(calls.filter((c) => c === FALLBACK_MODEL)).toHaveLength(2); // 429 reintentado
  });

  it("una respuesta TRUNCADA no se reintenta a ciegas: pasa al siguiente modelo", async () => {
    const calls: string[] = [];
    const fetchImpl = async (_u: string, init: any) => {
      const model = JSON.parse(init.body).model;
      calls.push(model);
      if (model === PRIMARY_MODEL) {
        return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ finish_reason: "length", message: { content: '{"titulares":[{"nombre":"A' } }] }) };
      }
      return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ finish_reason: "stop", message: { content: '{"direccion":"OK"}' } }] }) };
    };
    const r = await callChat({ providers: buildProviders("k"), messages: [], fetchImpl: fetchImpl as any, sleep: async () => {} });
    expect(r.data).toEqual({ direccion: "OK" });
    expect(calls).toEqual([PRIMARY_MODEL, FALLBACK_MODEL]);
  });

  it("el presupuesto de salida cubre una nota larga con evidencia por titular", async () => {
    let body: any = null;
    const fetchImpl = async (_u: string, init: any) => {
      body = JSON.parse(init.body);
      return { ok: true, status: 200, text: async () => "", json: async () => ({ choices: [{ message: { content: "{}" } }] }) };
    };
    await callChat({ providers: buildProviders("k"), messages: [], fetchImpl: fetchImpl as any });
    expect(body.max_tokens).toBe(MAX_OUTPUT_TOKENS);
  });
});

// ---------- 3) Reingesta única desde HubSpot ----------
describe("P0.7 · reingesta", () => {
  const malo = { ok: false, reason: "pdf_no_es_pdf", size: 47957, pageCount: null, encrypted: false, header: "<!DOCTYP", sha256: "aa" } as any;

  it("sólo reingesta binario inválido, con hs_file_id y una única vez (idempotente)", () => {
    expect(decideReingest({ inspection: malo, hsFileId: "1", structured: {} }).reingest).toBe(true);
    expect(decideReingest({ inspection: malo, hsFileId: null, structured: {} })).toEqual({ reingest: false, reason: "sin_hs_file_id" });
    expect(decideReingest({ inspection: malo, hsFileId: "1", structured: { [REINGEST_FLAG]: true } }).reingest).toBe(false);
    expect(decideReingest({ inspection: { ...malo, ok: true, reason: null }, hsFileId: "1", structured: {} }).reingest).toBe(false);
  });

  it("sustituye Storage sólo si el nuevo es PDF válido con páginas y hash distinto", () => {
    const nueva = { ok: true, reason: null, size: 710860, pageCount: 3, encrypted: false, header: "%PDF-1.3", sha256: "bb" } as any;
    expect(shouldReplaceStored({ nueva, shaAnterior: "aa" }).replace).toBe(true);
    expect(shouldReplaceStored({ nueva, shaAnterior: "bb" })).toEqual({ replace: false, reason: "hash_identico" });
    expect(shouldReplaceStored({ nueva: malo, shaAnterior: "aa" }).replace).toBe(false);
  });

  it("descarga por signed-url del connector gateway y valida el binario", async () => {
    const bin = pdfBytes(3);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("signed-url")) {
        return { ok: true, status: 200, json: async () => ({ url: "https://cdn/x.pdf" }), text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) };
      }
      return { ok: true, status: 200, json: async () => ({}), text: async () => "", arrayBuffer: async () => bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) };
    });
    const r = await fetchHubspotPdf({ hsFileId: "189890661141", lovableKey: "L", hubspotKey: "H", fetchImpl: fetchImpl as any, countPages: async () => 3 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.inspection.pageCount).toBe(3);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("connector-gateway.lovable.dev/hubspot/files/v3/files/189890661141/signed-url");
  });

  it("fallo del gateway se reporta sin lanzar", async () => {
    const fetchImpl = async () => ({ ok: false, status: 404, text: async () => "nope", json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) });
    const r = await fetchHubspotPdf({ hsFileId: "1", lovableKey: "L", hubspotKey: "H", fetchImpl: fetchImpl as any });
    expect(r.ok).toBe(false);
  });
});

// ---------- 4) Evidencia obligatoria por titular ----------
describe("P0.7 · evidencia obligatoria", () => {
  const base = {
    nombre: "PITA ROMERO, LEANDRO",
    porcentaje: 50,
    rol: "pleno",
    rol_literal: "pleno dominio",
    evidencia: { cita: "PITA ROMERO, LEANDRO titular del pleno dominio del 50%", pagina: 2 },
  };
  const norm = (raw: any) => {
    const r = normalizeTitularChecked(raw);
    if (!r.ok) throw new Error(`no normaliza: ${(r as any).reason}`);
    return r.value;
  };

  it("acepta el titular completo con cita anclada", () => {
    expect(validarTitularesNuevos([norm(base)])).toEqual({ ok: true });
    expect(citaAnclada(norm(base).evidencia)).toBeTruthy();
  });

  it("rechaza cita sin localizador y localizador sin cita", () => {
    expect(validarTitularesNuevos([norm({ ...base, evidencia: { cita: "algo" } })]))
      .toMatchObject({ reason: "titular_sin_evidencia_real" });
    expect(validarTitularesNuevos([norm({ ...base, evidencia: { pagina: 3 } })]))
      .toMatchObject({ reason: "titular_sin_evidencia_real" });
  });

  it("rechaza falta de porcentaje, de derecho específico y el régimen ganancial", () => {
    expect(validarTitularesNuevos([norm({ ...base, porcentaje: null })])).toMatchObject({ reason: "titular_sin_porcentaje" });
    expect(validarTitularesNuevos([norm({ ...base, rol: "otro", rol_literal: "adjudicatario" })]))
      .toMatchObject({ reason: "titular_sin_derecho_especifico" });
    expect(validarTitularesNuevos([norm({ ...base, rol: "ganancial", rol_literal: "para su sociedad de gananciales" })]))
      .toMatchObject({ reason: "titular_regimen_sin_derecho" });
  });

  it("la cita debe existir en el texto fuente cuando hay texto", () => {
    const texto = "Finca 123. PITA ROMERO, LEANDRO titular del pleno dominio del 50% por título de compra.";
    expect(validarTitularesNuevos([norm(base)], { textoFuente: texto })).toEqual({ ok: true });
    expect(validarTitularesNuevos([norm({ ...base, evidencia: { cita: "texto inventado que no está", pagina: 1 } })], { textoFuente: texto }))
      .toMatchObject({ reason: "titular_cita_no_verificable" });
    // Escaneado sin capa de texto: no se puede desmentir, no se bloquea por esto.
    expect(citaVerificable("", "lo que sea")).toBe(true);
  });

  it("tolera cortes de página dentro de la cita pero no el texto inventado", () => {
    const real = "PITA ROMERO, LUCIANO NC 342 342 141 1 Pag. 2 de 12 C.S.V.: 2281082823910611 PARTICIPACION: 6,250000% de la nuda propiedad con caracter privativo.";
    const citaLegitima = "PITA ROMERO, LUCIANO NC 342 342 141 1 PARTICIPACION: 6,250000% de la nuda propiedad con caracter privativo";
    expect(citaVerificable(real, citaLegitima)).toBe(true);
    expect(citaVerificable(real, "MARIA LOPEZ ostenta el pleno dominio del 100% por herencia de su padre")).toBe(false);
  });

  it("pleno / nuda / usufructo del mismo titular son filas separadas y todas válidas", () => {
    const filas = [
      norm({ ...base, rol: "nuda_propiedad", rol_literal: "nuda propiedad", porcentaje: 50, evidencia: { cita: "nuda propiedad del 50%", pagina: 2 } }),
      norm({ ...base, rol: "usufructo", rol_literal: "usufructo vitalicio", porcentaje: 50, evidencia: { cita: "usufructo vitalicio del 50%", pagina: 2 } }),
    ];
    expect(validarTitularesNuevos(filas)).toEqual({ ok: true });
    expect(new Set(filas.map((f) => f.rol)).size).toBe(2);
  });

  it("sin evidencia el refetch falla y la nota NO se finaliza (caso 71c01af3)", () => {
    const d = decidirTitulares({
      needsRefetch: true,
      extraidos: [{ nombre: "PITA ROMERO, LEANDRO", porcentaje: 50, rol: "pleno", rol_literal: "pleno dominio" }],
      actuales: [],
    });
    expect(d.ok).toBe(false);
    expect((d as { reason?: string }).reason).toBe("titular_sin_evidencia_real");
  });

  it("documento sin titulares (caso d52b59d8) no inventa cuota", () => {
    const d = decidirTitulares({ needsRefetch: true, extraidos: [], actuales: [] });
    expect(d.ok).toBe(false);
    expect((d as { reason?: string }).reason).toBe("titulares_refetch_vacio");
  });
});

// ---------- 5) P0.6 sin regresión + dead-letter sin bucle ----------
describe("P0.7 · P0.6 intacto", () => {
  it("un fallo FATAL de binario hace dead-letter inmediato por RPC CAS con el token", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const sb = { rpc } as any;
    const r: any = await processNotaWithClaim(sb, { id: "n1", claim_token: "tok", attempt_count: 0 }, async () => ({
      id: "n1", ok: false, fatal: true, reason: "invalid_pdf_no_pages:pdf_no_es_pdf",
    }) as any);
    expect(r.dead_letter).toBe(true);
    expect(rpc).toHaveBeenCalledWith("reparse_fail_nota", expect.objectContaining({ p_expected_token: "tok", p_dead: true, p_next_retry_at: null }));
  });

  it("sin claim_token no se procesa ni se escribe nada", async () => {
    const processOne = vi.fn();
    const r: any = await processNotaWithClaim({ rpc: vi.fn() } as any, { id: "n2" }, processOne as any);
    expect(r).toMatchObject({ ok: false, reason: "claim_token_ausente" });
    expect(processOne).not.toHaveBeenCalled();
  });

  it("el core sigue exigiendo la transacción claim-scoped y no finaliza si falla", async () => {
    const applyPlan = vi.fn(async () => ({ ok: false, updated: 0, inserted: 0, finalized: false, error: "claim_lost" }));
    const res = await processNotaCore(
      {
        repo: {
          listTitulares: async () => ({ rows: [], error: null }),
          updateTitular: async () => ({ rows: 0, error: "direct_child_write_forbidden" }),
          insertTitular: async () => ({ rows: 0, error: "direct_child_write_forbidden" }),
          finalizeNota: async () => ({ rows: 0, error: "direct_finalize_forbidden" }),
          applyPlan,
        } as any,
        extract: async () => ({
          data: {
            titulares: [{
              nombre: "A B", porcentaje: 100, rol: "pleno", rol_literal: "pleno dominio",
              evidencia: { cita: "A B pleno dominio 100%", pagina: 1 },
            }],
          },
          model: "lovable/google/gemini-3.6-flash",
        }),
      },
      { notaId: "n3", claimToken: "tok", structured: {}, textoFuente: "A B pleno dominio 100%" },
    );
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("claim_lost");
    expect(res.finalized).toBe(false);
    expect(applyPlan).toHaveBeenCalledWith(expect.objectContaining({ claimToken: "tok" }));
  });
});
