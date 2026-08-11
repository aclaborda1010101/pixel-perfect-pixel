// notas_simples_reparse — releer PDFs de notas_simples huérfanas (building_id NULL)
// y extraer direccion + ref_catastral + finca + titulares (si faltaban).
// El emparejado a edificio lo hace public.match_notas_pendientes() en la BD.
//
// Selección:
//   status='listo' AND
//   coalesce(structured_json->>'reparse_done','') <> '1' AND
//   ( building_id IS NULL OR structured_json->>'needs_extract' = '1' )
// (para reprocesar tanto huérfanas como notas recién ingestadas con
//  needs_extract='1' aunque tengan building_id).
// Lote: 12 por invocación. Cron cada 5 min (notas_simples_reparse_5m).
//
// Pipeline por nota:
//   1) Descargar PDF del bucket 'notas-simples' (service role).
//   2) Extraer texto con unpdf; si <200 chars, mandar PDF inline al modelo de visión.
//   3) LLM (openai/gpt-5.6-luna vía OpenRouter, fallback google/gemini-3-flash-preview,
//      response_format json_object) → { direccion, ref_catastral, finca_numero,
//      registro, titulares? }.
//   4) Merge en structured_json, marcar reparse_done='1'. Insertar titulares nuevos
//      en nota_simple_titulares si el array actual está vacío.
//   5) Al final del lote: SELECT public.match_notas_pendientes(); + log en
//      hubspot_sync_log.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import {
  sanitize,
  sanitizeDeep,
  type TitularNormalizado,
} from "./lib.ts";
import {
  type OpResult,
} from "./reconcile.ts";
import {
  processNotaCore,
  runMatching,
  type NotaRepo,
} from "./core.ts";
import { handleReparseRequest, processNotaWithClaim as processNotaWithClaimCore } from "./handler.ts";
import { buildProviders, buildDocumentMessages, callChat, REGLAS_EVIDENCIA } from "./llm.ts";
import { inspectPdf, fitsSingleDocument, type PdfInspection } from "./pdf.ts";
import { decideReingest, shouldReplaceStored, fetchHubspotPdf, REINGEST_FLAG } from "./reingest.ts";
import { backupVerificado } from "./backup.ts";

// ---------- utilidades de texto ----------

const UNITS: Record<string, number> = {
  cero: 0, uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, dieciseis: 16, dieciséis: 16,
  diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20,
  veintiuno: 21, veintiún: 21, veintiuna: 21, veintidos: 22, veintidós: 22,
  veintitres: 23, veintitrés: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintiséis: 26, veintisiete: 27, veintiocho: 28,
  veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100,
  doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
  mil: 1000,
};

function wordsToNumber(tokens: string[]): number | null {
  // suma con "y": treinta y tres → 33; ciento veinte → 120; dos mil → 2000
  let total = 0;
  let current = 0;
  let sawAny = false;
  for (const raw of tokens) {
    const t = raw.toLowerCase();
    if (t === "y") continue;
    if (!(t in UNITS)) return sawAny ? total + current : null;
    const v = UNITS[t];
    sawAny = true;
    if (v === 1000) {
      current = (current || 1) * 1000;
      total += current;
      current = 0;
    } else if (v === 100) {
      current = (current || 1) * 100;
    } else {
      current += v;
    }
  }
  return sawAny ? total + current : null;
}

