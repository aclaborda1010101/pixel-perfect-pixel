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
import { extractText } from "npm:unpdf@0.12.1";
import {
  sanitize,
  sanitizeDeep,
  type TitularNormalizado,
} from "./lib.ts";
import {
  summarizeBatch,
  type OpResult,
} from "./reconcile.ts";
import {
  processNotaCore,
  runMatching,
  type NotaRepo,
} from "./core.ts";
import { runReparseCycle, type CycleDeps } from "./orchestrator.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const ENTITY = "notas_simples_reparse";
const DEFAULT_LIMIT = 2;
const MAX_LIMIT = 5;
const CLAIM_MINUTES = 30;
const MAX_ATTEMPTS = 5;
// Modelo estable, el mismo que ya usa analyze_nota_simple.
const PRIMARY = { name: "lovable", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.1-flash-lite-preview" };
const FALLBACK = { name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-5.6-luna" };

function backoffMinutes(attempt: number): number {
  return Math.min(360, 15 * Math.pow(2, Math.max(0, attempt - 1)));
}

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
- Un mismo titular puede aparecer varias veces con derechos distintos (p. ej. nuda propiedad y usufructo): devuélvelos como filas separadas.
- "rol_literal" es el texto literal del derecho si aparece; "evidencia" sólo si puedes citar el fragmento real. Si no lo tienes, OMÍTELOS.
- Si un dato no aparece con claridad, OMÍTELO (no inventes).

TEXTO:
"""
${rawText.slice(0, 60000)}
"""`;
}

function buildVisionMessages(pdfDataUrl: string, needTitulares: boolean) {
  const schemaHint = needTitulares
    ? `{ "direccion": "...", "ref_catastral": "...", "finca_numero": "...", "registro": "...", "titulares": [{ "nombre": "...", "cif_dni": "...", "porcentaje": 0-100, "rol": "pleno|usufructo|nuda_propiedad|ganancial|otro", "rol_literal": "...", "evidencia": { "cita": "...", "pagina": 1, "ruta": "..." } }] }`
    : `{ "direccion": "...", "ref_catastral": "...", "finca_numero": "...", "registro": "..." }`;
  return [
    {
      role: "user",
      content: [
        { type: "text", text: `Extrae de esta NOTA SIMPLE los datos y devuelve SOLO JSON:\n${schemaHint}\n\nReglas: dirección de la FINCA (no del titular); convierte números escritos en letra a cifra; porcentajes 0-100; "rol" sólo puede ser pleno, usufructo, nuda_propiedad, ganancial u otro (usa "otro" si no está claro, NUNCA "pleno" por defecto); un mismo titular con derechos distintos va en filas separadas; "rol_literal" y "evidencia" sólo si constan realmente; omite lo que no aparezca.` },
        { type: "image_url", image_url: { url: pdfDataUrl } },
      ],
    },
  ];
}

async function callLLM(messages: any[]): Promise<{ data: ExtractedFields | null; error?: string; model?: string }> {
  const OR = Deno.env.get("OPENROUTER_API_KEY") || "";
  const LK = Deno.env.get("LOVABLE_API_KEY") || "";
  const providers = [
    LK ? { ...PRIMARY, auth: `Bearer ${LK}`, extra: {} as Record<string, string> } : null,
    OR ? { ...FALLBACK, auth: `Bearer ${OR}`, extra: { "HTTP-Referer": "https://affluxosv2.world", "X-Title": "Afflux OS · Notas Reparse" } } : null,
  ].filter(Boolean) as any[];
  if (!providers.length) return { data: null, error: "sin_proveedor_ia_configurado" };

  const errores: string[] = [];
  for (const p of providers) {
    try {
      const r = await fetch(p.url, {
        method: "POST",
        headers: { Authorization: p.auth, "Content-Type": "application/json", ...(p.extra ?? {}) },
        body: JSON.stringify({
          model: p.model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0,
          max_tokens: 2000,
        }),
      });
      if (!r.ok) {
        const detalle = (await r.text()).slice(0, 300);
        console.error(`[notas_reparse] ${p.name}/${p.model} HTTP ${r.status} ${detalle}`);
        errores.push(`${p.name}/${p.model} HTTP ${r.status}: ${detalle}`);
        continue;
      }
      const j = await r.json();
      let txt = j?.choices?.[0]?.message?.content || "{}";
      txt = String(txt).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
      return { data: sanitizeDeep(JSON.parse(txt)) as ExtractedFields, model: `${p.name}/${p.model}` };
    } catch (e) {
      console.error(`[notas_reparse] ${p.name}/${p.model} excepción`, e);
      errores.push(`${p.name}/${p.model} excepción: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  }
  return { data: null, error: errores.join(" | ").slice(0, 500) };
}

// ---------- procesamiento por nota ----------

