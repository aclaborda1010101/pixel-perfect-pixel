// recount-windows-cal8
// Tres fixes concretos sobre cal2:
//   (a) ENCUADRE: para fachadas largas, capturas adicionales desplazando la
//       c\u00e1mara lateralmente a lo largo de la fachada (no s\u00f3lo ±15° de heading).
//       Pasos = ceil(longitud_m / 8); m\u00e1ximo 4 puntos por fachada.
//   (b) OCLUSI\u00d3N: el VLM marca oclusion_alta y "fila_planta_mas_limpia". Si
//       oclusion_alta=true \u2192 total = ejes_de_esa_fila × plantas_tipo + pb
//       (no contamos ventana a ventana).
//   (c) MIRADORES: el prompt instruye contar mirador/galer\u00eda como 1 eje
//       (no varios) y excluir balconeras-puerta de portal.
//
// Se ejecuta s\u00f3lo sobre los building_ids con human_count en
// facade_window_ground_truth. NUNCA toca prod_74. Persistencia s\u00f3lo en
// app_settings.recount_windows_cal8_last (no escribe facade_window_counts).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const SV_SIZE = "640x640";
const sv = (lat: number, lng: number, h: number, p: number, fov: number, k: string) =>
  `https://maps.googleapis.com/maps/api/streetview?size=${SV_SIZE}&location=${lat},${lng}&heading=${h.toFixed(2)}&fov=${fov}&pitch=${p}&source=outdoor&key=${k}`;

// Desplaza lat/lng lateralmente N metros perpendicular al heading (paralelo a fachada)
function offsetLatLng(lat: number, lng: number, headingDeg: number, lateralM: number): { lat: number; lng: number } {
  // Direcci\u00f3n paralela a la fachada = heading + 90°
  const bearing = ((headingDeg + 90) * Math.PI) / 180;
  const dLat = (lateralM * Math.cos(bearing)) / 111320;
  const dLng = (lateralM * Math.sin(bearing)) / (111320 * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lng: lng + dLng };
}

