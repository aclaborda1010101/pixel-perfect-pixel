// recount-windows-cal8 — CHUNKED + chained re-invocation
// Procesa 1-2 edificios por invocacion y se auto-reinvoca con los restantes.
// Persiste resultados incrementales en app_settings.recount_windows_cal8_last.results
// y recalcula MAPE sobre los acumulados.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const SV_SIZE = "640x640";
const KEY_OUT = "recount_windows_cal8_last";

const sv = (lat: number, lng: number, h: number, p: number, fov: number, k: string) =>
  `https://maps.googleapis.com/maps/api/streetview?size=${SV_SIZE}&location=${lat},${lng}&heading=${h.toFixed(2)}&fov=${fov}&pitch=${p}&source=outdoor&key=${k}`;

function offsetLatLng(lat: number, lng: number, headingDeg: number, lateralM: number) {
  const bearing = ((headingDeg + 90) * Math.PI) / 180;
  const dLat = (lateralM * Math.cos(bearing)) / 111320;
  const dLng = (lateralM * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

const PROMPT = (plantas: number, oclusionPrev: string | null) => `Arquitecto tecnico. Capturas Street View de la MISMA fachada residencial de Madrid, varios puntos a lo largo. Plantas sobre rasante (Catastro): ${plantas}.

TAREA: cuenta EJES VERTICALES de huecos (columnas continuas).

REGLAS:
- MIRADOR o GALERIA = 1 eje (NO varios), aunque tenga 3 panos de vidrio.
- BALCONERA-VENTANA cuenta; BALCONERA-PUERTA o puerta de portal NO.
- PB con escaparates: no son ejes residenciales; sepáralos en huecos_planta_baja.
- Si fachada muy ocluida por arboles/andamios/coches -> oclusion_alta=true y dime fila_mas_limpia con huecos.
- Si retranqueo o doble cuerpo -> suma ejes principales + retranqueo (cuerpos_independientes=true).
- Prohibido inventar. Si <2 plantas claras -> confianza="baja".

${oclusionPrev ? `(Capturas previas: ${oclusionPrev})\n` : ""}
JSON:
{"huecos_por_planta":[number,...],"ejes_verticales":number,"huecos_planta_baja":number,
 "miradores_detectados":number,"oclusion_alta":boolean,
 "fila_mas_limpia":{"planta":string,"huecos":number}|null,
 "cuerpos_independientes":boolean,"confianza":"alta"|"media"|"baja","comentario":string}`;

async function vlm(apiKey: string, plantas: number, urls: string[], oclusionPrev: string | null) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT(plantas, oclusionPrev) },
        ...urls.map((u) => ({ type: "image_url", image_url: { url: u } })),
      ]}],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}: ${await r.text().catch(() => "")}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

