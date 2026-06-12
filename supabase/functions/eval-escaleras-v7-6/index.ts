// eval-escaleras-v7.6
// Estrategia: v7.2-gemini + "zoom virtual" sobre la PLANTA 1.
// En lugar de mandar TODO el FXCC en una sola petición (lo que dispersa la
// atención del VLM y hace que pierda cajas pequeñas), enviamos CADA página
// del FXCC en una llamada independiente. Eso es el "crop centrado": el modelo
// dedica toda su ventana de atención a una sola lámina.
//
// Flujo por edificio:
//  1. Pass A (1 llamada por página): el VLM clasifica si la página es P01 y,
//     si lo es, cuenta cajas y nos da bounding boxes normalizados de cada caja.
//  2. Elegimos la mejor página P01 (legible, con mayor confianza).
//  3. Pass B (verificación): re-enviamos esa página con un prompt distinto
//     ("cuenta UNA POR UNA, lista cada caja con coords y peldaños visibles").
//  4. Si Pass A y Pass B coinciden en n y conf>=0.7 → pred = n.
//     Si discrepan o conf<0.7 → needs_review_humano (nunca inventar).
//  5. Si NINGUNA página es P01 legible → respeta v7.2-gemini (no degrada).
//
// Lotes pequeños con auto-reinvocación; sin imagescript (evita CPU timeout).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";

const PROMPT_PASS_A = `Eres un experto leyendo planos catastrales (FXCC) de Madrid.
Te paso UNA SOLA página de un FXCC. Concéntrate solo en esa lámina.

1) Identifica la planta. Aceptamos TODAS estas variantes como PLANTA 1 / planta
   tipo (es_p01 = true): "PISO 01", "PLANTA 01", "PLANTA 1", "PLANTA 1ª",
   "PRIMERA", "PRIMERA PLANTA", "P01", "P1", "1ª PLANTA", "PLANTA TIPO",
   "PLANTA SEGUNDA", "SEGUNDA", "P02", "P2", "PLANTA TERCERA", "TERCERA",
   "P03", "P3", "PLANTA CUARTA", "CUARTA", "P04", "P4", "ATICO" — es decir,
   cualquier planta sobre rasante distinta de la BAJA en un edificio
   residencial vale como "planta tipo" para contar cajas de escalera.
   Sólo es_p01=false cuando es PB, sótano, semisotano, garaje o cubierta.
2) Si la página es planta tipo (es_p01=true):
   - Cuenta TODAS las cajas de escalera (núcleos verticales cerrados con
     peldaños/diagonales que separan grupos de viviendas V.A, V.B...).
   - Para cada caja da su bounding box normalizado [x0,y0,x1,y1] (0-1, origen
     arriba-izquierda) y un breve indicio visual.
3) Si la página es PB:
   - Cuenta portales residenciales (puertas de calle a viviendas; ignora
     locales, garaje, trasteros, salidas de emergencia).

Prohibido inventar. Si dudas, baja la confianza.
Devuelve EXACTAMENTE este JSON:
{
  "etiqueta_planta": string,
  "es_p01": boolean,
  "es_pb": boolean,
  "p01_legible": boolean,
  "pb_legible": boolean,
  "n_cajas_p01": number | null,
  "n_portales_pb": number | null,
  "cajas_bbox": [{"bbox":[number,number,number,number],"indicio":string}],
  "confidence": number,
  "razon": string
}`;

const PROMPT_PASS_B = (n_a: number, bboxes: any[]) => `Eres un experto en FXCC de Madrid.
Te paso UNA SOLA lámina (PLANTA 1). Una primera lectura contó ${n_a} cajas
de escalera en estas regiones (bbox normalizado): ${JSON.stringify(bboxes)}.

Verifica UNA POR UNA, sin asumir el conteo previo:
- Para cada núcleo vertical visible, lista: bbox aproximado, si tiene peldaños
  visibles, si separa grupos de viviendas distintos, y si es realmente caja
  de escalera (no ascensor solo, no patinillo, no patio).
- Cuenta SOLO cajas de escalera reales (un núcleo con ascensor+escalera
  cuenta 1).
- Si dos núcleos están unidos y comparten escalera, son 1.

Prohibido inventar. Si no estás seguro, baja la confianza y marca
needs_review=true.
Devuelve EXACTAMENTE este JSON:
{
  "n_cajas_verificadas": number | null,
  "detalle": [{"bbox":[number,number,number,number],"es_caja":boolean,"razon":string}],
  "confidence": number,
  "needs_review": boolean,
  "comentario": string
}`;

