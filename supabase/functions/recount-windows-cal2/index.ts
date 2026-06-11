// recount-windows-cal2
// v-cal-2: barrido lateral ±15° desde el heading nominal de cada pano para
// cubrir fachada completa (3 headings × 3 pitches = 9 imágenes por pano),
// + role=chaflan extra en edificios esquina_chaflan (heading = bisector de
// principal+secundaria). Mediana de ejes por pano, suma por role, cap anclado
// al MAX(catastro_baseline, mediana_VLM_previa) para no infracontar cuando la
// fachada real supera el cálculo Catastro.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const SV_SIZE = "640x640";
const sv = (lat:number,lng:number,h:number,p:number,fov:number,k:string) =>
  `https://maps.googleapis.com/maps/api/streetview?size=${SV_SIZE}&location=${lat},${lng}&heading=${h.toFixed(2)}&fov=${fov}&pitch=${p}&source=outdoor&key=${k}`;

const PROMPT = (plantas:number) => `Arquitecto técnico. Te paso 9 capturas de la MISMA fachada residencial de Madrid desde el MISMO punto, con 3 headings (centro y ±15°) × 3 zooms (alta/media/baja). Plantas sobre rasante (Catastro vinculante): ${plantas}.
Cuenta ejes verticales de huecos (ventanas+balconeras+miradores; NO puertas ni escaparates de portal). Para cada planta visible da huecos contados. Usa la captura donde la planta esté más limpia.
JSON estricto:
{"huecos_por_planta":[number,...],"ejes_verticales":number,"huecos_planta_baja":number,"confianza":"alta"|"media"|"baja","comentario":string}
Prohibido inventar. Si <2 plantas claras → confianza="baja".`;