const median = (xs: number[]) => {
  const s = xs.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

async function processOne(sb: any, apiKey: string, gKey: string, bid: string) {
  const { data: fwc } = await sb.from("facade_window_counts")
    .select("street_view_panoramas,final_count,longitud_fachada_total_m,longitud_fachada_m")
    .eq("building_id", bid).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const panos: any[] = Array.isArray(fwc?.street_view_panoramas) ? fwc!.street_view_panoramas : [];
  const { data: b } = await sb.from("buildings").select("id,direccion,refcatastral,catastro_ref").eq("id", bid).maybeSingle();
  const rc14 = String(b?.refcatastral ?? b?.catastro_ref ?? "").substring(0, 14);
  const { data: cac } = await sb.from("catastro_authority_cache").select("numero_plantas").eq("refcatastral_14", rc14).maybeSingle();
  const { data: gt } = await sb.from("facade_window_ground_truth").select("human_count").eq("building_id", bid).maybeSingle();
  const plantas = Number(cac?.numero_plantas ?? 0);
  const plantas_tipo = Math.max(0, plantas - 1);
  const gt_val: number | null = gt?.human_count ?? null;
  const longitud = Number(fwc?.longitud_fachada_total_m ?? fwc?.longitud_fachada_m ?? 0);

  if (!panos.length) return { building_id: bid, error: "sin panos" };

  const byRole: Record<string, any[]> = {};
  for (const p of panos) (byRole[p.role || "principal"] ??= []).push(p);

  // (a) ENCUADRE: 1 paso lateral cada ~12m, MAX 2 puntos (presupuesto 150s)
  const stepsPerFacade = longitud > 0 ? Math.max(1, Math.min(2, Math.ceil(longitud / 12))) : 1;
  const offsets = (() => {
    if (stepsPerFacade <= 1) return [0];
    const span = longitud / 2;
    const arr: number[] = [];
    for (let i = 0; i < stepsPerFacade; i++) {
      const t = (i / (stepsPerFacade - 1)) * 2 - 1;
      arr.push(Math.round(t * span));
    }
    return arr;
  })();

  const facadeResults: any[] = [];
  for (const [role, ps] of Object.entries(byRole)) {
    if (role === "patio") continue;
    const ejesArr: number[] = []; const pbArr: number[] = []; const detalle: any[] = [];
    let lastOclusion: string | null = null;
    for (const p of ps) {
      // limitar panos a 1 por rol para no exceder presupuesto
      const panosUse = ps.slice(0, 1);
      for (const _ of [0]) { void _;
      for (const off of offsets) {
        const { lat, lng } = offsetLatLng(p.lat, p.lng, p.heading, off);
        const headings = [p.heading, (p.heading + 12) % 360]; // 2 en vez de 3
        const urls: string[] = [];
        for (const h of headings) urls.push(sv(lat, lng, h, 15, 70, gKey)); // 1 pitch
        try {
          const v = await vlm(apiKey, plantas_tipo, urls, lastOclusion);
          let ejes = Number(v.ejes_verticales ?? 0);
          const pb = Number(v.huecos_planta_baja ?? 0);
          // (b) OCLUSION: usar fila más limpia como proyección de ejes
          if (v.oclusion_alta && v.fila_mas_limpia && Number.isFinite(Number(v.fila_mas_limpia.huecos))) {
            ejes = Number(v.fila_mas_limpia.huecos);
            lastOclusion = `oclusion alta; fila ${v.fila_mas_limpia.planta} con ${ejes} huecos`;
          }
          if (ejes > 0) ejesArr.push(ejes);
          pbArr.push(pb);
          detalle.push({ role, off, ejes, pb, miradores: v.miradores_detectados, ocl: v.oclusion_alta, fila: v.fila_mas_limpia, conf: v.confianza });
        } catch (e) { detalle.push({ role, off, error: (e as Error).message }); }
        await new Promise(r => setTimeout(r, 300));
      }
      }
    }
    const ejes_med = Math.round(median(ejesArr));
    const pb_med = Math.round(median(pbArr));
    // (c) MIRADORES ya descontados por el prompt; ejes × plantas_tipo + pb
    const total = ejes_med * plantas_tipo + pb_med;
    facadeResults.push({ role, n_panos: ps.length, offsets, ejes_med, pb_med, total, detalle });
  }

  const total_pred = facadeResults.reduce((s, f) => s + f.total, 0);
  const ape = gt_val ? Math.abs(total_pred - gt_val) / gt_val * 100 : null;

  return {
    building_id: bid, direccion: b?.direccion, rc14, plantas, plantas_tipo, longitud_m: longitud,
    gt: gt_val, pred_anterior: fwc?.final_count, pred_cal8: total_pred,
    ape_pct: ape == null ? null : Math.round(ape * 10) / 10,
    within_10pct: ape != null && ape <= 10,
    facades: facadeResults,
  };
}

async function appendResults(sb: any, newRows: any[]) {
  const { data } = await sb.from("app_settings").select("value").eq("key", KEY_OUT).maybeSingle();
  const prev = Array.isArray(data?.value?.results) ? data!.value.results : [];
  // dedupe por building_id (último gana)
  const byId = new Map<string, any>();
  for (const r of prev) byId.set(r.building_id, r);
  for (const r of newRows) byId.set(r.building_id, r);
  const merged = Array.from(byId.values());
  const apes = merged.map((o: any) => o.ape_pct).filter((x: any) => typeof x === "number");
  const mape = apes.length ? Math.round((apes.reduce((s: number, x: number) => s + x, 0) / apes.length) * 10) / 10 : null;
  await sb.from("app_settings").upsert({
    key: KEY_OUT,
    value: { results: merged, mape, n: apes.length, updated_at: new Date().toISOString() } as any,
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
  return { mape, n: apes.length, total: merged.length };
}

async function reinvoke(payload: any) {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/recount-windows-cal8`, {
      method: "POST",
      headers: { "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")! },
      body: JSON.stringify(payload),
    });
  } catch (e) { console.warn("cal8 reinvoke fail", (e as Error).message); }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const gKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey || !gKey) return new Response(JSON.stringify({ error: "missing keys" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let ids: string[] = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : [];
  const reset: boolean = !!body.reset;
  if (!ids.length) {
    const { data: gts } = await sb.from("facade_window_ground_truth").select("building_id").not("human_count", "is", null);
    ids = Array.from(new Set((gts ?? []).map((g: any) => g.building_id))).filter(Boolean) as string[];
  }
  if (reset) {
    await sb.from("app_settings").upsert({
      key: KEY_OUT, value: { results: [], mape: null, n: 0, started_at: new Date().toISOString() } as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
  }

  const batchSize: number = Math.max(1, Math.min(2, Number(body.batch_size ?? 1)));
  const batch = ids.slice(0, batchSize);
  const rest = ids.slice(batchSize);

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil((async () => {
    const out: any[] = [];
    for (const bid of batch) {
      try { out.push(await processOne(sb, apiKey, gKey, bid)); }
      catch (e) { out.push({ building_id: bid, error: (e as Error).message }); }
    }
    const status = await appendResults(sb, out);
    console.log("cal8 batch", { processed: batch.length, remaining: rest.length, ...status });
    if (rest.length) await reinvoke({ building_ids: rest, batch_size: batchSize });
  })());

  return new Response(JSON.stringify({ ok: true, async: true, batch: batch.length, remaining: rest.length }),
    { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
