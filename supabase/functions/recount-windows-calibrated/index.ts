// recount-windows-calibrated
// Calibración por planta: para cada pano ya capturado (lat/lng/heading) re-pide
// 3 zooms verticales de Street View (pitch alto/medio/bajo, FOV reducido) y
// pide al VLM ejes_por_planta en CADA banda. Combina:
//   ejes_facade = mediana(ejes_visibles) por pano, máximo entre bandas
//   total_facade = round(ejes_facade × plantas_sobre_rasante) + huecos_PB_obs
//   total_edificio = suma_facades (corner = principal + secundaria)
//   cap: clamp(total, ejes×plantas×0.85, ejes×plantas×1.15) — ancla a Catastro
// Reporta APE vs qa_ground_truth.ventanas_fachada.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const SV_SIZE = "640x640";

function svUrl(lat: number, lng: number, heading: number, pitch: number, fov: number, key: string) {
  return `https://maps.googleapis.com/maps/api/streetview?size=${SV_SIZE}&location=${lat},${lng}&heading=${heading.toFixed(2)}&fov=${fov}&pitch=${pitch}&source=outdoor&key=${key}`;
}

const PROMPT = (plantas: number) => `Eres arquitecto técnico. Te paso 3 capturas verticales (zoom por banda: alta, media, baja) de la MISMA fachada residencial en Madrid desde el MISMO punto. Plantas sobre rasante (Catastro, vinculante): ${plantas}.

Tarea: cuenta ejes verticales de huecos (ventanas + balconeras + miradores; NO puertas, NO escaparates de portal, NO respiraderos). Para CADA planta visible da el número de huecos contados en esa planta. Usa la banda donde la planta esté más limpia (sin árbol/toldo).

Devuelve EXCLUSIVAMENTE JSON:
{
  "huecos_por_planta": [number,...],   // longitud ≤ ${plantas+1} (BJ + plantas tipo)
  "ejes_verticales": number,           // máximo nº de columnas alineadas verticalmente
  "huecos_planta_baja": number,        // SOLO huecos PB (excluye puerta portal)
  "confianza": "alta"|"media"|"baja",
  "comentario": string
}
Prohibido inventar. Si <2 plantas claras, confianza="baja".`;

