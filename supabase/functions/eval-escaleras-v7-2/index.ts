// eval-escaleras-v7.2
// Estrategia P01-first: n_final = n_cajas_p01. PB solo desempata cuando
// P01 es ambiguo/ilegible o no hay página de P01. needs_review solo cuando
// el VLM no devuelve un entero válido o ambas plantas son ilegibles.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PROMPT_V72 = `Eres un experto en planos catastrales (FXCC) de Madrid.
Tu objetivo es contar las CAJAS DE ESCALERA (núcleos verticales) de un
edificio residencial. Prioriza SIEMPRE la PLANTA 1 sobre la PLANTA BAJA.

1. PLANTA 1 ("PISO 01", "PLANTA 01", "PLANTA 1ª", "PRIMERA").
   - Una "caja de escalera" es un recinto cerrado con peldaños/diagonales
     que separa grupos de viviendas (V.A.*, V.B.*, ...).
   - Cuenta las cajas DISTINTAS. Si hay 2 grupos de viviendas (V.A y V.B)
     servidos por núcleos independientes, son 2 cajas.
   - Llama "n_cajas_p01" al número de cajas que veas en P01.
   - Marca "p01_legible" = true si la planta es clara, false si está
     cortada/borrosa/ausente.

2. PLANTA BAJA ("PB", "PLANTA BAJA", "P. BAJA", "BAJA") — SECUNDARIO.
   - Cuenta SOLO portales residenciales (puertas de calle a viviendas;
     ignora locales, garaje, trasteros, salidas de emergencia).
   - Llama "n_portales_pb" al número de portales residenciales.
   - Marca "pb_legible" = true/false.

REGLA DE DECISIÓN (estricta):
- Si p01_legible y n_cajas_p01 es un entero >=1 → n_final = n_cajas_p01.
- Si NO p01_legible pero pb_legible y n_portales_pb es entero >=1
  → n_final = n_portales_pb (PB como tie-breaker).
- Si ninguna planta es legible → n_final = null, needs_review = true.
- NO devuelvas n_final si no estás seguro del recuento de P01 (o de PB en su
  caso). Prohibido inventar.

Devuelve EXACTAMENTE este JSON (sin texto fuera):
{
  "pagina_pb_etiqueta": string | null,
  "pagina_p01_etiqueta": string | null,
  "p01_legible": boolean,
  "pb_legible": boolean,
  "n_portales_pb": number | null,
  "n_cajas_p01": number | null,
  "n_final": number | null,
  "fuente_n_final": "p01" | "pb" | null,
  "needs_review": boolean,
  "confidence": number,
  "razonamiento": string
}`;

async function callGateway(apiKey: string, model: string, imageUrls: string[]): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT_V72 },
          ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } })),
        ],
      }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gateway ${r.status} ${await r.text().catch(() => "")}`);
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content ?? "";
  try { return JSON.parse(txt); } catch { throw new Error("JSON inválido"); }
}

async function evalOne(sb: any, apiKey: string, set_name: string, building_id: string, gt: number, opts: { version: string; primaryModel: string; fallbackModel?: string | null }) {
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls, plantas_pages_urls").eq("building_id", building_id).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls
    : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (pages.length === 0) {
    return { building_id, set_name, version: opts.version, gt, error: "sin FXCC", needs_review: true };
  }
  let parsed: any = null;
  let lastErr: string | null = null;
  let modelo = opts.primaryModel;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try { parsed = await callGateway(apiKey, modelo, pages); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!parsed && opts.fallbackModel) {
    modelo = opts.fallbackModel;
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try { parsed = await callGateway(apiKey, modelo, pages); }
      catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
    }
  }
  if (!parsed) return { building_id, set_name, version: opts.version, gt, error: lastErr ?? "VLM sin respuesta", needs_review: true };

  const nP = parsed.n_portales_pb == null ? null : Math.round(Number(parsed.n_portales_pb));
  const nC = parsed.n_cajas_p01 == null ? null : Math.round(Number(parsed.n_cajas_p01));
  const p01Leg = Boolean(parsed.p01_legible);
  const pbLeg = Boolean(parsed.pb_legible);

  // Regla P01-first server-side (no nos fiamos solo de lo que diga el VLM).
  let nFinal: number | null = null;
  let fuente: "p01" | "pb" | null = null;
  if (p01Leg && nC != null && Number.isFinite(nC) && nC >= 1) {
    nFinal = nC; fuente = "p01";
  } else if (!p01Leg && pbLeg && nP != null && Number.isFinite(nP) && nP >= 1) {
    nFinal = nP; fuente = "pb";
  } else if (parsed.n_final != null && Number.isFinite(Number(parsed.n_final))) {
    // Fallback: respeta n_final del VLM si nuestra regla no decide.
    nFinal = Math.round(Number(parsed.n_final));
    fuente = (parsed.fuente_n_final === "pb" ? "pb" : "p01");
  }
  nFinal = nFinal == null ? null : Math.max(1, Math.min(8, nFinal));
  const conf: number = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  const needsReview = nFinal == null;
  const predSegundas = nFinal != null && nFinal >= 2 ? true : (nFinal === 1 ? false : null);

  return {
    building_id,
    set_name,
    version: opts.version,
    gt,
    pred_n: nFinal,
    pred_segundas: predSegundas,
    needs_review: needsReview,
    confidence: conf,
    evidencia: { ...parsed, modelo, fuente_efectiva: fuente, n_portales_pb_round: nP, n_cajas_p01_round: nC },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;
  const version: string = body.version ?? "v7.2";
  const primaryModel: string = body.primary_model ?? "google/gemini-3.1-pro-preview";
  const fallbackModel: string | null = body.fallback_model === undefined ? "google/gemini-2.5-pro" : body.fallback_model;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let q = sb.from("escaleras_control_set").select("building_id, gt").eq("set_name", set_name);
  if (onlyIds) q = q.in("building_id", onlyIds);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const items = rows ?? [];

  const run = async () => {
    for (const it of items) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt, { version, primaryModel, fallbackModel });
        await sb.from("escaleras_eval_results").upsert({
          set_name: r.set_name, version: r.version, building_id: r.building_id, gt: r.gt,
          pred_n: r.pred_n ?? null, pred_segundas: r.pred_segundas ?? null,
          needs_review: r.needs_review ?? false, confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null, error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
      } catch (e) { console.warn("v7.2 error", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7.2 done");
  };
  // @ts-ignore
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, queued: items.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});