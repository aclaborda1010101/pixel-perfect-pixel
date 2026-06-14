// eval-escaleras-v7.11-fewshot
// Estrategia: v7.2-gemini como suelo (precision 1.0, no degradar) + few-shot
// multimodal usando 4 ejemplos anotados de la biblioteca (edificios externos
// con gt=2 confirmado). Promoci\u00f3n s\u00f3lo cuando A==B con conf>=0.7 y
// el pred nuevo MEJORA el de base sin contradecirlo a la baja.
//
// Modos:
//   { build_library: true }  \u2192 construye/refresca la biblioteca anotada.
//   { set_name, building_ids?, force? } \u2192 evalua usando la biblioteca.
//
// Biblioteca: persistida en app_settings.key='escaleras_fewshot_library'.
// Cada entrada: { building_id, page_url, n_cajas:2, confidence, descripcion }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const VERSION = "v7.11-fewshot";
const LIB_KEY = "escaleras_fewshot_library";

// Edificios externos a ctrl_10x10_v1 con gt=2 confirmado en qa_ground_truth.
const LIBRARY_BUILDING_IDS = [
  "5786db99-e0e8-44ac-a545-048f65dceedb", // margallo 13
  "3a1cd262-a73d-4202-97aa-6adf929cbd89", // claudio coello 26
  "e0d20e70-33c8-4cc6-b80e-983cfdd29f70", // gran via 73
  "efd3192c-62b5-4b2d-bf5d-87fbdd6de69e", // serrano 16
  "8af90a55-271d-4f5d-9bd3-a89a0451f88d", // san miguel 5
  "7695c919-1968-4bb3-9599-3b2abc203964", // san pedro 6
  "64aac8d8-41ff-4965-9259-59b319b3ac9b", // bilbao 1
  "1480e70d-8707-497e-bde6-74084f66821b", // amor dios 14
];

const PROMPT_LIB = `Eres experto en FXCC catastral de Madrid. Te paso UNA l\u00e1mina.
1) Identifica la planta. es_p01=true si es planta tipo sobre rasante distinta de PB/s\u00f3tano/cubierta.
2) Si es planta tipo y legible, cuenta cajas de escalera (n\u00facleos verticales con pelda\u00f1os
   que separan grupos de viviendas) y da bbox normalizados [x0,y0,x1,y1].
JSON: {"etiqueta":string,"es_p01":bool,"p01_legible":bool,
 "n_cajas_p01":number|null,"cajas_bbox":[{"bbox":[number,number,number,number],"indicio":string}],
 "confidence":number,"descripcion":string}`;