async function processOne(sb: any, nota: any, claimToken: string): Promise<{ id: string; ok: boolean; reason?: string; ref_catastral?: string | null; direccion?: string | null; titulares_insertados?: number; titulares_actualizados?: number; attempt_count?: number; dead_letter?: boolean }> {
  const id = nota.id as string;
  try {
    // 1) Descargar PDF
    if (!nota.file_url) return { id, ok: false, reason: "no_file_url" };
    const { data: blob, error: dlErr } = await sb.storage.from("notas-simples").download(nota.file_url);
    if (dlErr || !blob) return { id, ok: false, reason: `download_fail:${dlErr?.message ?? "empty"}` };
    const bytes = new Uint8Array(await blob.arrayBuffer());

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
      async applyPlan({ notaId, claimToken: token, updates, inserts, titulares, extracted, model }) {
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
        refCatastralFinal = merged.ref_catastral ?? null;
        direccionFinal = merged.direccion ?? null;
        const { data, error } = await sb.rpc("apply_nota_reparse_plan", {
          p_payload: {
            nota_id: notaId,
            claim_token: token,
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
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const dataUrl = `data:application/pdf;base64,${btoa(bin)}`;
      return await callLLM(buildVisionMessages(dataUrl, needTitulares)) as any;
    };

    const res = await processNotaCore({ repo, extract }, {
      notaId: id, claimToken, structured: nota.structured_json,
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

/** Refresco de claim + pipeline + estado de reintento de UNA nota. */
async function processNotaWithClaim(sb: any, n: any) {
  const claimToken = new Date().toISOString();
  let q = sb.from("notas_simples").update({ claimed_at: claimToken }).eq("id", n.id);
  q = n.claimed_at ? q.eq("claimed_at", n.claimed_at) : q.is("claimed_at", null);
  const { data: claimRow, error: claimErr } = await q.select("id").maybeSingle();
  if (claimErr || !claimRow) {
    return { id: n.id as string, ok: false, reason: `claim_refresh_fail:${claimErr?.message ?? "rows=0"}` };
  }

  const r: any = await processOne(sb, n, claimToken);
  if (!r.ok) {
    const attempts = (n.attempt_count ?? 0) + 1;
    const dead = attempts >= MAX_ATTEMPTS;
    const { data: retryRow, error: retryErr } = await sb.from("notas_simples").update({
      attempt_count: attempts,
      last_error: String(r.reason ?? "desconocido").slice(0, 500),
      next_retry_at: dead ? null : new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString(),
      dead_letter: dead,
      claimed_at: null,
    }).eq("id", n.id).eq("claimed_at", claimToken).select("id").maybeSingle();
    if (retryErr || !retryRow) {
      r.retry_state_fail = retryErr?.message ?? "rows=0";
      r.reason = `${r.reason} | retry_state_fail:${r.retry_state_fail}`.slice(0, 400);
    }
    r.attempt_count = attempts;
    r.dead_letter = dead;
  }
  return r;
}

// ---------- handler ----------

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body?.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT));


  const deps: CycleDeps = {
    async readState() {
      const { data, error } = await sb.rpc("reparse_match_state_read");
      if (error) return { ok: false, error: error.message ?? String(error) };
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) return { ok: false, error: "estado_singleton_ausente" };
      return { ok: true, pending: row.match_pending === true, generation: Number(row.generation ?? 0) };
    },
    async markPending() {
      const { data, error } = await sb.rpc("reparse_mark_match_pending");
      if (error) return { ok: false, error: error.message ?? String(error) };
      const gen = Number(Array.isArray(data) ? data[0] : data);
      if (!Number.isFinite(gen)) return { ok: false, error: "mark_sin_generacion" };
      return { ok: true, generation: gen };
    },
    async clearPending(expected) {
      const { data, error } = await sb.rpc("reparse_clear_match_pending", { p_expected_generation: expected });
      if (error) return { ok: false, error: error.message ?? String(error) };
      return { ok: true, cleared: (Array.isArray(data) ? data[0] : data) === true };
    },
    async claimBatch(limit) {
      const { data, error } = await sb.rpc("reparse_claim_batch", {
        p_limit: limit,
        p_lock_minutes: CLAIM_MINUTES,
      });
      return { rows: (data ?? []) as unknown[], error: error?.message ?? null };
    },
    async releaseClaims(notas) {
      for (const n of notas as any[]) {
        await sb.from("notas_simples").update({ claimed_at: n.claimed_at ?? null }).eq("id", n.id);
      }
    },
    processNota: (n) => processNotaWithClaim(sb, n),
    runMatch: () => runMatching(async () => await sb.rpc("match_notas_pendientes")),
    async insertLog(entry) {
      const { error } = await sb.from("hubspot_sync_log").insert(entry as any);
      return { error: error?.message ?? null };
    },
  };

  const cycle = await runReparseCycle(deps, { limit });
  return new Response(JSON.stringify(cycle.body), {
    status: cycle.http,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
