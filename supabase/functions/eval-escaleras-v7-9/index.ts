// eval-escaleras-v7.9 — OCR puro de leyenda (sin bboxes, sin zoom-prompt).
// Estrategia: una sola llamada VLM por página FXCC pidiendo OCR EXHAUSTIVO
// del plano y leyenda/cuadros, devolviendo TODOS los tokens literales de
// núcleos verticales (COM.V, COM.VA-D, ESCALERA, ESC, ESC.A-D, E1-E4,
// CAJA ESC, NÚCLEO) y descartando ascensor/PTO/PATINILLO. pred_n = nº de
// núcleos de escalera DISTINTOS contados desde el OCR de la mejor planta
// tipo legible. Si la señal es ambigua → needs_review (no inventar).
// Escribe solo en escaleras_eval_results version='v7.9-ocr'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const VERSION = "v7.9-ocr";

const PROMPT = `Eres experto en FXCC catastral de Madrid. Te paso UNA lámina.
TAREA — solo OCR, NO bboxes ni inferencia visual:
1) Identifica la planta. es_p01=true si es PLANTA TIPO sobre rasante
   (P01/PLANTA 1/PRIMERA/P02/SEGUNDA/P03/P04/PLANTA TIPO/ATICO; NO baja).
2) Lista EXHAUSTIVAMENTE todos los TOKENS literales que aparezcan en el
   plano y en la leyenda/cuadro de superficies. No inventes nada. Solo lo
   visible. Incluye especialmente:
   - Núcleos de escalera: ESCALERA, ESC, ESC.A, ESC.B, ESC.C, ESC.D,
     E1, E2, E3, E4, CAJA ESC, CAJA DE ESCALERA, NÚCLEO,
     COM.V, COM.VA, COM.VB, COM.VC, COM.VD (notación catastral de
     "común vertical" = núcleo de escalera).
   - A descartar (NO son escalera): ASCENSOR, ASC, PTO, PATINILLO,
     CONDUCTO, INSTALACIONES.
3) Devuelve además tu mejor recuento OCR de cuántos núcleos de escalera
   DISTINTOS se nombran en la lámina (n_ocr); si no estás seguro, null.
JSON estricto:
{"etiqueta_planta":string,"es_p01":bool,"p01_legible":bool,
 "ocr_tokens_escalera":[string],
 "ocr_tokens_descartados":[string],
 "n_ocr":number|null,
 "confidence":number,"razon":string}`;

async function vlm(apiKey: string, imageUrl: string) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: imageUrl } },
      ]}],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

function countNucleos(tokens: string[]): number {
  const escLetters = new Set<string>();   // ESC.A..D / ESCALERA A..D
  const eNums = new Set<string>();        // E1..E4
  const comvLetters = new Set<string>();  // COM.VA..D
  let escaleraBare = 0;                   // "ESCALERA" sin letra
  let cajaEsc = 0;                        // "CAJA ESC[ALERA]"
  let comvBare = 0;                       // "COM.V" sin letra
  for (const t of (tokens ?? [])) {
    const u = String(t).toUpperCase().replace(/\s+/g, " ").trim();
    if (/^(ASCENSOR|ASC|PTO|PATINILLO|CONDUCTO|INSTALACIONES)$/.test(u)) continue;
    let m;
    if ((m = u.match(/^ESC[\.\s]*([A-D])$/)) || (m = u.match(/^ESCALERA\s+([A-D])$/))) escLetters.add(m[1]);
    else if ((m = u.match(/^E\s*([1-4])$/))) eNums.add(m[1]);
    else if ((m = u.match(/^COM\.V([A-D])$/))) comvLetters.add(m[1]);
    else if (/^COM\.V$/.test(u)) comvBare++;
    else if (/^ESCALERA$/.test(u)) escaleraBare++;
    else if (/^(CAJA\s+ESC(ALERA)?|N[ÚU]CLEO)$/.test(u)) cajaEsc++;
  }
  // prioridad: tokens con letra distinta > E-num > COM.V con letra > fallback
  if (escLetters.size > 0) return escLetters.size;
  if (eNums.size > 0) return eNums.size;
  if (comvLetters.size > 0) return comvLetters.size;
  if (comvBare > 0) return 1;
  if (cajaEsc > 0) return Math.min(cajaEsc, 3);
  if (escaleraBare > 0) return Math.min(escaleraBare, 3);
  return 0;
}

