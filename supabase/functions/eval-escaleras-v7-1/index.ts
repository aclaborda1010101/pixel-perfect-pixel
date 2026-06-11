// eval-escaleras-v7.1
// Versión menos conservadora de v7: acepta n_portales_pb == n_cajas_p01 como
// predicción, aunque la correspondencia espacial no sea explícita.
// needs_review SOLO si: sin FXCC, conteos discrepan, plano ilegible o el VLM
// no devuelve un n_final entero válido.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PROMPT_V71 = `Eres un experto en planos catastrales (FXCC) de Madrid.
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

REGLAS:
- Si n_portales_pb == n_cajas_p01, ESE es n_final (sin importar si puedes
  trazar la correspondencia espacial exacta — basta con que ambos planos
  coincidan en el conteo).
- Si discrepan: needs_review=true, n_final=null.
- Si no encuentras página de PB o de P01: needs_review=true, n_final=null.
- Si la imagen está cortada/borrosa: needs_review=true, n_final=null.
- NO inventes. Solo devuelve n_final cuando los DOS conteos cuadren.

Devuelve EXACTAMENTE este JSON (sin texto fuera):
{
  "pagina_pb_etiqueta": string | null,
  "pagina_p01_etiqueta": string | null,
  "n_portales_pb": number | null,
  "n_cajas_p01": number | null,
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
          { type: "text", text: PROMPT_V71 },
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
    return { building_id, set_name, version: "v7.1", gt, error: "sin FXCC", needs_review: true };
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
  if (!parsed) return { building_id, set_name, version: "v7.1", gt, error: lastErr ?? "VLM sin respuesta", needs_review: true };

  const nP = parsed.n_portales_pb == null ? null : Math.round(Number(parsed.n_portales_pb));
  const nC = parsed.n_cajas_p01 == null ? null : Math.round(Number(parsed.n_cajas_p01));
  let nFinal: number | null = parsed.n_final == null ? null : Math.round(Number(parsed.n_final));
  // Regla v7.1 server-side: si VLM marca needs_review pero n_portales == n_cajas y >0, aceptamos.
  if ((nFinal == null || !Number.isFinite(nFinal)) && nP != null && nC != null && nP === nC && nP > 0) {
    nFinal = nP;
  }
  nFinal = nFinal == null ? null : Math.max(1, Math.min(8, nFinal));
  const conf: number = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  const needsReview = nFinal == null;
  const predSegundas = nFinal != null && nFinal >= 2 ? true : (nFinal === 1 ? false : null);

  return {
    building_id,
    set_name,
    version: "v7.1",
    gt,
    pred_n: nFinal,
    pred_segundas: predSegundas,
    needs_review: needsReview,
    confidence: conf,
    evidencia: { ...parsed, modelo, n_portales_pb_round: nP, n_cajas_p01_round: nC },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: rows, error } = await sb.from("escaleras_control_set")
    .select("building_id, gt").eq("set_name", set_name);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const items = rows ?? [];

  const run = async () => {
    for (const it of items) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt);
        await sb.from("escaleras_eval_results").upsert({
          set_name: r.set_name, version: r.version, building_id: r.building_id, gt: r.gt,
          pred_n: r.pred_n ?? null, pred_segundas: r.pred_segundas ?? null,
          needs_review: r.needs_review ?? false, confidence: r.confidence ?? null,
          evidencia: r.evidencia ?? null, error: r.error ?? null,
        }, { onConflict: "set_name,version,building_id" });
      } catch (e) { console.warn("v7.1 error", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7.1 done");
  };
  // @ts-ignore
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, queued: items.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});