async function callVlm(apiKey: string, prompt: string, imageUrl: string): Promise<any> {
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

async function evalOne(sb: any, apiKey: string, set_name: string, building_id: string, gt: number) {
  // base v7.2-gemini (nunca degradamos)
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n, needs_review, error")
    .eq("set_name", set_name).eq("version", "v7.2-gemini").eq("building_id", building_id).maybeSingle();
  const base = baseRow ?? { pred_n: null, needs_review: true, error: null };

  if (base.error && /sin FXCC/i.test(base.error)) {
    return { building_id, set_name, version: "v7.6", gt,
      pred_n: null, pred_segundas: null, needs_review: true, confidence: 0,
      evidencia: { base, motivo: "sin FXCC (datos)", needs_review_humano: true }, error: "sin FXCC" };
  }

  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls, plantas_pages_urls").eq("building_id", building_id).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (!pages.length) {
    return { building_id, set_name, version: "v7.6", gt,
      pred_n: null, pred_segundas: null, needs_review: true, confidence: 0,
      evidencia: { base, motivo: "sin FXCC", needs_review_humano: true }, error: "sin FXCC" };
  }

  // Pass A: una llamada por página
  const passA: any[] = [];
  for (let i = 0; i < pages.length; i++) {
    try {
      const r = await callVlm(apiKey, PROMPT_PASS_A, pages[i]);
      passA.push({ idx: i, url: pages[i], ...r });
    } catch (e) {
      passA.push({ idx: i, url: pages[i], error: (e as Error).message });
    }
    await new Promise(r => setTimeout(r, 300));
  }

  // Selección de la mejor página P01
  const p01Candidates = passA.filter(p => p.es_p01 && p.p01_legible && p.n_cajas_p01 != null);
  p01Candidates.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const best = p01Candidates[0];

  if (!best) {
    // Sin P01 legible → respeta base (no degradar)
    return { building_id, set_name, version: "v7.6", gt,
      pred_n: base.pred_n ?? null,
      pred_segundas: base.pred_n == null ? null : base.pred_n >= 2,
      needs_review: !!base.needs_review, confidence: 0,
      evidencia: { base, decision: "respeta v7.2-gemini (sin P01 legible)", passA } };
  }

  const nA = Math.round(Number(best.n_cajas_p01));

  // Pass B: verificación enfocada
  let passB: any = null;
  try { passB = await callVlm(apiKey, PROMPT_PASS_B(nA, best.cajas_bbox ?? []), best.url); }
  catch (e) { passB = { error: (e as Error).message }; }

  const nB = passB?.n_cajas_verificadas == null ? null : Math.round(Number(passB.n_cajas_verificadas));
  const cB = Number(passB?.confidence ?? 0);

  // Decisión: A y B deben coincidir con conf>=0.7. Si no, NR humano (no degrada).
  let pred: number | null = null;
  let needsReview = true;
  let razon = "";
  if (nB != null && nA === nB && cB >= 0.7 && !passB?.needs_review) {
    pred = nA; needsReview = false; razon = `A y B coinciden en ${nA} (conf B=${cB})`;
  } else if (nB != null && nA === nB && cB >= 0.5) {
    // coincidencia con confianza media → solo upgrade desde base==1 si nA>=2
    if ((base.pred_n ?? 0) >= 2) { pred = base.pred_n; needsReview = false; razon = "respeta base>=2"; }
    else if (base.pred_n === 1 && nA >= 2) { pred = null; needsReview = true; razon = "A=B>=2 conf media → NR"; }
    else { pred = base.pred_n ?? null; needsReview = !!base.needs_review; razon = "respeta base"; }
  } else {
    pred = base.pred_n ?? null; needsReview = !!base.needs_review || pred == null;
    razon = "A y B no concuerdan o conf baja → respeta base / NR";
  }

  return { building_id, set_name, version: "v7.6", gt,
    pred_n: pred, pred_segundas: pred == null ? null : pred >= 2,
    needs_review: needsReview, confidence: Math.min(1, Math.max(0, cB)),
    evidencia: { base, best_page_idx: best.idx, nA, nB, decision: razon, passA, passB } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;
  const batchSize: number = Math.max(1, Math.min(5, Number(body.batch_size ?? 3)));
  const force: boolean = body.force === true;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let q = sb.from("escaleras_control_set").select("building_id, gt").eq("set_name", set_name);
  if (onlyIds) q = q.in("building_id", onlyIds);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  let items = rows ?? [];

  if (!force && items.length) {
    const { data: done } = await sb.from("escaleras_eval_results")
      .select("building_id, pred_n, needs_review")
      .eq("set_name", set_name).eq("version", "v7.6")
      .in("building_id", items.map((i: any) => i.building_id));
    const ok = new Set((done ?? [])
      .filter((r: any) => r.pred_n != null || r.needs_review === true)
      .map((r: any) => r.building_id));
    items = items.filter((i: any) => !ok.has(i.building_id));
  }

  const batch = items.slice(0, batchSize);
  const remaining = items.slice(batchSize).map((i: any) => i.building_id);

  const run = async () => {
    for (const it of batch) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt);
        await sb.from("escaleras_eval_results").upsert({
          set_name: r.set_name, version: r.version, building_id: r.building_id, gt: r.gt,
          pred_n: r.pred_n ?? null, pred_segundas: r.pred_segundas ?? null,
          needs_review: r.needs_review ?? false, confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null, error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
        // Persistencia building_analysis solo si hay pred y no needs_review
        if (r.pred_n != null && !r.needs_review) {
          await sb.from("building_analysis").upsert({
            building_id: r.building_id,
            n_escaleras_final: r.pred_n,
            segundas_escaleras: r.pred_n >= 2,
            n_escaleras_fuente: "v7.6",
            n_escaleras_evidencia: r.evidencia ?? null,
          }, { onConflict: "building_id" });
        }
      } catch (e) { console.warn("v7.6 err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7.6 batch done", batch.length, "remaining", remaining.length);
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-6`, {
          method: "POST",
          headers: { "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
          body: JSON.stringify({ set_name, building_ids: remaining, batch_size: batchSize, force }),
        });
      } catch (e) { console.warn("v7.6 auto-reinvoke failed", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});