async function vlm(apiKey: string, plantas: number, urls: string[]) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: [
        { type: "text", text: PROMPT(plantas) },
        ...urls.map(u => ({ type: "image_url", image_url: { url: u } })),
      ]}],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`gw ${r.status}: ${await r.text().catch(()=> '')}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

const median = (xs: number[]) => { const s=[...xs].filter(n=>Number.isFinite(n)).sort((a,b)=>a-b); if(!s.length) return 0; const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const gKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey || !gKey) return new Response(JSON.stringify({ error: "missing keys" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = body.building_ids ?? ["f62fef57-e8cc-43fe-bb5a-fba80980d487","3402ffbd-8dbe-4257-8132-8730f3c2ba2a"];
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const run = async () => {
    const out: any[] = [];
    for (const bid of ids) {
    try {
      const { data: fwc } = await sb.from("facade_window_counts").select("street_view_panoramas, final_count, ejes_verticales").eq("building_id", bid).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const panos: any[] = Array.isArray(fwc?.street_view_panoramas) ? fwc!.street_view_panoramas : [];
      const { data: b } = await sb.from("buildings").select("id, direccion, refcatastral, catastro_ref").eq("id", bid).maybeSingle();
      const rc14 = (b?.refcatastral ?? b?.catastro_ref ?? "").substring(0,14);
      const { data: cac } = await sb.from("catastro_authority_cache").select("numero_plantas").eq("refcatastral_14", rc14).maybeSingle();
      const { data: pgc } = await sb.from("parcel_geometry_cache").select("is_corner, corner_type").eq("refcatastral_14", rc14).maybeSingle();
      const { data: gt } = await sb.from("qa_ground_truth").select("ventanas_fachada").eq("building_id", bid).maybeSingle();
      const plantas = Number(cac?.numero_plantas ?? 0); // incluye BJ
      const plantas_tipo = Math.max(0, plantas - 1);
      const gt_val = gt?.ventanas_fachada ?? null;

      // Agrupar panos por role
      const byRole: Record<string, any[]> = {};
      for (const p of panos) { (byRole[p.role || "principal"] ??= []).push(p); }
      const facadeResults: any[] = [];
      for (const [role, ps] of Object.entries(byRole)) {
        const ejesArr: number[] = []; const pbArr: number[] = []; const detalle: any[] = [];
        for (const p of ps) {
          const urls = [
            svUrl(p.lat, p.lng, p.heading, 25, 60, gKey),  // alta (último piso/áticos)
            svUrl(p.lat, p.lng, p.heading, 10, 75, gKey),  // media
            svUrl(p.lat, p.lng, p.heading, -2, 80, gKey),  // baja (PB+entresuelo)
          ];
          try {
            const v = await vlm(apiKey, plantas_tipo, urls);
            const ejes = Number(v.ejes_verticales ?? 0);
            const pb = Number(v.huecos_planta_baja ?? 0);
            if (ejes > 0) ejesArr.push(ejes);
            pbArr.push(pb);
            detalle.push({ heading: p.heading, ejes, pb, huecos_por_planta: v.huecos_por_planta, conf: v.confianza });
          } catch (e) { detalle.push({ heading: p.heading, error: (e as Error).message }); }
          await new Promise(r => setTimeout(r, 400));
        }
        const ejes_med = Math.round(median(ejesArr));
        const pb_med = Math.round(median(pbArr));
        const total_raw = ejes_med * plantas_tipo + pb_med;
        const lo = Math.floor(ejes_med * plantas_tipo * 0.85);
        const hi = Math.ceil(ejes_med * plantas_tipo * 1.15) + pb_med;
        const total_capped = Math.max(lo + pb_med, Math.min(hi, total_raw));
        facadeResults.push({ role, n_panos: ps.length, ejes_med, pb_med, total_raw, total_capped, detalle });
      }
      const total_edif = facadeResults.reduce((s, f) => s + f.total_capped, 0);
      const ape = gt_val ? Math.abs(total_edif - gt_val) / gt_val * 100 : null;
      out.push({
        building_id: bid, direccion: b?.direccion, rc14, plantas, plantas_tipo,
        is_corner: pgc?.is_corner, corner_type: pgc?.corner_type,
        gt: gt_val, pred_anterior: fwc?.final_count, pred_calibrado: total_edif,
        ape_pct: ape == null ? null : Math.round(ape*10)/10,
        within_10pct: ape != null && ape <= 10,
        facades: facadeResults,
      });

      // Flag needs_review si APE > 10%
      if (ape != null && ape > 10) {
        await sb.from("building_feedback").insert({
          building_id: bid, canal: "sistema", autor_email: "calibrador@affluxos",
          dimension: "ventanas_fachada", estado: "abierto",
          texto: `Recount calibrado: pred=${total_edif} vs GT=${gt_val} (APE ${ape.toFixed(1)}%). needs_review_humano.`,
          analisis_ia: { pred_calibrado: total_edif, gt: gt_val, facades: facadeResults },
        });
      }
    } catch (e) { out.push({ building_id: bid, error: (e as Error).message }); }
    }
    const ape_arr = out.map(o => o.ape_pct).filter((x): x is number => typeof x === "number");
    const mape = ape_arr.length ? ape_arr.reduce((s,x)=>s+x,0)/ape_arr.length : null;
    await sb.from("app_settings").upsert({ key: "recount_windows_calibrated_last", value: { results: out, mape, finished_at: new Date().toISOString() } as any, updated_at: new Date().toISOString() }, { onConflict: "key" });
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, ids }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});