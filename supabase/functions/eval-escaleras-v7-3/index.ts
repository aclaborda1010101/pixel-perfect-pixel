// eval-escaleras-v7.3
// Proxy barato de crop geométrico: descarga cada página FXCC, center-crop 60%
// + upscale 2x (sin geometría real). Reusa el prompt v7.2 (P01-first) y
// google/gemini-2.5-pro como modelo principal. Mide en ctrl_10x10_v1.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const PROMPT_V72 = `Eres un experto en planos catastrales (FXCC) de Madrid.
Tu objetivo es contar las CAJAS DE ESCALERA (núcleos verticales) de un
edificio residencial. Prioriza SIEMPRE la PLANTA 1 sobre la PLANTA BAJA.

1. PLANTA 1 ("PISO 01", "PLANTA 01", "PLANTA 1ª", "PRIMERA").
   - Una "caja de escalera" es un recinto cerrado con peldaños/diagonales
     que separa grupos de viviendas (V.A.*, V.B.*, ...).
   - Cuenta las cajas DISTINTAS. Si hay 2 grupos de viviendas (V.A y V.B)
     servidos por núcleos independientes, son 2 cajas.
   - Llama "n_cajas_p01" al número de cajas que veas en P01.
   - Marca "p01_legible" = true si la planta es clara, false si no.

2. PLANTA BAJA ("PB", "PLANTA BAJA", "P. BAJA", "BAJA") — SECUNDARIO.
   - Cuenta SOLO portales residenciales (ignora locales, garaje, trasteros).
   - Llama "n_portales_pb" al número de portales residenciales.
   - Marca "pb_legible" = true/false.

REGLA DE DECISIÓN (estricta):
- Si p01_legible y n_cajas_p01 >=1 → n_final = n_cajas_p01.
- Si NO p01_legible pero pb_legible y n_portales_pb >=1 → n_final = n_portales_pb.
- Si ninguna legible → n_final = null, needs_review = true.
- Prohibido inventar.

Devuelve EXACTAMENTE este JSON:
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

function ab2b64(buf: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

async function cropUpscale(url: string): Promise<string | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const bytes = new Uint8Array(await r.arrayBuffer());
    const img = await Image.decode(bytes);
    const w = img.width, h = img.height;
    const cw = Math.max(1, Math.floor(w * 0.6));
    const ch = Math.max(1, Math.floor(h * 0.6));
    const x = Math.floor((w - cw) / 2);
    const y = Math.floor((h - ch) / 2);
    const cropped = img.crop(x, y, cw, ch);
    // Upscale 2x del tile recortado
    cropped.resize(cw * 2, ch * 2);
    const out = await cropped.encodeJPEG(85);
    return `data:image/jpeg;base64,${ab2b64(out)}`;
  } catch (e) {
    console.warn("cropUpscale error", url, (e as Error).message);
    return null;
  }
}

async function callGateway(apiKey: string, model: string, imageDataUrls: string[]): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: PROMPT_V72 },
          ...imageDataUrls.map((url) => ({ type: "image_url", image_url: { url } })),
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
    return { building_id, set_name, version: "v7.3-crop", gt, error: "sin FXCC", needs_review: true };
  }

  // Preprocesado: center-crop 60% + upscale 2x para todas las páginas.
  const processed: string[] = [];
  for (const url of pages) {
    const d = await cropUpscale(url);
    if (d) processed.push(d);
  }
  if (processed.length === 0) {
    return { building_id, set_name, version: "v7.3-crop", gt, error: "preproceso falló", needs_review: true };
  }

  let parsed: any = null;
  let lastErr: string | null = null;
  const modelo = "google/gemini-2.5-pro";
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    try { parsed = await callGateway(apiKey, modelo, processed); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!parsed) return { building_id, set_name, version: "v7.3-crop", gt, error: lastErr ?? "VLM sin respuesta", needs_review: true };

  const nP = parsed.n_portales_pb == null ? null : Math.round(Number(parsed.n_portales_pb));
  const nC = parsed.n_cajas_p01 == null ? null : Math.round(Number(parsed.n_cajas_p01));
  const p01Leg = Boolean(parsed.p01_legible);
  const pbLeg = Boolean(parsed.pb_legible);
  let nFinal: number | null = null;
  let fuente: "p01" | "pb" | null = null;
  if (p01Leg && nC != null && nC >= 1) { nFinal = nC; fuente = "p01"; }
  else if (!p01Leg && pbLeg && nP != null && nP >= 1) { nFinal = nP; fuente = "pb"; }
  else if (parsed.n_final != null && Number.isFinite(Number(parsed.n_final))) {
    nFinal = Math.round(Number(parsed.n_final));
    fuente = parsed.fuente_n_final === "pb" ? "pb" : "p01";
  }
  nFinal = nFinal == null ? null : Math.max(1, Math.min(8, nFinal));
  const conf: number = Math.max(0, Math.min(1, Number(parsed.confidence ?? 0)));
  const needsReview = nFinal == null;
  const predSegundas = nFinal != null && nFinal >= 2 ? true : (nFinal === 1 ? false : null);

  return {
    building_id, set_name, version: "v7.3-crop", gt,
    pred_n: nFinal, pred_segundas: predSegundas,
    needs_review: needsReview, confidence: conf,
    evidencia: { ...parsed, modelo, preproceso: "center-crop-60-upscale-2x", fuente_efectiva: fuente },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: "LOVABLE_API_KEY missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const set_name: string = body.set_name ?? "ctrl_10x10_v1";
  const onlyIds: string[] | null = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : null;

  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let q = sb.from("escaleras_control_set").select("building_id, gt").eq("set_name", set_name);
  if (onlyIds) q = q.in("building_id", onlyIds);
  const { data: rows, error } = await q;
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
      } catch (e) { console.warn("v7.3 error", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7.3 done");
  };
  // @ts-ignore
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, queued: items.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});