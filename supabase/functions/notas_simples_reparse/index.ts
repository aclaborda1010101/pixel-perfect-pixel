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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const ENTITY = "notas_simples_reparse";
const DEFAULT_LIMIT = 12;
const MAX_ATTEMPTS = 5;
// Modelo estable, el mismo que ya usa analyze_nota_simple.
const PRIMARY = { name: "lovable", url: "https://ai.gateway.lovable.dev/v1/chat/completions", model: "google/gemini-3.1-flash-lite-preview" };
const FALLBACK = { name: "openrouter", url: "https://openrouter.ai/api/v1/chat/completions", model: "openai/gpt-5.6-luna" };

// Quita NUL y caracteres de control que Postgres rechaza en columnas text/jsonb.
function sanitize(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}

function backoffMinutes(attempt: number): number {
  return Math.min(360, 15 * Math.pow(2, Math.max(0, attempt - 1)));
}

const ROLES_VALIDOS = new Set(["pleno", "usufructo", "nuda_propiedad", "otro"]);

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
  titulares?: Array<{ nombre: string; cif_dni?: string | null; porcentaje?: number | null; rol?: string | null }>;
};

function buildTextPrompt(rawText: string, needTitulares: boolean): string {
  return `Analiza esta NOTA SIMPLE del Registro de la Propiedad español y devuelve JSON EXACTO con estos campos (omite el campo si no lo encuentras):

{
  "direccion": "calle + número + municipio de la FINCA descrita (no del titular). Convierte números escritos en letra a cifra: 'CALLE X NUMERO TREINTA Y TRES' → 'CALLE X 33'",
  "ref_catastral": "referencia catastral de 20 caracteres si aparece",
  "finca_numero": "número registral de la finca",
  "registro": "Registro de la Propiedad emisor"${needTitulares ? `,
  "titulares": [
    { "nombre": "…", "cif_dni": "…", "porcentaje": 0-100, "rol": "pleno" | "usufructo" | "nuda_propiedad" | "otro" }
  ]` : ""}
}

REGLAS:
- Sólo la dirección de la FINCA (parte "URBANA…" / "DESCRIPCIÓN"), NUNCA la dirección del titular.
- Los porcentajes en 0-100 (no en fracción). Si es 50%, devuelve 50.
- Si un dato no aparece con claridad, OMÍTELO (no inventes).

TEXTO:
"""
${rawText.slice(0, 60000)}
"""`;
}

