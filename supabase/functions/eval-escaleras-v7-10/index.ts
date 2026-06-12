// eval-escaleras-v7.10 — Portales-PB como señal AUXILIAR sobre v7.2-gemini.
// Estrategia: parte de la predicción v7.2-gemini; SI pred<2 o needs_review,
// localiza la lámina de PLANTA BAJA en el FXCC y pide al VLM que cuente
// portales/cajas verticales que arrancan en PB hacia calle (excluye locales,
// trasteros, ascensores, patinillos). Si portales_pb>=2 con confianza>=0.75,
// promueve pred_n=portales_pb (capado a 4). Nunca degrada un pred válido
// de v7.2 (>=2 con conf>=0.7). Si no hay señal fiable → needs_review.
// Escribe solo en escaleras_eval_results version='v7.10-portales-pb'.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const VERSION = "v7.10-portales-pb";

const PROMPT = `Eres experto en FXCC catastral de Madrid. Te paso UNA lámina.
TAREA:
1) Identifica la planta. es_pb=true si es PLANTA BAJA / BAJA / P00 / PB / SÓTANO no, sino ENTRANTE de calle.
2) Si es_pb=true: cuenta PORTALES (accesos verticales que arrancan aquí y suben:
   núcleos con escalera o caja vertical etiquetada COM.V/COM.VA-D/ESC/ESCALERA/E1-E4/NÚCLEO,
   o un acceso con puerta hacia vía pública seguido de caja vertical/ascensor).
   NO cuentes: locales comerciales, portales de garaje en sótano, trasteros,
   patios, patinillos sueltos.
JSON estricto:
{"etiqueta_planta":string,"es_pb":bool,"pb_legible":bool,
 "portales_pb":number|null,
 "tokens_vistos":[string],
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

async function evalOne(sb: any, apiKey: string, set_name: string, bid: string) {
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n,needs_review,confidence,evidencia,error").eq("set_name", set_name)
    .eq("version", "v7.2-gemini").eq("building_id", bid).maybeSingle();
  const base = baseRow ?? { pred_n: null, needs_review: true, confidence: 0, error: null };
  const basePred = (typeof base.pred_n === "number") ? base.pred_n : null;
  const baseConf = Number(base.confidence ?? 0);
  const baseStrong = basePred != null && basePred >= 2 && baseConf >= 0.7;

  if (baseStrong) {
    return { pred_n: basePred, needs_review: false, confidence: baseConf,
      evidencia: { source: "v7.2_strong", base }, error: null };
  }

  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id", bid).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (!pages.length) {
    return { pred_n: basePred, needs_review: true, confidence: baseConf,
      evidencia: { source: "no_fxcc", base }, error: "sin FXCC" };
  }

  const pass: any[] = [];
  for (let i = 0; i < pages.length; i++) {
    try { pass.push({ idx: i, ...(await vlm(apiKey, pages[i])) }); }
    catch (e) { pass.push({ idx: i, error: (e as Error).message }); }
    await new Promise(r => setTimeout(r, 250));
  }
  const pbs = pass.filter(p => p.es_pb && p.pb_legible && typeof p.portales_pb === "number");
  pbs.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  const bestPb = pbs[0];
  const portales = bestPb ? Math.min(4, Math.max(0, Math.round(bestPb.portales_pb))) : null;

  // Decisión combinada
  if (portales != null && portales >= 2 && (bestPb!.confidence ?? 0) >= 0.75) {
    return { pred_n: portales, needs_review: false, confidence: 0.8,
      evidencia: { source: "portales_pb", portales, basePred, baseConf, bestPb, pass }, error: null };
  }
  // Sin señal fuerte de portales: respeta v7.2 si existía
  if (basePred != null) {
    return { pred_n: basePred, needs_review: base.needs_review ?? false, confidence: baseConf,
      evidencia: { source: "fallback_v7_2", basePred, baseConf, portales, bestPb, pass }, error: null };
  }
  return { pred_n: null, needs_review: true, confidence: 0.3,
    evidencia: { source: "ambiguo", portales, bestPb, pass }, error: null };
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
      } catch (e) { console.warn("v7.10 err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 300));
    }
    console.log("v7.10 batch done", batch.length, "remaining", remaining.length);
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-10`, {
          method: "POST",
          headers: { "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
          body: JSON.stringify({ set_name, building_ids: remaining, batch_size: batchSize, force }),
        });
      } catch (e) { console.warn("v7.10 reinvoke fail", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: remaining.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});