async function evalOne(sb: any, apiKey: string, set_name: string, bid: string) {
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n,needs_review,error").eq("set_name", set_name)
    .eq("version", "v7.2-gemini").eq("building_id", bid).maybeSingle();
  const base = baseRow ?? { pred_n: null, needs_review: true, error: null };
  if (base.error && /sin FXCC/i.test(base.error)) {
    return { pred_n: null, needs_review: true, confidence: 0, evidencia: { base, motivo: "sin FXCC" }, error: "sin FXCC" };
  }
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id", bid).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (!pages.length) {
    return { pred_n: null, needs_review: true, confidence: 0, evidencia: { base, motivo: "sin FXCC" }, error: "sin FXCC" };
  }

  const pass: any[] = [];
  for (let i = 0; i < pages.length; i++) {
    try { pass.push({ idx: i, url: pages[i], ...(await vlm(apiKey, pages[i])) }); }
    catch (e) { pass.push({ idx: i, url: pages[i], error: (e as Error).message }); }
    await new Promise(r => setTimeout(r, 250));
  }
  const p01s = pass.filter(p => p.es_p01 && p.p01_legible);
  p01s.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const best = p01s[0];
  if (!best) {
    return { pred_n: null, needs_review: true, confidence: 0, evidencia: { motivo: "sin P01 legible", pass } };
  }

  const tokens: string[] = Array.isArray(best.ocr_tokens_escalera) ? best.ocr_tokens_escalera : [];
  const nFromTokens = countNucleos(tokens);
  const nModel = best.n_ocr != null ? Math.round(Number(best.n_ocr)) : null;

  // agregación entre páginas P01 legibles: usa el máximo de tokens distintos
  const tokensAllP01: string[] = [];
  for (const p of p01s) if (Array.isArray(p.ocr_tokens_escalera)) tokensAllP01.push(...p.ocr_tokens_escalera);
  const nAgg = countNucleos(tokensAllP01);

  let pred: number | null = null, needsReview = true, razon = "", conf = 0;
  const candidates = [nFromTokens, nAgg, nModel].filter((x): x is number => typeof x === "number" && x > 0);
  if (candidates.length === 0) {
    razon = "OCR sin tokens de escalera"; needsReview = true;
  } else {
    const allEqual = candidates.every(v => v === candidates[0]);
    if (allEqual && (best.confidence ?? 0) >= 0.7) {
      pred = candidates[0]; needsReview = false; conf = 0.85;
      razon = `OCR coherente=${pred}`;
    } else if (nAgg > 0 && (best.confidence ?? 0) >= 0.8 && (nModel == null || nModel === nAgg)) {
      pred = nAgg; needsReview = false; conf = 0.75;
      razon = `OCR agregado=${nAgg}`;
    } else {
      pred = null; needsReview = true; conf = 0.4;
      razon = `OCR ambiguo tokens=${nFromTokens} agg=${nAgg} model=${nModel}`;
    }
  }

  return { pred_n: pred, needs_review: needsReview, confidence: conf,
    evidencia: { base, best_idx: best.idx, nFromTokens, nAgg, nModel, razon, pass } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "missing key" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const batchSize: number = Math.max(1, Math.min(4, Number(body.batch_size ?? 2)));
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
        const r = await evalOne(sb, apiKey, set_name, it.building_id);
        await sb.from("escaleras_eval_results").upsert({
          set_name, version: VERSION, building_id: it.building_id, gt: it.gt,
          pred_n: r.pred_n ?? null,
          pred_segundas: r.pred_n == null ? null : r.pred_n >= 2,
          needs_review: !!r.needs_review, confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null, error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
      } catch (e) { console.warn("v7.9 err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log("v7.9 batch done", batch.length, "remaining", remaining.length);
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-9`, {
          method: "POST",
          headers: { "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
          body: JSON.stringify({ set_name, building_ids: remaining, batch_size: batchSize, force }),
        });
      } catch (e) { console.warn("v7.9 reinvoke fail", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});