function buildVisionMessages(pdfDataUrl: string, needTitulares: boolean) {
  const schemaHint = needTitulares
    ? `{ "direccion": "...", "ref_catastral": "...", "finca_numero": "...", "registro": "...", "titulares": [{ "nombre": "...", "cif_dni": "...", "porcentaje": 0-100, "rol": "pleno|usufructo|nuda_propiedad|otro" }] }`
    : `{ "direccion": "...", "ref_catastral": "...", "finca_numero": "...", "registro": "..." }`;
  return [
    {
      role: "user",
      content: [
        { type: "text", text: `Extrae de esta NOTA SIMPLE los datos y devuelve SOLO JSON:\n${schemaHint}\n\nReglas: dirección de la FINCA (no del titular); convierte números escritos en letra a cifra; porcentajes 0-100; omite lo que no aparezca.` },
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
      return { data: JSON.parse(txt) as ExtractedFields, model: `${p.name}/${p.model}` };
    } catch (e) {
      console.error(`[notas_reparse] ${p.name}/${p.model} excepción`, e);
      errores.push(`${p.name}/${p.model} excepción: ${String((e as Error).message ?? e).slice(0, 200)}`);
    }
  }
  return { data: null, error: errores.join(" | ").slice(0, 500) };
}

// ---------- procesamiento por nota ----------

async function processOne(sb: any, nota: any): Promise<{ id: string; ok: boolean; reason?: string; ref_catastral?: string | null; direccion?: string | null; titulares_insertados?: number }> {
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
    if (rawText) rawText = letrasANumerosEnTexto(rawText);

    const currentTitulares = Array.isArray(nota.structured_json?.titulares) ? nota.structured_json.titulares : [];
    const needTitulares = currentTitulares.length === 0;

    let extracted: ExtractedFields | null = null;
    if (rawText.length >= 200) {
      extracted = await callLLM([
        { role: "system", content: "Eres un experto en notas simples del Registro de la Propiedad español. Devuelves SIEMPRE JSON válido." },
        { role: "user", content: buildTextPrompt(rawText, needTitulares) },
      ]);
    } else {
      // Fallback visión: PDF inline (base64)
      let bin = "";
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
      const b64 = btoa(bin);
      const dataUrl = `data:application/pdf;base64,${b64}`;
      extracted = await callLLM(buildVisionMessages(dataUrl, needTitulares));
    }
    if (!extracted) return { id, ok: false, reason: "llm_fail" };

    // 3) Merge structured_json
    const prev = (nota.structured_json && typeof nota.structured_json === "object") ? nota.structured_json : {};
    const merged: any = { ...prev, reparse_done: "1" };
    // Al completar el reparse, quita la marca de "necesita extracción"
    if ("needs_extract" in merged) delete merged.needs_extract;
    if (extracted.direccion) merged.direccion = String(extracted.direccion).trim();
    if (extracted.ref_catastral && !prev.ref_catastral) merged.ref_catastral = String(extracted.ref_catastral).replace(/\s+/g, "").toUpperCase();
    const finca = { ...(prev.finca ?? {}) };
    if (extracted.finca_numero && !finca.numero) finca.numero = String(extracted.finca_numero).trim();
    if (extracted.registro && !finca.registro) finca.registro = String(extracted.registro).trim();
    if (extracted.ref_catastral && !finca.ref_catastral) finca.ref_catastral = merged.ref_catastral;
    if (Object.keys(finca).length) merged.finca = finca;

    // Titulares en structured_json si no había ninguno y llegaron
    if (needTitulares && Array.isArray(extracted.titulares) && extracted.titulares.length) {
      merged.titulares = extracted.titulares.map((t) => ({
        nombre: String(t.nombre ?? "").trim(),
        cif_dni: t.cif_dni ? String(t.cif_dni).trim() : null,
        porcentaje: t.porcentaje != null ? Number(t.porcentaje) : null,
        rol: ROLES_VALIDOS.has(String(t.rol ?? "").toLowerCase()) ? String(t.rol).toLowerCase() : "pleno",
      })).filter((t) => t.nombre);
    }

    const { error: updErr } = await sb.from("notas_simples").update({
      raw_pdf_text: rawText ? rawText.slice(0, 60000) : null,
      structured_json: merged,
    }).eq("id", id);
    if (updErr) return { id, ok: false, reason: `update_fail:${updErr.message}` };

    // 4) Insertar titulares (idempotente: nota + nombre normalizado + porcentaje)
    let titInserted = 0;
    if (needTitulares && Array.isArray(merged.titulares) && merged.titulares.length) {
      const { data: existing } = await sb.from("nota_simple_titulares")
        .select("nombre_extraido, porcentaje")
        .eq("nota_simple_id", id);
      const seen = new Set((existing ?? []).map((r: any) =>
        `${String(r.nombre_extraido ?? "").toLowerCase().trim()}|${r.porcentaje ?? ""}`
      ));
      for (const t of merged.titulares as any[]) {
        const key = `${String(t.nombre).toLowerCase().trim()}|${t.porcentaje ?? ""}`;
        if (seen.has(key)) continue;
        const { error } = await sb.from("nota_simple_titulares").insert({
          nota_simple_id: id,
          nombre_extraido: t.nombre,
          cif_dni: t.cif_dni ?? null,
          porcentaje: t.porcentaje ?? null,
          rol: t.rol ?? "pleno",
        });
        if (!error) { titInserted++; seen.add(key); }
        else console.warn(`[notas_reparse] tit insert ${id}:`, error.message);
      }
    }

    return {
      id, ok: true,
      ref_catastral: merged.ref_catastral ?? null,
      direccion: merged.direccion ?? null,
      titulares_insertados: titInserted,
    };
  } catch (e) {
    return { id, ok: false, reason: `exception:${(e as Error).message ?? String(e)}`.slice(0, 300) };
  }
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
  const limit = Math.max(1, Math.min(50, Number(body?.limit ?? DEFAULT_LIMIT)));

  const t0 = Date.now();

  // 1) Selección: sin building_id, listo, sin reparse_done
  // building_id IS NULL  OR  needs_extract='1' → ambos entran al reparse.
  const { data: notas, error: selErr } = await sb
    .from("notas_simples")
    .select("id, file_url, structured_json, building_id")
    .eq("status", "listo")
    .or("building_id.is.null,structured_json->>needs_extract.eq.1")
    .or("structured_json->>reparse_done.is.null,structured_json->>reparse_done.neq.1")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (selErr) {
    return new Response(JSON.stringify({ error: selErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!notas || notas.length === 0) {
    return new Response(JSON.stringify({ ok: true, procesadas: 0, drained: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 2) Procesar en serie (LLM ya es lo costoso; evitamos golpear rate limit)
  const results: any[] = [];
  for (const n of notas) {
    const r = await processOne(sb, n);
    results.push(r);
  }

  // 3) Emparejado batch en BD
  let matchResult: any = null;
  try {
    const { data, error } = await sb.rpc("match_notas_pendientes");
    if (error) console.error(`[notas_reparse] match rpc:`, error.message);
    else matchResult = data ?? null;
  } catch (e) {
    console.error(`[notas_reparse] match rpc exception`, e);
  }

  // 4) Log
  const ok = results.filter((r) => r.ok).length;
  try {
    const { error: logErr } = await sb.from("hubspot_sync_log").insert({
      entity: ENTITY,
      started_at: new Date(t0).toISOString(),
      finished_at: new Date().toISOString(),
      records_upserted: results.length,
      status: ok === results.length ? "ok" : (ok === 0 ? "error" : "partial"),
      metadatos: {
        ok,
        fail: results.length - ok,
        match_result: matchResult,
        fallidas: results.filter((r) => !r.ok).slice(0, 20).map((r) => ({ id: r.id, reason: r.reason })),
      },
    });
    if (logErr) console.warn(`[notas_reparse] log insert:`, logErr.message);
  } catch (e) {
    console.warn(`[notas_reparse] log insert exception:`, (e as Error).message);
  }

  return new Response(JSON.stringify({
    ok: true,
    procesadas: results.length,
    correctas: ok,
    fallidas: results.length - ok,
    match_result: matchResult,
    elapsed_ms: Date.now() - t0,
    resultados: results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});