function fewshotPrompt(lib: any[]): string {
  const lines = lib.map((e, i) =>
    `Ejemplo ${i + 1} (edificio real, planta tipo, GT=2 cajas confirmado por humano): ${e.descripcion || "dos n\u00facleos verticales servidores de grupos de viviendas distintos."}`
  ).join("\n");
  return `Eres experto leyendo FXCC catastral de Madrid. Vas a contar CAJAS DE ESCALERA en la planta tipo de un edificio residencial.

REFERENCIA VISUAL (im\u00e1genes adjuntas previas al objetivo, gt=2 humano):
${lines}

TAREA: Te paso despu\u00e9s las p\u00e1ginas del FXCC del edificio objetivo. Localiza la PLANTA TIPO (P01/P02/P03/P\u00e1tico, NO PB ni s\u00f3tano ni cubierta), y cuenta cuantas cajas de escalera hay en esa planta.
- "Caja de escalera" = n\u00facleo vertical cerrado con pelda\u00f1os/diagonales que sirve un grupo de viviendas (V.A, V.B...).
- Dos n\u00facleos compartiendo escalera = 1. Ascensor solo \u2260 caja. Patios y patinillos \u2260 caja.
- Si dos grupos de viviendas (V.A y V.B) son servidos por n\u00facleos independientes, son 2.
- Compara visualmente con los ejemplos: si la disposici\u00f3n recuerda a los ejemplos GT=2, probablemente sean 2.
- PROHIBIDO INVENTAR. Si no ves la planta tipo legible o tienes dudas \u2192 needs_review=true.

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

async function buildLibrary(sb: any, apiKey: string): Promise<any[]> {
  const lib: any[] = [];
  for (const bid of LIBRARY_BUILDING_IDS) {
    try {
      const { data: cat } = await sb.from("catastro_data")
        .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id", bid).maybeSingle();
      const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
        ? cat!.fxcc_pages_urls
        : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
      if (!pages.length) continue;
      const probes: any[] = [];
      for (let i = 0; i < pages.length; i++) {
        try {
          const r = await vlm(apiKey, [{ role: "user", content: [
            { type: "text", text: PROMPT_LIB },
            { type: "image_url", image_url: { url: pages[i] } },
          ]}]);
          probes.push({ idx: i, url: pages[i], ...r });
        } catch (e) { probes.push({ idx: i, error: (e as Error).message }); }
        await new Promise(r => setTimeout(r, 300));
      }
      // Mejor p\u00e1gina: es_p01 + legible + n_cajas==2 + max conf
      const cand = probes.filter((p: any) => p.es_p01 && p.p01_legible && Number(p.n_cajas_p01) === 2);
      cand.sort((a: any, b: any) => (b.confidence ?? 0) - (a.confidence ?? 0));
      if (cand[0]) lib.push({
        building_id: bid, page_url: cand[0].url, page_idx: cand[0].idx,
        n_cajas: 2, confidence: cand[0].confidence,
        descripcion: cand[0].descripcion || cand[0].razon || null,
      });
    } catch (e) { console.warn("lib build err", bid, (e as Error).message); }
  }
  await sb.from("app_settings").upsert({
    key: LIB_KEY,
    value: { entries: lib, built_at: new Date().toISOString() } as any,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  console.log("library built", lib.length);
  return lib;
}

function pickExamples(lib: any[], bid: string, k = 4): any[] {
  // Selecci\u00f3n determinista por hash del building_id para no sobreajustar.
  if (lib.length <= k) return lib;
  const seed = bid.split("").reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  const idxs = Array.from({ length: lib.length }, (_, i) => i)
    .sort((a, b) => (((a + seed) * 2654435761) >>> 0) - (((b + seed) * 2654435761) >>> 0));
  return idxs.slice(0, k).map(i => lib[i]);
}

async function evalOne(sb: any, apiKey: string, set_name: string, bid: string, gt: number, lib: any[]) {
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
  // Mensaje multimodal: prompt + im\u00e1genes ejemplo + separador + p\u00e1ginas objetivo.
  const content: any[] = [{ type: "text", text: fewshotPrompt(examples) }];
  for (const ex of examples) content.push({ type: "image_url", image_url: { url: ex.page_url } });
  content.push({ type: "text", text: `--- FIN EJEMPLOS. AHORA EDIFICIO OBJETIVO (${pages.length} p\u00e1ginas FXCC) ---` });
  for (const u of pages) content.push({ type: "image_url", image_url: { url: u } });

  let passA: any = null;
  try { passA = await vlm(apiKey, [{ role: "user", content }]); }
  catch (e) { return { pred_n: basePred, needs_review: basePred == null, confidence: 0.3,
    evidencia: { source: "vlm_err_respeta_base", base, error: (e as Error).message } }; }

  const nA: number | null = passA?.n_cajas == null ? null : Math.round(Number(passA.n_cajas));
  const confA: number = Number(passA?.confidence ?? 0);
  const nrA: boolean = !!passA?.needs_review;

  // Verificaci\u00f3n A==B sobre la misma p\u00e1gina elegida (sin few-shot, evita anclaje)
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
    } catch (e) { /* nB queda null */ }
  }

  // DECISI\u00d3N (precision-preserving):
  // 1) Si A==B y conf>=0.7 y nA est\u00e1 en [1..6] \u2192 pred=nA.
  // 2) Si no concuerdan o nrA \u2192 respeta base (no degradar precision).
  let pred: number | null = basePred;
  let needsReview = base.needs_review ?? (basePred == null);
  let source = "fallback_v7_2_base";
  if (nA != null && nB != null && nA === nB && confA >= 0.7 && confB >= 0.7 && nA >= 1 && nA <= 6 && !nrA) {
    pred = nA; needsReview = false; source = "fewshot_ab_match";
  } else if (basePred == null && nA != null && !nrA && confA >= 0.8) {
    // Caso NR sin base: aceptar fewshot s\u00f3lo con conf alta para no perder precision.
    pred = nA; needsReview = false; source = "fewshot_solo_alta_conf";
  }

  return {
    pred_n: pred,
    needs_review: needsReview,
    confidence: Math.max(confA, confB) || base.confidence || 0,
    evidencia: { source, base, nA, nB, confA, confB, nrA,
      examples: examples.map(e => e.building_id),
      passA_razon: passA?.razon, passA_comp: passA?.comparacion_ejemplos },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const body = await req.json().catch(() => ({}));

  if (body.build_library === true) {
    // Background build
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil((async () => {
      try { await buildLibrary(sb, apiKey); }
      catch (e) { console.warn("build err", (e as Error).message); }
    })());
    return new Response(JSON.stringify({ ok: true, async: true, action: "build_library", n_candidates: LIBRARY_BUILDING_IDS.length }),
      { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const force: boolean = body.force === true;
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;
  const batchSize: number = Math.max(1, Math.min(4, Number(body.batch_size ?? 2)));

  // Cargar biblioteca; si vac\u00eda, construirla antes de evaluar
  let lib: any[] = [];
  const { data: setting } = await sb.from("app_settings").select("value").eq("key", LIB_KEY).maybeSingle();
  lib = Array.isArray(setting?.value?.entries) ? setting!.value.entries : [];
  if (lib.length < 4) {
    console.log("building library inline (lib<4)");
    try { lib = await buildLibrary(sb, apiKey); }
    catch (e) { return new Response(JSON.stringify({ error: "lib_build_failed: " + (e as Error).message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
  }
  if (lib.length < 4) {
    return new Response(JSON.stringify({ error: "biblioteca insuficiente", lib_size: lib.length }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

  const run = async () => {
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
      await new Promise(r => setTimeout(r, 300));
    }
    console.log("v7.11 batch done", batch.length, "remaining", remaining.length);
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-11-fewshot`, {
          method: "POST",
          headers: { "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
          body: JSON.stringify({ set_name, building_ids: remaining, batch_size: batchSize, force }),
        });
      } catch (e) { console.warn("v7.11 reinvoke fail", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length, lib_size: lib.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});