// eval-escaleras-v7.11-fewshot — CHUNKED + chained re-invocation
// - build_library: procesa lotes de N edificios (default 3), persiste tras cada uno
//   y se auto-reinvoca con el resto hasta terminar. Nunca hace los 20 de golpe.
// - eval: mismo patrón ya existente (default batch_size=2 con auto-reinvocación).
// Promoción posterior la decide el orquestador comparando v7.11-fewshot vs v7.2-gemini.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const VERSION = "v7.11-fewshot";
const LIB_KEY = "escaleras_fewshot_library";

const LIBRARY_BUILDING_IDS = [
  "5786db99-e0e8-44ac-a545-048f65dceedb",
  "3a1cd262-a73d-4202-97aa-6adf929cbd89",
  "e0d20e70-33c8-4cc6-b80e-983cfdd29f70",
  "efd3192c-62b5-4b2d-bf5d-87fbdd6de69e",
  "8af90a55-271d-4f5d-9bd3-a89a0451f88d",
  "7695c919-1968-4bb3-9599-3b2abc203964",
  "64aac8d8-41ff-4965-9259-59b319b3ac9b",
  "1480e70d-8707-497e-bde6-74084f66821b",
];

const PROMPT_LIB = `Eres experto en FXCC catastral de Madrid. Te paso UNA lamina.
1) Identifica la planta. es_p01=true si es planta tipo sobre rasante distinta de PB/sotano/cubierta.
2) Si es planta tipo y legible, cuenta cajas de escalera (nucleos verticales con peldanos
   que separan grupos de viviendas) y da bbox normalizados [x0,y0,x1,y1].
JSON: {"etiqueta":string,"es_p01":bool,"p01_legible":bool,
 "n_cajas_p01":number|null,"cajas_bbox":[{"bbox":[number,number,number,number],"indicio":string}],
 "confidence":number,"descripcion":string}`;

function fewshotPrompt(lib: any[]): string {
  const lines = lib.map((e, i) =>
    `Ejemplo ${i + 1} (edificio real, planta tipo, GT=2 cajas confirmado por humano): ${e.descripcion || "dos nucleos verticales servidores de grupos distintos."}`
  ).join("\n");
  return `Eres experto leyendo FXCC catastral de Madrid. Vas a contar CAJAS DE ESCALERA en la planta tipo.

REFERENCIA VISUAL (imagenes adjuntas previas al objetivo, gt=2 humano):
${lines}

TAREA: Te paso las paginas del FXCC del edificio objetivo. Localiza la PLANTA TIPO (P01/P02/P03/Atico, NO PB ni sotano), y cuenta cajas.
- "Caja de escalera" = nucleo vertical cerrado con peldanos que sirve grupo de viviendas (V.A, V.B...).
- Dos nucleos compartiendo escalera = 1. Ascensor solo != caja. Patios != caja.
- Si V.A y V.B son servidos por nucleos independientes -> 2.
- Compara visualmente con los ejemplos: si la disposicion recuerda a GT=2, probablemente sean 2.
- PROHIBIDO INVENTAR. Si no ves planta tipo legible -> needs_review=true.

JSON estricto:
{"pagina_p01_idx":number|null,"p01_legible":bool,
 "n_cajas":number|null,"needs_review":bool,"confidence":number,
 "razon":string,"comparacion_ejemplos":string}`;
}

async function vlm(apiKey: string, messages: any): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, response_format: { type: "json_object" } }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}: ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

