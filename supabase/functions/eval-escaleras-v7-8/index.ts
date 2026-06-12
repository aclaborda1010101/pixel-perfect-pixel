// eval-escaleras-v7.8 (zoom virtual agresivo + OCR leyenda)
// Estrategia:
//  Pass A (1 llamada/página FXCC): clasifica planta y, si P01, devuelve
//    bbox de cada candidato a caja de escalera + tokens OCR de la leyenda
//    ("ESCALERA", "ESC.A", "E1/E2", "NÚCLEO", letras V.A/V.B/...,
//    "ASCENSOR" para descartar). Sin imagescript: el "zoom" se hace
//    por prompt — re-llamamos al VLM con el bbox específico y le pedimos
//    que se concentre SOLO en esa región a máxima resolución.
//  Pass B (1 llamada por bbox candidato): verifica si esa región es
//    realmente caja de escalera (peldaños/diagonales, no patinillo,
//    no solo ascensor) y devuelve un veredicto binario + confianza.
//  Señal C (OCR leyenda): conteo de letras únicas de escalera (A/B/C…)
//    o ocurrencias del literal "ESCALERA" en la leyenda.
//  Decisión:
//    n_visual = nº de bboxes confirmados por Pass B (conf>=0.7)
//    n_ocr    = señal C (si disponible y conf>=0.7)
//    Si n_visual == n_ocr y ambos >0 → pred = n_visual (alta confianza)
//    Si solo uno disponible y conf>=0.8 → pred = ese valor
//    Si discrepan → needs_review (no inventar)
//  Solo escribe en escaleras_eval_results (version='v7.8-zoom'). NO toca
//  prod_74 ni building_analysis.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const VERSION = "v7.8-zoom";

const PROMPT_A = `Eres experto en FXCC catastral de Madrid. Te paso UNA lámina.
1) Identifica la planta. Acepta como PLANTA TIPO (es_p01=true): P01/PLANTA 1/
   PRIMERA/P02/SEGUNDA/P03/P04/PLANTA TIPO/ATICO — cualquier planta sobre
   rasante distinta de BAJA en residencial.
2) Si es P01: detecta TODAS las cajas candidatas de escalera (núcleos
   verticales con peldaños/diagonales separando viviendas V.A/V.B...).
   Da bbox normalizado [x0,y0,x1,y1] (0-1, origen sup-izq) por candidato.
3) OCR de leyenda/cuadros: lista TOKENS literales relevantes encontrados
   en la lámina: "ESCALERA", "ESC", "E1","E2", "NÚCLEO", letras de
   escalera (A,B,C...), "ASCENSOR", "PATINILLO", "V.A","V.B"...
Prohibido inventar. JSON estricto:
{"etiqueta_planta":string,"es_p01":bool,"p01_legible":bool,
 "candidatos":[{"bbox":[number,number,number,number],"indicio":string}],
 "ocr_tokens":[string],
 "n_escaleras_leyenda":number|null,
 "confidence":number,"razon":string}`;

const PROMPT_B = (bbox: number[]) => `Eres experto en FXCC. Misma lámina.
CONCÉNTRATE EXCLUSIVAMENTE en la región bbox=${JSON.stringify(bbox)}
(coords normalizadas 0-1, origen sup-izq). Ignora todo lo demás.
Examínala a máxima resolución mental ("zoom"). Responde:
- ¿Es una CAJA DE ESCALERA real (núcleo cerrado con peldaños/diagonales
  visibles que sirve a viviendas)? Un núcleo con escalera+ascensor cuenta
  como SÍ. Un patinillo, hueco de ascensor SOLO, o patio NO cuenta.
Prohibido inventar. Si la región no se ve clara, baja la confianza.
JSON:{"es_caja":bool,"tiene_peldanos":bool,"solo_ascensor":bool,
 "confidence":number,"razon":string}`;

async function vlm(apiKey: string, prompt: string, imageUrl: string) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageUrl } },
      ]}],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

function countLetrasEscalera(tokens: string[]): number {
  const letters = new Set<string>();
  let escaleraOccurrences = 0;
  for (const t of (tokens ?? [])) {
    const u = String(t).toUpperCase().trim();
    if (/^ESCALERA$/.test(u)) escaleraOccurrences++;
    const m = u.match(/^ESC[\.\s]*([A-D])$/) || u.match(/^ESCALERA\s+([A-D])$/) || u.match(/^E\s*([1-4])$/);
    if (m) letters.add(m[1]);
  }
  if (letters.size > 0) return letters.size;
  if (escaleraOccurrences > 0) return escaleraOccurrences;
  return 0;
}