const PROMPT = (plantas: number, oclusionPrev: string | null) => `Arquitecto t\u00e9cnico. Te paso varias capturas de Street View de la MISMA fachada residencial de Madrid, tomadas desde distintos puntos a lo largo de la fachada. Plantas sobre rasante (Catastro): ${plantas}.

TAREA: cuenta los EJES VERTICALES de huecos (columnas continuas que recorren las plantas tipo de arriba abajo).

REGLAS ESTRICTAS:
- Un MIRADOR o GALER\u00cdA (bay window) = 1 eje (NO varios), aunque tenga 3 paneles de vidrio.
- Una BALCONERA-VENTANA cuenta como eje; una BALCONERA-PUERTA o puerta de portal NO cuenta.
- Locales comerciales en PB con escaparates: no son ejes residenciales; cont\u00e9stalos por separado en huecos_planta_baja s\u00f3lo si quedan claros.
- Si la fachada est\u00e1 muy ocluida por \u00c1RBOLES, andamios o veh\u00edculos, marca oclusion_alta=true y dime cu\u00e1l fila/planta se ve m\u00e1s limpia (fila_mas_limpia indicando huecos en esa fila).
- Si la fachada tiene retranqueo o doble cuerpo, suma ejes principales + retranqueo (declara cuerpos_independientes=true).
- Prohibido inventar. Si <2 plantas claras \u2192 confianza="baja".

${oclusionPrev ? `(Nota: capturas anteriores reportaron ${oclusionPrev}.)\n` : ""}
JSON estricto:
{"huecos_por_planta":[number,...],
 "ejes_verticales":number,
 "huecos_planta_baja":number,
 "miradores_detectados":number,
 "oclusion_alta":boolean,
 "fila_mas_limpia":{"planta":string,"huecos":number}|null,
 "cuerpos_independientes":boolean,
 "confianza":"alta"|"media"|"baja",
 "comentario":string}`;

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const gKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey || !gKey) return new Response(JSON.stringify({ error: "missing keys" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  const body = await req.json().catch(() => ({}));
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let ids: string[] = Array.isArray(body.building_ids) && body.building_ids.length ? body.building_ids : [];
  if (!ids.length) {
    const { data: gts } = await sb.from("facade_window_ground_truth").select("building_id").not("human_count", "is", null);
    ids = Array.from(new Set((gts ?? []).map((g: any) => g.building_id))).filter(Boolean) as string[];
  }

  const run = async () => {
    const out: any[] = [];
    for (const bid of ids) {
      try {
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

        if (!panos.length) { out.push({ building_id: bid, error: "sin panos" }); continue; }

        const byRole: Record<string, any[]> = {};
        for (const p of panos) (byRole[p.role || "principal"] ??= []).push(p);

        // (a) ENCUADRE: pasos laterales por fachada. 1 paso por cada ~8m, m\u00e1x 4.
        const stepsPerFacade = longitud > 0 ? Math.max(1, Math.min(4, Math.ceil(longitud / 8))) : 1;
        // Offsets sim\u00e9tricos: si stepsPerFacade=3 \u2192 [-8, 0, +8]
        const offsets = (() => {
          if (stepsPerFacade <= 1) return [0];
          const span = longitud / 2; // hasta media fachada a cada lado
          const arr: number[] = [];
          for (let i = 0; i < stepsPerFacade; i++) {
            const t = stepsPerFacade === 1 ? 0 : (i / (stepsPerFacade - 1)) * 2 - 1; // -1..+1
            arr.push(Math.round(t * span));
          }
          return arr;
        })();

        const facadeResults: any[] = [];
        for (const [role, ps] of Object.entries(byRole)) {
          if (role === "patio") continue; // s\u00f3lo fachada en este reconteo
          const ejesArr: number[] = []; const pbArr: number[] = []; const detalle: any[] = [];
          let lastOclusion: string | null = null;
          for (const p of ps) {
            // Para cada pano, generar 1 ronda por offset lateral (3 headings × 2 pitches por punto, m\u00e1s ligero)
            for (const off of offsets) {
              const { lat, lng } = offsetLatLng(p.lat, p.lng, p.heading, off);
              const headings = [p.heading, (p.heading - 12 + 360) % 360, (p.heading + 12) % 360];
              const urls: string[] = [];
              for (const h of headings) for (const pi of [20, 0]) urls.push(sv(lat, lng, h, pi, 70, gKey));
              try {
                const v = await vlm(apiKey, plantas_tipo, urls, lastOclusion);
                let ejes = Number(v.ejes_verticales ?? 0);
                const pb = Number(v.huecos_planta_baja ?? 0);
                // (b) OCLUSI\u00d3N: si el VLM dice oclusion_alta y nos da fila m\u00e1s limpia, usamos esos huecos como ejes.
                if (v.oclusion_alta && v.fila_mas_limpia && Number.isFinite(Number(v.fila_mas_limpia.huecos))) {
                  ejes = Number(v.fila_mas_limpia.huecos);
                  lastOclusion = `oclusion alta; fila ${v.fila_mas_limpia.planta} con ${ejes} huecos`;
                }
                if (ejes > 0) ejesArr.push(ejes);
                pbArr.push(pb);
                detalle.push({ role, off, ejes, pb, miradores: v.miradores_detectados, ocl: v.oclusion_alta, fila: v.fila_mas_limpia, conf: v.confianza, com: v.comentario });
              } catch (e) { detalle.push({ role, off, error: (e as Error).message }); }
              await new Promise(r => setTimeout(r, 400));
            }
          }
          const ejes_med = Math.round(median(ejesArr));
          const pb_med = Math.round(median(pbArr));
          // (c) MIRADORES ya descontados en ejes_verticales por el prompt; no doble-conteo.
          const total = ejes_med * plantas_tipo + pb_med;
          facadeResults.push({ role, n_panos: ps.length, offsets, ejes_med, pb_med, total, detalle });
        }

        const total_pred = facadeResults.reduce((s, f) => s + f.total, 0);
        const ape = gt_val ? Math.abs(total_pred - gt_val) / gt_val * 100 : null;

        out.push({
          building_id: bid, direccion: b?.direccion, rc14, plantas, plantas_tipo, longitud_m: longitud,
          gt: gt_val, pred_anterior: fwc?.final_count, pred_cal8: total_pred,
          ape_pct: ape == null ? null : Math.round(ape * 10) / 10,
          within_10pct: ape != null && ape <= 10,
          facades: facadeResults,
        });
      } catch (e) { out.push({ building_id: bid, error: (e as Error).message }); }
    }
    const ape_arr = out.map(o => o.ape_pct).filter((x): x is number => typeof x === "number");
    const mape = ape_arr.length ? Math.round((ape_arr.reduce((s, x) => s + x, 0) / ape_arr.length) * 10) / 10 : null;
    await sb.from("app_settings").upsert({
      key: "recount_windows_cal8_last",
      value: { results: out, mape, n: ape_arr.length, finished_at: new Date().toISOString() } as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    console.log("cal8 done", { n: out.length, mape });
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ ok: true, async: true, ids }), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});