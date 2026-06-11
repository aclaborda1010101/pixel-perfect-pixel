// eval-escaleras-v7
// Detector de escaleras v7: VLM con PLANTA BAJA + PLANTA 1 + correspondencia
// portal <-> caja de escalera. Diseñado SOLO para correr contra el set de
// control (escaleras_control_set). NO escribe building_analysis. Si la
// correspondencia no es nítida o la confianza es baja -> needs_review=true.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PROMPT_V7 = `Eres un experto en planos catastrales (FXCC) de Madrid.
Tu tarea es contar las CAJAS DE ESCALERA (núcleos verticales) de un edificio
residencial cruzando DOS plantas distintas:

1. PLANTA BAJA ("PB", "PLANTA BAJA", "P. BAJA", "BAJA").
   - Cuenta SOLO los portales residenciales: una puerta de calle que da paso
     a un zaguán/portal que lleva a las viviendas (ignora locales comerciales,
     trasteros, accesos de garaje, salidas de emergencia).
   - Llama "n_portales_pb" al número de portales residenciales independientes.

2. PLANTA 1 ("PISO 01", "PLANTA 01", "PLANTA 1ª", "PRIMERA").
   - Cuenta cajas de escalera: recintos cerrados con peldaños/diagonales que
     separan grupos de viviendas (V.A.*, V.B.*, ...).
   - Llama "n_cajas_p01" al número de cajas DISTINTAS.

3. CORRESPONDENCIA: cada portal de PB debe llevar a una caja de escalera de
   P01. Si n_portales_pb == n_cajas_p01 y la posición coincide (norte/sur,
   este/oeste), la correspondencia es CLARA.

REGLAS ESTRICTAS:
- Si NO encuentras una página claramente etiquetada como PB o P01, marca
  needs_review=true y confidence<=0.5.
- Si n_portales_pb != n_cajas_p01, marca needs_review=true.
- Si la imagen está cortada/borrosa o no puedes ver el portal completo,
  needs_review=true.
- NO INVENTES. Prohibido devolver n_final si no estás seguro.
- n_final = min(n_portales_pb, n_cajas_p01) cuando ambos coinciden y la
  correspondencia es clara. Si discrepan, devuelves n_final=null y
  needs_review=true.

Devuelve EXACTAMENTE este JSON (sin texto fuera):
{
  "pagina_pb_index": number | null,
  "pagina_pb_etiqueta": string | null,
  "pagina_p01_index": number | null,
  "pagina_p01_etiqueta": string | null,
  "n_portales_pb": number | null,
  "n_cajas_p01": number | null,
  "correspondencia_clara": boolean,
  "n_final": number | null,
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
          { type: "text", text: PROMPT_V7 },
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

async function evalOne(sb: any, apiKey: string, set_name: string, building_id: string, gt: number) {
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls, plantas_pages_urls").eq("building_id", building_id).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls
    : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (pages.length === 0) {
    return { building_id, set_name, version: "v7", gt, error: "sin FXCC", needs_review: true };
  }
  let parsed: any = null;
  let lastErr: string | null = null;
  let modelo = "google/gemini-3.1-pro-preview";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try { parsed = await callGateway(apiKey, modelo, pages); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!parsed) {
    modelo = "google/gemini-2.5-pro";
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      try { parsed = await callGateway(apiKey, modelo, pages); }
      catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
    }
  }
  if (!parsed) return { building_id, set_name, version: "v7", gt, error: lastErr ?? "VLM sin respuesta", needs_review: true };

  const nFinal: number | null = parsed.n_final == null ? null : Math.max(1, Math.min(8, Math.round(Number(parsed.n_final))));
  const conf: number = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  const corrClara = Boolean(parsed.correspondencia_clara);
  // Política conservadora: needs_review si el VLM lo pide, o si la
  // correspondencia no es clara, o si la confianza < 0.75.
  const needsReview = Boolean(parsed.needs_review) || !corrClara || conf < 0.75 || nFinal == null;
  const predSegundas = nFinal != null && nFinal >= 2 ? true : (nFinal === 1 ? false : null);

  return {
    building_id,
    set_name,
    version: "v7",
    gt,
    pred_n: nFinal,
    pred_segundas: predSegundas,
    needs_review: needsReview,
    confidence: conf,
    evidencia: { ...parsed, modelo },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const asyncMode: boolean = body.async === true;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: rows, error } = await sb.from("escaleras_control_set")
    .select("building_id, gt").eq("set_name", set_name);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const items = rows ?? [];

  const run = async () => {
    const out: any[] = [];
    for (const it of items) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt);
        await sb.from("escaleras_eval_results").upsert({
          set_name: r.set_name,
          version: r.version,
          building_id: r.building_id,
          gt: r.gt,
          pred_n: r.pred_n ?? null,
          pred_segundas: r.pred_segundas ?? null,
          needs_review: r.needs_review ?? false,
          confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null,
          error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
        out.push(r);
      } catch (e) {
        out.push({ building_id: it.building_id, error: (e as Error).message });
      }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7 done", JSON.stringify({ total: out.length }));
    return out;
  };

  if (asyncMode) {
    // @ts-ignore EdgeRuntime
    EdgeRuntime.waitUntil(run());
    return new Response(JSON.stringify({ ok: true, async: true, queued: items.length }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const results = await run();
  return new Response(JSON.stringify({ ok: true, total: results.length, results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});