function letrasANumerosEnTexto(txt: string): string {
  // Reemplaza "NUMERO TREINTA Y TRES" → "NUMERO 33", "Nº VEINTIUNO" → "Nº 21".
  const re = /\b(n[ºo°\.]?\s*|numero\s*|número\s*)((?:[a-záéíóúñü]+(?:\s+y\s+)?){1,4})\b/gi;
  return txt.replace(re, (_m, pre, palabras) => {
    const toks = palabras.trim().split(/\s+/);
    const n = wordsToNumber(toks);
    return n != null ? `${pre}${n}` : _m;
  });
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

// ---------- LLM ----------

type ExtractedFields = {
  direccion?: string | null;
  ref_catastral?: string | null;
  finca_numero?: string | null;
  registro?: string | null;
  titulares?: Array<{
    nombre: string;
    cif_dni?: string | null;
    porcentaje?: number | null;
    rol?: string | null;
    rol_literal?: string | null;
    evidencia?: { cita?: string | null; pagina?: number | null; ruta?: string | null } | null;
  }>;
};

function buildTextPrompt(rawText: string, needTitulares: boolean): string {
  return `Analiza esta NOTA SIMPLE del Registro de la Propiedad español y devuelve JSON EXACTO con estos campos (omite el campo si no lo encuentras):

{
  "direccion": "calle + número + municipio de la FINCA descrita (no del titular). Convierte números escritos en letra a cifra: 'CALLE X NUMERO TREINTA Y TRES' → 'CALLE X 33'",
  "ref_catastral": "referencia catastral de 20 caracteres si aparece",
  "finca_numero": "número registral de la finca",
  "registro": "Registro de la Propiedad emisor"${needTitulares ? `,
  "titulares": [
    {
      "nombre": "…",
      "cif_dni": "…",
      "porcentaje": 0-100,
      "rol": "pleno" | "usufructo" | "nuda_propiedad" | "ganancial" | "otro",
      "rol_literal": "texto literal del derecho tal y como aparece en la nota",
      "evidencia": { "cita": "fragmento literal donde consta", "pagina": 1, "ruta": "sección/apartado" }
    }
  ]` : ""}
}

REGLAS:
- Sólo la dirección de la FINCA (parte "URBANA…" / "DESCRIPCIÓN"), NUNCA la dirección del titular.
- Los porcentajes en 0-100 (no en fracción). Si es 50%, devuelve 50.
- "rol" debe ser uno de: pleno, usufructo, nuda_propiedad, ganancial, otro. Si el derecho no encaja con claridad en los cuatro primeros, usa "otro" (NUNCA "pleno" por defecto).
- ${REGLAS_EVIDENCIA}
- Si un dato no aparece con claridad, OMÍTELO (no inventes).

TEXTO:
"""
${rawText.slice(0, 60000)}
"""`;
}

async function callLLM(messages: any[]): Promise<{ data: ExtractedFields | null; error?: string; model?: string }> {
  const providers = buildProviders(Deno.env.get("LOVABLE_API_KEY"));
  const r = await callChat({
    providers,
    messages,
    fetchImpl: fetch as any,
    parse: (txt) => sanitizeDeep(JSON.parse(txt)),
  });
  if (!r.data) console.error(`[notas_reparse] LLM fail: ${r.error}`);
  return r as { data: ExtractedFields | null; error?: string; model?: string };
}

/** Contador REAL de páginas (unpdf). Nunca lanza hacia fuera. */
async function contarPaginas(bytes: Uint8Array): Promise<number | null> {
  try {
    const doc: any = await getDocumentProxy(bytes);
    const n = Number(doc?.numPages ?? 0);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

// ---------- procesamiento por nota ----------

async function processOne(sb: any, nota: any, claimToken: string): Promise<{ id: string; ok: boolean; reason?: string; ref_catastral?: string | null; direccion?: string | null; titulares_insertados?: number; titulares_actualizados?: number; attempt_count?: number; dead_letter?: boolean }> {
  const id = nota.id as string;
  try {
    // 1) Descargar PDF
    if (!nota.file_url) return { id, ok: false, reason: "no_file_url" };
    const { data: blob, error: dlErr } = await sb.storage.from("notas-simples").download(nota.file_url);
    if (dlErr || !blob) return { id, ok: false, reason: `download_fail:${dlErr?.message ?? "empty"}` };
    let bytes = new Uint8Array(await blob.arrayBuffer());

    // 1.b) VALIDACIÓN REAL DEL BINARIO antes de gastar un LLM.
    let insp: PdfInspection = await inspectPdf(bytes, { countPages: contarPaginas });
    let pdfOrigen = "storage";
    const prevStructured = (nota.structured_json && typeof nota.structured_json === "object") ? nota.structured_json : {};
    const reingest = decideReingest({
      inspection: insp,
      hsFileId: prevStructured.hs_file_id ?? null,
      structured: prevStructured,
    });
    if (reingest.reingest) {
      const lovableKey = Deno.env.get("LOVABLE_API_KEY") ?? "";
      const hubspotKey = Deno.env.get("HUBSPOT_API_KEY") ?? "";
      const bajada = await fetchHubspotPdf({
        hsFileId: String(prevStructured.hs_file_id),
        lovableKey, hubspotKey,
        fetchImpl: fetch as any,
        countPages: contarPaginas,
      });
      let detalle = bajada.ok ? "descargado" : bajada.reason;
      let logError: string | null = bajada.ok ? null : `reingest_fetch_fail:${bajada.reason}`;
      if (bajada.ok) {
        const decision = shouldReplaceStored({ nueva: bajada.inspection, shaAnterior: insp.sha256 });
        detalle = `${detalle}|${decision.reason}`;
        if (decision.replace) {
          // BACKUP VERIFICADO (bytes + sha256 releídos) ANTES del overwrite.
          // Si el backup falla, NO se sobrescribe el original.
          const bk = await backupVerificado({
            upload: (path, b) => sb.storage.from("notas-simples")
              .upload(path, b, { contentType: "application/octet-stream", upsert: false }),
            download: async (path) => {
              const { data } = await sb.storage.from("notas-simples").download(path);
              return data ? new Uint8Array(await data.arrayBuffer()) : null;
            },
          }, { fileUrl: nota.file_url, bytes });
          detalle = `${detalle}|backup:${bk.ok ? "ok" : bk.reason}`;
          if (!bk.ok) {
            logError = `backup_fail:${bk.reason}`;
          } else {
            const up = await sb.storage.from("notas-simples")
              .upload(nota.file_url, bajada.bytes, { contentType: "application/pdf", upsert: true });
            detalle = `${detalle}|upload:${up?.error?.message ?? "ok"}`;
            if (up?.error) {
              logError = `overwrite_fail:${up.error.message}`;
            } else {
              bytes = bajada.bytes;
              insp = bajada.inspection;
              pdfOrigen = "hubspot_reingest";
            }
          }
        }
      }
      // Log con las columnas REALES de hubspot_sync_log (entity, no tipo).
      const logRes = await sb.from("hubspot_sync_log").insert({
        entity: "notas_simples_reparse_reingest",
        status: bajada.ok && insp.ok && !logError ? "ok" : "error",
        error_message: logError ? String(logError).slice(0, 500) : null,
        metadatos: {
          nota_id: id,
          hs_file_id: prevStructured.hs_file_id ?? null,
          motivo: reingest.reason,
          detalle: String(detalle).slice(0, 300),
          sha_anterior: insp.sha256,
          pdf_valido: insp.ok,
        },
      });
      // Un fallo de log NO puede producir un falso éxito.
      if (logRes?.error) {
        return { id, ok: false, reason: `sync_log_fail:${String(logRes.error.message ?? "").slice(0, 200)}` };
      }
      if (logError) {
        return { id, ok: false, reason: logError.slice(0, 300) };
      }
    }
    if (!insp.ok) {
      // Irrecuperable tras la reingesta única: dead-letter trazable, sin bucle.
      return {
        id, ok: false, fatal: true,
        reason: `invalid_pdf_no_pages:${insp.reason}:size=${insp.size}:pages=${insp.pageCount ?? 0}:sha=${(insp.sha256 ?? "").slice(0, 16)}`,
      } as any;
    }

    // 2) Texto con unpdf
    let rawText = "";
    try {
      const ext = await extractText(bytes, { mergePages: true });
      rawText = (typeof ext.text === "string" ? ext.text : (ext.text as string[]).join("\n")).trim();
    } catch (e) {
      console.warn(`[notas_reparse] unpdf ${id}`, (e as Error).message);
    }
    if (rawText) rawText = sanitize(letrasANumerosEnTexto(rawText));

    // 3) Repositorio Supabase (CAS id+claimToken, RETURNING exactamente 1 fila)
    let refCatastralFinal: string | null = null;
    let direccionFinal: string | null = null;

    const repo: NotaRepo = {
      async listTitulares(notaId) {
        const { data, error } = await sb.from("nota_simple_titulares")
          .select("id, nombre_extraido, cif_dni, porcentaje, rol, rol_literal, evidencia")
          .eq("nota_simple_id", notaId);
        return { rows: (data ?? []) as any[], error: error?.message ?? null };
      },
      // Escrituras hijas DIRECTAS prohibidas: todo va por la RPC transaccional.
      async updateTitular(): Promise<OpResult> {
        return { rows: 0, error: "direct_child_write_forbidden" };
      },
      async insertTitular(): Promise<OpResult> {
        return { rows: 0, error: "direct_child_write_forbidden" };
      },
      async finalizeNota(): Promise<OpResult> {
        return { rows: 0, error: "direct_finalize_forbidden" };
      },
      /** Una sola transacción de servidor: bloqueo por claim, hijos y finalize. */
      async applyPlan({ notaId, claimToken: token, updates, inserts, titulares, extracted, model, completeness }) {
        const ex = extracted as ExtractedFields;
        const prev = (nota.structured_json && typeof nota.structured_json === "object") ? nota.structured_json : {};
        const merged: any = { ...prev, reparse_done: "1" };
        if ("needs_extract" in merged) delete merged.needs_extract;
        if (ex.direccion) merged.direccion = String(ex.direccion).trim();
        if (ex.ref_catastral && !prev.ref_catastral) merged.ref_catastral = String(ex.ref_catastral).replace(/\s+/g, "").toUpperCase();
        const finca = { ...(prev.finca ?? {}) };
        if (ex.finca_numero && !finca.numero) finca.numero = String(ex.finca_numero).trim();
        if (ex.registro && !finca.registro) finca.registro = String(ex.registro).trim();
        if (ex.ref_catastral && !finca.ref_catastral) finca.ref_catastral = merged.ref_catastral;
        if (Object.keys(finca).length) merged.finca = finca;
        merged.titulares = titulares as TitularNormalizado[];
        merged.reparse_model = model;
        merged.reparse_schema_version = 2;
        // Sin completitud ok=true la RPC aborta: nunca hay reparse_done falso.
        merged.completeness = completeness ?? null;
        merged[REINGEST_FLAG] = pdfOrigen === "hubspot_reingest" ? true : (prev[REINGEST_FLAG] ?? false);
        merged.pdf_meta = {
          origen: pdfOrigen,
          size: insp.size,
          pages: insp.pageCount,
          sha256: insp.sha256,
          texto_chars: rawText.length,
          metodo: rawText.length >= 200 ? "texto_unpdf" : "documento_gateway",
        };
        refCatastralFinal = merged.ref_catastral ?? null;
        direccionFinal = merged.direccion ?? null;
        // Token OPACO de servidor (uuid tipado), nunca un timestamp serializado.
        const { data, error } = await sb.rpc("apply_nota_reparse_plan", {
          p_nota_id: notaId,
          p_claim_token: token,
          p_payload: {
            updates,
            inserts,
            structured: merged,
            raw_pdf_text: rawText ? sanitize(rawText).slice(0, 60000) : null,
            attempt_count: (nota.attempt_count ?? 0) + 1,
          },
        });
        if (error) {
          return { ok: false, updated: 0, inserted: 0, finalized: false, error: error.message ?? String(error) };
        }
        const r = (data ?? {}) as any;
        if (r?.ok !== true) {
          return { ok: false, updated: 0, inserted: 0, finalized: false, error: "apply_plan_sin_confirmacion" };
        }
        return { ok: true, updated: Number(r.updated ?? 0), inserted: Number(r.inserted ?? 0), finalized: true, error: null };
      },
    };

    const extract = async (needTitulares: boolean) => {
      if (rawText.length >= 200) {
        return await callLLM([
          { role: "system", content: "Eres un experto en notas simples del Registro de la Propiedad español. Devuelves SIEMPRE JSON válido." },
          { role: "user", content: buildTextPrompt(rawText, needTitulares) },
        ]) as any;
      }
      // PDF escaneado (sin capa de texto): bloque DOCUMENTO real del gateway,
      // nunca un application/pdf disfrazado de image_url.
      if (!fitsSingleDocument(insp)) {
        return { data: null, error: `pdf_fuera_de_limites:pages=${insp.pageCount}:size=${insp.size}` } as any;
      }
      return await callLLM(buildDocumentMessages({
        base64: toBase64(bytes),
        filename: String(nota.file_url ?? "nota.pdf").split("/").pop() || "nota.pdf",
        needTitulares,
        pageCount: insp.pageCount,
      })) as any;
    };

    const res = await processNotaCore({ repo, extract }, {
      notaId: id, claimToken, structured: nota.structured_json, textoFuente: rawText || null,
    });
    if (!res.ok) {
      return { id, ok: false, reason: `${res.reason}:${res.detalle ?? ""}`.slice(0, 400) };
    }

    return {
      id, ok: true,
      ref_catastral: refCatastralFinal,
      direccion: direccionFinal,
      titulares_insertados: res.inserted,
      titulares_actualizados: res.updated,
    };
  } catch (e) {
    return { id, ok: false, reason: `exception:${(e as Error).message ?? String(e)}`.slice(0, 300) };
  }
}

/** Delegación al handler compartido: aquí sólo se inyecta el pipeline real. */
export const processNotaWithClaim = (sb: any, n: any) =>
  processNotaWithClaimCore(sb, n, processOne as any);

// ---------- handler ----------

declare const Deno: any;

if (typeof Deno !== "undefined" && typeof Deno.serve === "function") {
  Deno.serve((req: Request) =>
    handleReparseRequest(
      req,
      createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      ),
      processOne as any,
      {
        internalSecret: Deno.env.get("REPARSE_INTERNAL_SECRET") ?? null,
        serviceRoleKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? null,
      },
    ),
  );
}