async function readLib(sb: any): Promise<any[]> {
  const { data } = await sb.from("app_settings").select("value").eq("key", LIB_KEY).maybeSingle();
  return Array.isArray(data?.value?.entries) ? data!.value.entries : [];
}
async function writeLib(sb: any, entries: any[], inProgress: boolean) {
  await sb.from("app_settings").upsert({
    key: LIB_KEY,
    value: { entries, built_at: new Date().toISOString(), in_progress: inProgress } as any,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
}

async function buildLibraryChunk(sb: any, apiKey: string, ids: string[]): Promise<void> {
  const lib = await readLib(sb);
  const have = new Set(lib.map((e: any) => e.building_id));
  for (const bid of ids) {
    if (have.has(bid)) continue;
    try {
      const { data: cat } = await sb.from("catastro_data")
        .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id", bid).maybeSingle();
      const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
        ? cat!.fxcc_pages_urls
        : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
      if (!pages.length) continue;
      // Cap páginas analizadas a 6 (planta tipo suele estar en p1-p5)
      const pagesCap = pages.slice(0, 6);
      const probes: any[] = [];
      for (let i = 0; i < pagesCap.length; i++) {
        try {
          const r = await vlm(apiKey, [{ role: "user", content: [
            { type: "text", text: PROMPT_LIB },
            { type: "image_url", image_url: { url: pagesCap[i] } },
          ]}]);
          probes.push({ idx: i, url: pagesCap[i], ...r });
        } catch (e) { probes.push({ idx: i, error: (e as Error).message }); }
        await new Promise(r => setTimeout(r, 250));
      }
      const cand = probes.filter((p: any) => p.es_p01 && p.p01_legible && Number(p.n_cajas_p01) === 2);
      cand.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
      if (cand[0]) lib.push({
        building_id: bid, page_url: cand[0].url, page_idx: cand[0].idx,
        n_cajas: 2, confidence: cand[0].confidence,
        descripcion: cand[0].descripcion || cand[0].razon || null,
      });
      // Persistencia incremental por edificio
      await writeLib(sb, lib, true);
    } catch (e) { console.warn("lib build err", bid, (e as Error).message); }
  }
}

function pickExamples(lib: any[], bid: string, k = 4): any[] {
  if (lib.length <= k) return lib;
  const seed = bid.split("").reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const idxs = Array.from({ length: lib.length }, (_, i) => i)
    .sort((a, b) => (((a + seed) * 2654435761) >>> 0) - (((b + seed) * 2654435761) >>> 0));
  return idxs.slice(0, k).map(i => lib[i]);
}

async function evalOne(sb: any, apiKey: string, set_name: string, bid: string, _gt: number, lib: any[]) {
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n,needs_review,confidence,error").eq("set_name", set_name)
    .eq("version", "v7.2-gemini").eq("building_id", bid).maybeSingle();
  const base = baseRow ?? { pred_n: null, needs_review: true, confidence: 0, error: null };
  const basePred: number | null = (typeof base.pred_n === "number") ? base.pred_n : null;

  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id", bid).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls
    : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (!pages.length) {
    return { pred_n: basePred, needs_review: basePred == null, confidence: 0.3,
      evidencia: { source: "no_fxcc_respeta_base", base } };
  }

  const examples = pickExamples(lib, bid, 4);
  const content: any[] = [{ type: "text", text: fewshotPrompt(examples) }];
  for (const ex of examples) content.push({ type: "image_url", image_url: { url: ex.page_url } });
  content.push({ type: "text", text: `--- FIN EJEMPLOS. EDIFICIO OBJETIVO (${pages.length} pags FXCC) ---` });
  for (const u of pages) content.push({ type: "image_url", image_url: { url: u } });

  let passA: any = null;
  try { passA = await vlm(apiKey, [{ role: "user", content }]); }
  catch (e) { return { pred_n: basePred, needs_review: basePred == null, confidence: 0.3,
    evidencia: { source: "vlm_err_respeta_base", base, error: (e as Error).message } }; }

  const nA: number | null = passA?.n_cajas == null ? null : Math.round(Number(passA.n_cajas));
  const confA: number = Number(passA?.confidence ?? 0);
  const nrA: boolean = !!passA?.needs_review;

  let nB: number | null = null; let confB: number = 0;
  if (nA != null && !nrA && passA?.pagina_p01_idx != null) {
    const pageIdx = Math.max(0, Math.min(pages.length - 1, Number(passA.pagina_p01_idx)));
    try {
      const v = await vlm(apiKey, [{ role: "user", content: [
        { type: "text", text: PROMPT_LIB },
        { type: "image_url", image_url: { url: pages[pageIdx] } },
      ]}]);
      nB = v?.n_cajas_p01 == null ? null : Math.round(Number(v.n_cajas_p01));
      confB = Number(v?.confidence ?? 0);
    } catch { /* nB null */ }
  }

  let pred: number | null = basePred;
  let needsReview = base.needs_review ?? (basePred == null);
  let source = "fallback_v7_2_base";
  if (nA != null && nB != null && nA === nB && confA >= 0.7 && confB >= 0.7 && nA >= 1 && nA <= 6 && !nrA) {
    pred = nA; needsReview = false; source = "fewshot_ab_match";
  } else if (basePred == null && nA != null && !nrA && confA >= 0.8) {
    pred = nA; needsReview = false; source = "fewshot_solo_alta_conf";
  }

  return {
    pred_n: pred, needs_review: needsReview,
    confidence: Math.max(confA, confB) || base.confidence || 0,
    evidencia: { source, base, nA, nB, confA, confB, nrA,
      examples: examples.map(e => e.building_id),
      passA_razon: passA?.razon, passA_comp: passA?.comparacion_ejemplos },
  };
}

async function reinvoke(payload: any) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-11-fewshot`, {
      method: "POST",
      headers: { "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.warn("reinvoke fail", (e as Error).message); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  if (body.build_library === true) {
    const libBatch: number = Math.max(1, Math.min(4, Number(body.lib_batch_size ?? 3)));
    let pool: string[] = Array.isArray(body.lib_building_ids) && body.lib_building_ids.length
      ? body.lib_building_ids : LIBRARY_BUILDING_IDS.slice();
    const existing = await readLib(sb);
    const have = new Set(existing.map((e: any) => e.building_id));
    pool = pool.filter((id) => !have.has(id));
    const batch = pool.slice(0, libBatch);
    const rest = pool.slice(libBatch);
    if (!batch.length) {
      await writeLib(sb, existing, false);
      return new Response(JSON.stringify({ ok: true, action: "build_library", done: true, lib_size: existing.length }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil((async () => {
      try { await buildLibraryChunk(sb, apiKey, batch); }
      catch (e) { console.warn("build err", (e as Error).message); }
      if (rest.length) {
        await reinvoke({ build_library: true, lib_building_ids: rest, lib_batch_size: libBatch });
      } else {
        const final = await readLib(sb);
        await writeLib(sb, final, false);
      }
    })());
    return new Response(JSON.stringify({ ok: true, async: true, action: "build_library", batch: batch.length, remaining: rest.length }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const force: boolean = body.force === true;
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;
  const batchSize: number = Math.max(1, Math.min(4, Number(body.batch_size ?? 2)));

  const lib = await readLib(sb);
  if (lib.length < 4) {
    return new Response(JSON.stringify({
      error: "biblioteca insuficiente", lib_size: lib.length,
      hint: "POST { build_library: true } primero (se construye por lotes)",
    }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let q = sb.from("escaleras_control_set").select("building_id,gt").eq("set_name", set_name);
  if (onlyIds) q = q.in("building_id", onlyIds);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  let items = rows ?? [];
  if (!force && items.length) {
    const { data: done } = await sb.from("escaleras_eval_results")
      .select("building_id,pred_n,needs_review").eq("set_name", set_name)
      .eq("version", VERSION).in("building_id", items.map((i: any) => i.building_id));
    const ok = new Set((done ?? []).filter((r: any) => r.pred_n != null || r.needs_review === true).map((r: any) => r.building_id));
    items = items.filter((i: any) => !ok.has(i.building_id));
  }
  const batch = items.slice(0, batchSize);
  const remaining = items.slice(batchSize).map((i: any) => i.building_id);

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil((async () => {
    for (const it of batch) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt, lib);
        await sb.from("escaleras_eval_results").upsert({
          set_name, version: VERSION, building_id: it.building_id, gt: it.gt,
          pred_n: r.pred_n ?? null,
          pred_segundas: r.pred_n == null ? null : r.pred_n >= 2,
          needs_review: !!r.needs_review, confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null, error: null,
        }, { onConflict: "set_name,version,building_id" });
      } catch (e) { console.warn("v7.11 err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 250));
    }
    if (remaining.length) await reinvoke({ set_name, building_ids: remaining, batch_size: batchSize, force });
  })());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length, lib_size: lib.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