async function vlm(apiKey:string, plantas:number, urls:string[]) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions",{
    method:"POST",
    headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,
      messages:[{role:"user",content:[
        {type:"text",text:PROMPT(plantas)},
        ...urls.map(u=>({type:"image_url",image_url:{url:u}})),
      ]}],
      response_format:{type:"json_object"}}),
  });
  if(!r.ok) throw new Error(`gw ${r.status}: ${await r.text().catch(()=>'')}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}
const median = (xs:number[]) => { const s=xs.filter(n=>Number.isFinite(n)).sort((a,b)=>a-b); if(!s.length) return 0; const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; };

Deno.serve(async (req) => {
  if (req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const gKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if(!apiKey||!gKey) return new Response(JSON.stringify({error:"missing keys"}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const body = await req.json().catch(()=>({}));
  const ids:string[] = body.building_ids ?? ["f62fef57-e8cc-43fe-bb5a-fba80980d487","3402ffbd-8dbe-4257-8132-8730f3c2ba2a"];
  const sb = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const run = async () => {
    const out:any[] = [];
    for (const bid of ids) {
      try {
        const { data: fwc } = await sb.from("facade_window_counts").select("street_view_panoramas, final_count").eq("building_id",bid).order("created_at",{ascending:false}).limit(1).maybeSingle();
        const panos:any[] = Array.isArray(fwc?.street_view_panoramas)?fwc!.street_view_panoramas:[];
        const { data: b } = await sb.from("buildings").select("id,direccion,refcatastral,catastro_ref").eq("id",bid).maybeSingle();
        const rc14 = (b?.refcatastral ?? b?.catastro_ref ?? "").substring(0,14);
        const { data: cac } = await sb.from("catastro_authority_cache").select("numero_plantas").eq("refcatastral_14",rc14).maybeSingle();
        const { data: pgc } = await sb.from("parcel_geometry_cache").select("is_corner,corner_type").eq("refcatastral_14",rc14).maybeSingle();
        const { data: gt } = await sb.from("qa_ground_truth").select("ventanas_fachada").eq("building_id",bid).maybeSingle();
        const plantas = Number(cac?.numero_plantas ?? 0);
        const plantas_tipo = Math.max(0,plantas-1);
        const gt_val = gt?.ventanas_fachada ?? null;

        const byRole:Record<string,any[]> = {};
        for (const p of panos) (byRole[p.role||"principal"] ??= []).push(p);

        // Para chaflan: añadir un role sintético con heading = bisector
        if (pgc?.corner_type === "esquina_chaflan" && byRole.principal?.length && byRole.secundaria?.length) {
          const p0 = byRole.principal[0]; const s0 = byRole.secundaria[0];
          let h1 = p0.heading, h2 = s0.heading;
          let diff = ((h2 - h1 + 540) % 360) - 180;
          const bisector = ((h1 + diff/2) + 360) % 360;
          byRole.chaflan = [{ lat: p0.lat, lng: p0.lng, heading: bisector, role: "chaflan", synthetic: true }];
        }

        const facadeResults:any[] = [];
        for (const [role, ps] of Object.entries(byRole)) {
          const ejesArr:number[] = []; const pbArr:number[] = []; const detalle:any[] = [];
          for (const p of ps) {
            // 3 headings (centro, -15, +15) × 3 pitches
            const headings = [p.heading, (p.heading-15+360)%360, (p.heading+15)%360];
            const urls:string[] = [];
            for (const h of headings) for (const pi of [25,10,-2]) urls.push(sv(p.lat,p.lng,h,pi,h===p.heading?60:75,gKey));
            try {
              const v = await vlm(apiKey, plantas_tipo, urls);
              const ejes = Number(v.ejes_verticales ?? 0);
              const pb = Number(v.huecos_planta_baja ?? 0);
              if (ejes>0) ejesArr.push(ejes);
              pbArr.push(pb);
              detalle.push({heading:p.heading, role, ejes, pb, huecos_por_planta:v.huecos_por_planta, conf:v.confianza, synthetic:!!p.synthetic});
            } catch(e) { detalle.push({heading:p.heading, role, error:(e as Error).message}); }
            await new Promise(r => setTimeout(r,400));
          }
          const ejes_med = Math.round(median(ejesArr));
          const pb_med = Math.round(median(pbArr));
          const total_raw = ejes_med * plantas_tipo + pb_med;
          facadeResults.push({role, n_panos:ps.length, ejes_med, pb_med, total_raw, detalle});
        }

        // Total bruto sumando todos los roles (chaflan incluido)
        const total_raw_sum = facadeResults.reduce((s,f)=>s+f.total_raw, 0);
        // Cap: anclamos al máximo entre Catastro-based y previo VLM (no infracontar)
        const baseline_cat = facadeResults.reduce((s,f)=>s+f.ejes_med*plantas_tipo,0);
        const prev_vlm = Number(fwc?.final_count ?? 0);
        const floor = Math.max(baseline_cat, prev_vlm);
        const hi = Math.ceil(baseline_cat*1.15) + facadeResults.reduce((s,f)=>s+f.pb_med,0);
        const total_capped = Math.max(floor, Math.min(hi, total_raw_sum));
        const ape = gt_val ? Math.abs(total_capped - gt_val)/gt_val*100 : null;

        out.push({
          building_id:bid, direccion:b?.direccion, rc14, plantas, plantas_tipo,
          is_corner:pgc?.is_corner, corner_type:pgc?.corner_type,
          gt:gt_val, pred_anterior:fwc?.final_count, pred_cal2:total_capped,
          ape_pct: ape==null?null:Math.round(ape*10)/10,
          within_10pct: ape!=null && ape<=10,
          facades:facadeResults,
        });

        if (ape!=null && ape>10) {
          await sb.from("building_feedback").insert({
            building_id:bid, canal:"sistema", autor_email:"calibrador-v2@affluxos",
            dimension:"ventanas_fachada", estado:"abierto",
            texto:`v-cal-2: pred=${total_capped} vs GT=${gt_val} (APE ${ape.toFixed(1)}%). needs_review_humano.`,
            analisis_ia:{pred_cal2:total_capped, gt:gt_val, facades:facadeResults},
          });
        }
      } catch(e) { out.push({building_id:bid, error:(e as Error).message}); }
    }
    const ape_arr = out.map(o=>o.ape_pct).filter((x):x is number => typeof x==="number");
    const mape = ape_arr.length ? ape_arr.reduce((s,x)=>s+x,0)/ape_arr.length : null;
    await sb.from("app_settings").upsert({key:"recount_windows_cal2_last", value:{results:out, mape, finished_at:new Date().toISOString()} as any, updated_at:new Date().toISOString()},{onConflict:"key"});
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ok:true,async:true,ids}),{status:202,headers:{...corsHeaders,"Content-Type":"application/json"}});
});