async function evalOne(sb: any, apiKey: string, set_name: string, bid: string, gt: number) {
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n,needs_review,error").eq("set_name", set_name)
    .eq("version", "v7.2-gemini").eq("building_id", bid).maybeSingle();
  const base = baseRow ?? { pred_n: null, needs_review: true, error: null };

  if (base.error && /sin FXCC/i.test(base.error)) {
    return { pred_n: null, needs_review: true, confidence: 0,
      evidencia: { base, motivo: "sin FXCC" }, error: "sin FXCC" };
  }
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id", bid).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (!pages.length) {
    return { pred_n: null, needs_review: true, confidence: 0,
      evidencia: { base, motivo: "sin FXCC" }, error: "sin FXCC" };
  }

  // Pass A
  const passA: any[] = [];
  for (let i = 0; i < pages.length; i++) {
    try { passA.push({ idx: i, url: pages[i], ...(await vlm(apiKey, PROMPT_A, pages[i])) }); }
    catch (e) { passA.push({ idx: i, url: pages[i], error: (e as Error).message }); }
    await new Promise(r => setTimeout(r, 250));
  }
  const p01s = passA.filter(p => p.es_p01 && p.p01_legible && Array.isArray(p.candidatos));
  p01s.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const best = p01s[0];
  if (!best) {
    return { pred_n: base.pred_n ?? null,
      needs_review: base.pred_n == null,
      confidence: 0, evidencia: { base, motivo: "sin P01 legible", passA } };
  }

  // Pass B por cada candidato (max 6)
  const cands = (best.candidatos ?? []).slice(0, 6);
  const passB: any[] = [];
  for (const c of cands) {
    try { passB.push({ bbox: c.bbox, ...(await vlm(apiKey, PROMPT_B(c.bbox), best.url)) }); }
    catch (e) { passB.push({ bbox: c.bbox, error: (e as Error).message }); }
    await new Promise(r => setTimeout(r, 250));
  }
  const confirmadas = passB.filter(b => b.es_caja === true && !b.solo_ascensor && (b.confidence ?? 0) >= 0.7);
  const nVisual = confirmadas.length;

  // Señal C: OCR leyenda
  const tokensAll: string[] = [];
  for (const p of passA) if (Array.isArray(p.ocr_tokens)) tokensAll.push(...p.ocr_tokens);
  const nLeyenda = best.n_escaleras_leyenda != null ? Math.round(Number(best.n_escaleras_leyenda)) : 0;
  const nOcr = Math.max(nLeyenda, countLetrasEscalera(tokensAll));

  // Decisión
  let pred: number | null = null;
  let needsReview = true;
  let razon = "";
  let conf = 0;
  if (nVisual > 0 && nOcr > 0 && nVisual === nOcr) {
    pred = nVisual; needsReview = false; conf = 0.9;
    razon = `visual==ocr==${nVisual}`;
  } else if (nVisual > 0 && nOcr === 0) {
    if (nVisual >= 1) { pred = nVisual; needsReview = false; conf = 0.75;
      razon = `solo visual=${nVisual}, sin ocr`; }
  } else if (nOcr > 0 && nVisual === 0) {
    pred = nOcr; needsReview = false; conf = 0.7;
    razon = `solo ocr=${nOcr}`;
  } else if (nVisual !== nOcr) {
    pred = null; needsReview = true; conf = 0.4;
    razon = `discrepan visual=${nVisual} vs ocr=${nOcr} → NR`;
  } else {
    pred = null; needsReview = true; razon = "sin señales";
  }

  return { pred_n: pred,
    needs_review: needsReview, confidence: conf,
    evidencia: { base, best_idx: best.idx, nVisual, nOcr, razon, passA, passB } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "missing key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const batchSize: number = Math.max(1, Math.min(4, Number(body.batch_size ?? 3)));
  const force: boolean = body.force === true;
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

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
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt);
        await sb.from("escaleras_eval_results").upsert({
          set_name, version: VERSION, building_id: it.building_id, gt: it.gt,
          pred_n: r.pred_n ?? null,
          pred_segundas: r.pred_n == null ? null : r.pred_n >= 2,
          needs_review: !!r.needs_review,
          confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null,
          error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
      } catch (e) { console.warn("v7.8-zoom err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log("v7.8-zoom batch done", batch.length, "remaining", remaining.length);
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-8`, {
          method: "POST",
          headers: { "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
          body: JSON.stringify({ set_name, building_ids: remaining, batch_size: batchSize, force }),
        });
      } catch (e) { console.warn("v7.8-zoom reinvoke fail", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});