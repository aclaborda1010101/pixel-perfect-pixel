// eval-escaleras-v7.4
// v7.3-crop + segunda pasada de confirmación cuando n_cajas_p01 >= 2.
// Si el verificador no confirma con confidence >= 0.7 → needs_review.
// Nunca degrada a negativo: no confirmado != "1 caja".

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { Image } from "https://deno.land/x/imagescript@1.2.17/mod.ts";

const PROMPT_COUNT = `Eres un experto en planos catastrales (FXCC) de Madrid.
Tu objetivo es contar las CAJAS DE ESCALERA (núcleos verticales) de un
edificio residencial. Prioriza SIEMPRE la PLANTA 1 sobre la PLANTA BAJA.

1. PLANTA 1 ("PISO 01", "PLANTA 01", "PLANTA 1ª", "PRIMERA").
   - Una "caja de escalera" es un recinto cerrado con peldaños/diagonales
     que separa grupos de viviendas (V.A.*, V.B.*, ...).
   - Cuenta las cajas DISTINTAS. Si hay 2 grupos de viviendas (V.A y V.B)
     servidos por núcleos independientes, son 2 cajas.

2. PLANTA BAJA — secundario. Cuenta portales residenciales reales.

REGLA: P01 legible y >=1 → n_final = n_cajas_p01.
Si NO P01 pero PB legible → n_final = n_portales_pb.
Si ninguna → needs_review = true.
Prohibido inventar.

JSON exacto:
{
  "p01_legible": boolean, "pb_legible": boolean,
  "n_portales_pb": number | null, "n_cajas_p01": number | null,
  "n_final": number | null, "fuente_n_final": "p01"|"pb"|null,
  "needs_review": boolean, "confidence": number, "razonamiento": string
}`;

const PROMPT_VERIFY = `VERIFICACIÓN ESTRICTA. Una pasada anterior afirma que este
edificio tiene 2 O MÁS cajas de escalera independientes en planta 1.
Confirma o refuta con evidencia visual EXPLÍCITA.

Para confirmar "n_cajas >= 2" debe cumplirse TODO:
(a) Hay 2+ núcleos verticales DISTINTOS y físicamente separados en P01
    (cada uno con peldaños/diagonales propias, no compartidos).
(b) Sirven a GRUPOS DE VIVIENDAS DIFERENTES (V.A.* vs V.B.*, o portales
    distintos), no a las mismas viviendas por accesos redundantes.
(c) Las viviendas no comparten núcleo (no es un solo COM.V que sirve a
    todas las viviendas de la planta).

Si DUDAS en CUALQUIERA de (a)(b)(c) → confirmed=false, confidence_low=true.
Un único núcleo COM.V con varias viviendas (V.A, V.B, V.C...) NO confirma
2 cajas: confirmed=false.

Devuelve EXACTAMENTE:
{
  "confirmed": boolean,
  "n_cajas_verificadas": number | null,
  "evidencia_a_distintos_nucleos": boolean,
  "evidencia_b_grupos_distintos": boolean,
  "evidencia_c_no_comparten": boolean,
  "confidence": number,
  "razon": string
}`;

function ab2b64(buf: Uint8Array): string {
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return btoa(bin);
}

async function cropUpscale(url: string): Promise<string | null> {
  try {
    const r = await fetch(url); if (!r.ok) return null;
    const img = await Image.decode(new Uint8Array(await r.arrayBuffer()));
    const w = img.width, h = img.height;
    const cw = Math.max(1, Math.floor(w*0.6)), ch = Math.max(1, Math.floor(h*0.6));
    const x = Math.floor((w-cw)/2), y = Math.floor((h-ch)/2);
    const c = img.crop(x,y,cw,ch); c.resize(cw*2, ch*2);
    return `data:image/jpeg;base64,${ab2b64(await c.encodeJPEG(85))}`;
  } catch { return null; }
}

async function callVlm(apiKey: string, prompt: string, urls: string[]): Promise<any> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-pro",
      messages: [{ role: "user", content: [
        { type: "text", text: prompt },
        ...urls.map(u => ({ type: "image_url", image_url: { url: u } })),
      ]}],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

async function evalOne(sb: any, apiKey: string, set_name: string, building_id: string, gt: number) {
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls, plantas_pages_urls").eq("building_id", building_id).maybeSingle();
  const pages: string[] = Array.isArray(cat?.fxcc_pages_urls) && cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls) ? cat!.plantas_pages_urls : []);
  if (pages.length === 0) return { building_id, set_name, version: "v7.4", gt, error: "sin FXCC", needs_review: true };

  const processed: string[] = [];
  for (const u of pages) { const d = await cropUpscale(u); if (d) processed.push(d); }
  if (!processed.length) return { building_id, set_name, version: "v7.4", gt, error: "preproceso falló", needs_review: true };

  let p1: any = null, lastErr: string | null = null;
  for (let a = 0; a < 2 && !p1; a++) {
    try { p1 = await callVlm(apiKey, PROMPT_COUNT, processed); }
    catch (e) { lastErr = (e as Error).message; await new Promise(r => setTimeout(r, 1500)); }
  }
  if (!p1) return { building_id, set_name, version: "v7.4", gt, error: lastErr ?? "VLM error", needs_review: true };

  const nC = p1.n_cajas_p01 == null ? null : Math.round(Number(p1.n_cajas_p01));
  const nP = p1.n_portales_pb == null ? null : Math.round(Number(p1.n_portales_pb));
  const p01Leg = Boolean(p1.p01_legible), pbLeg = Boolean(p1.pb_legible);
  let nFinal: number | null = null;
  let fuente: "p01"|"pb"|null = null;
  if (p01Leg && nC != null && nC >= 1) { nFinal = nC; fuente = "p01"; }
  else if (!p01Leg && pbLeg && nP != null && nP >= 1) { nFinal = nP; fuente = "pb"; }
  nFinal = nFinal == null ? null : Math.max(1, Math.min(8, nFinal));

  // Segunda pasada SOLO si nFinal >= 2 desde P01.
  let verify: any = null;
  let downgradedToNR = false;
  if (nFinal != null && nFinal >= 2 && fuente === "p01") {
    try { verify = await callVlm(apiKey, PROMPT_VERIFY, processed); }
    catch (e) { verify = { error: (e as Error).message }; }
    const vconf = Math.max(0, Math.min(1, Number(verify?.confidence ?? 0)));
    const confirmed = Boolean(verify?.confirmed) && verify?.evidencia_a_distintos_nucleos && verify?.evidencia_b_grupos_distintos && verify?.evidencia_c_no_comparten;
    if (!confirmed || vconf < 0.7) {
      // No confirmar → needs_review. NUNCA degradar a 1.
      downgradedToNR = true;
      nFinal = null;
    }
  }

  const needsReview = nFinal == null;
  const predSegundas = nFinal == null ? null : (nFinal >= 2);
  const conf = Math.max(0, Math.min(1, Number(p1.confidence ?? 0)));

  return {
    building_id, set_name, version: "v7.4", gt,
    pred_n: nFinal, pred_segundas: predSegundas,
    needs_review: needsReview, confidence: conf,
    evidencia: { p1, verify, downgradedToNR, fuente, modelo: "google/gemini-2.5-pro", preproceso: "v7.3-crop+verify-strict" },
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
      } catch (e) { console.warn("v7.4 err", it.building_id, (e as Error).message); }
      await new Promise(r => setTimeout(r, 400));
    }
    console.log("eval-escaleras-v7.4 done");
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, queued: items.length }), {
    status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});