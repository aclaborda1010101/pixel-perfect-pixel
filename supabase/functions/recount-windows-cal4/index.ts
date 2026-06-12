// recount-windows-cal4
// Multi-captura proporcional a longitud de fachada para evitar el
// infraconteo por FOV cortado en fachadas anchas / esquinas.
//
// Por cada role (principal/secundaria) leído de parcel_geometry_cache:
//   N = ceil(len_m / 7)  // cada captura cubre ~9m a 8m de retiro, FOV 60
//   captura_i en t=(i+0.5)/N del segmento (a→b), retirada 8m por outside_bearing,
//   heading hacia fachada
//   VLM por captura: ejes_completos (ignora cortados), partial_left, partial_right,
//                    pb_completos, pb_partial_left, pb_partial_right
//   ejes_role = sum(ejes_completos) + partial_left_0 + partial_right_{N-1}
//   pb_role   = sum(pb_completos)   + pb_partial_left_0 + pb_partial_right_{N-1}
//   total_role = ejes_role * plantas_tipo + pb_role
// total = Σ total_role
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const SETBACK_M = 8;
const STEP_M = 7; // separación entre puntos a lo largo de la fachada
const FOV = 60;

const sv = (lat:number,lng:number,h:number,p:number,fov:number,k:string) =>
  `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${h.toFixed(2)}&fov=${fov}&pitch=${p}&source=outdoor&key=${k}`;

function offset(lat:number, lon:number, distM:number, bearingDeg:number) {
  const b = bearingDeg * Math.PI/180;
  const dx = distM * Math.sin(b);
  const dy = distM * Math.cos(b);
  return {
    lat: lat + dy/111320,
    lon: lon + dx/(111320*Math.cos(lat*Math.PI/180)),
  };
}

const PROMPT = (plantas:number, role:string, idx:number, total:number) =>
`Arquitecto técnico. Captura ${idx+1}/${total} de la fachada ${role} (Madrid, residencial).
Plantas sobre rasante (Catastro): ${plantas}. Te paso 3 zooms de la MISMA posición.

Cuenta EJES VERTICALES de huecos vidriados (ventanas+balconeras+miradores; NO puertas portal ni escaparates locales).
REGLAS DE FRAGMENTACIÓN (clave para evitar doble conteo entre capturas):
- "ejes_completos" = ejes COMPLETAMENTE visibles en el ancho de la imagen.
- "ejes_partial_left" = ejes cortados por el borde IZQUIERDO (típicamente 0 o 1).
- "ejes_partial_right" = ejes cortados por el borde DERECHO (típicamente 0 o 1).
- Lo mismo para PB: "pb_completos", "pb_partial_left", "pb_partial_right" (huecos vidriados residenciales en PB; si la PB es comercial sin huecos vidriados residenciales, devuelve 0).
- Si la fachada NO aparece en la imagen (ocluida por edificio vecino, esquina, calle perpendicular), pon todo a 0 y confianza="baja".

JSON ESTRICTO:
{"ejes_completos":number,"ejes_partial_left":0|1,"ejes_partial_right":0|1,
 "pb_completos":number,"pb_partial_left":0|1,"pb_partial_right":0|1,
 "huecos_por_planta_visibles":[number,...],"confianza":"alta"|"media"|"baja","comentario":string}`;

async function vlm(apiKey:string, prompt:string, urls:string[]) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions",{
    method:"POST",
    headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,messages:[{role:"user",content:[
      {type:"text",text:prompt},
      ...urls.map(u=>({type:"image_url",image_url:{url:u}})),
    ]}],response_format:{type:"json_object"}}),
  });
  if(!r.ok) throw new Error(`gw ${r.status}: ${await r.text().catch(()=>'')}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

Deno.serve(async (req) => {
  if (req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  const gKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
  if(!apiKey||!gKey) return new Response(JSON.stringify({error:"missing keys"}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const body = await req.json().catch(()=>({}));
  const ids:string[] = body.building_ids ?? [
    "f62fef57-e8cc-43fe-bb5a-fba80980d487", // Castelló 12
    "3402ffbd-8dbe-4257-8132-8730f3c2ba2a", // Alonso Heredia 25
    "0485d8cf-c1a2-4412-b38f-e37fb18961a2", // Cava Baja 42
    "5a0f81c0-6c9f-402e-bb24-2e5073cdc4c2", // Cea Bermudez 38
    "33e39048-881b-4d85-a790-852d573de122", // Ardemans 65
    "67248b55-818d-4e8e-a525-2e3b11ff7dde", // Conde Duque 17
  ];
  const sb = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const run = async () => {
    const out:any[] = [];
    for (const bid of ids) {
      try {
        const { data: b } = await sb.from("buildings").select("id,direccion,refcatastral,catastro_ref").eq("id",bid).maybeSingle();
        const rc14 = (b?.refcatastral ?? b?.catastro_ref ?? "").substring(0,14);
        const { data: cac } = await sb.from("catastro_authority_cache").select("numero_plantas").eq("refcatastral_14",rc14).maybeSingle();
        const { data: pgc } = await sb.from("parcel_geometry_cache").select("street_edges_jsonb,is_corner,corner_type").eq("refcatastral_14",rc14).maybeSingle();
        const { data: gtH } = await sb.from("facade_window_ground_truth").select("human_count,notes").eq("building_id",bid).maybeSingle();
        const plantas = Number(cac?.numero_plantas ?? 0);
        const plantas_tipo = Math.max(0, plantas-1);
        const gt_val = gtH?.human_count ?? null;

        const edges:any[] = Array.isArray(pgc?.street_edges_jsonb) ? pgc!.street_edges_jsonb : [];
        if (!edges.length) { out.push({building_id:bid, direccion:b?.direccion, error:"sin street_edges"}); continue; }

        // principal: la marcada con role o la más larga; secundaria: la siguiente más larga si es esquina
        const principal = edges.find(e=>e.role==="principal") ?? [...edges].sort((a,b)=>b.len_m-a.len_m)[0];
        const is_corner = pgc?.is_corner ?? gtH?.notes?.toLowerCase().includes("esquina");
        let secundaria:any = null;
        if (is_corner) {
          secundaria = edges.find(e=>e!==principal && e.len_m>=8 && Math.abs(((e.bearing-principal.bearing+540)%360)-180)>=40 && Math.abs(((e.bearing-principal.bearing+540)%360)-180)<=140) ?? null;
        }
        const rolesToProcess:any[] = [{role:"principal", edge:principal}];
        if (secundaria) rolesToProcess.push({role:"secundaria", edge:secundaria});

        const facadeResults:any[] = [];
        for (const {role, edge} of rolesToProcess) {
          const len = Number(edge.len_m);
          const N = Math.max(1, Math.ceil(len / STEP_M));
          const a = edge.a as [number,number]; const b2 = edge.b as [number,number];
          const heading = Number(edge.heading);
          const outside = Number(edge.outside_bearing);
          const captures:any[] = [];
          for (let i=0; i<N; i++) {
            const t = (i+0.5)/N;
            const ptLon = a[0] + t*(b2[0]-a[0]);
            const ptLat = a[1] + t*(b2[1]-a[1]);
            const cam = offset(ptLat, ptLon, SETBACK_M, outside);
            captures.push({ idx:i, lat:cam.lat, lon:cam.lon, heading });
          }
          const perCapture:any[] = [];
          for (const c of captures) {
            const urls = [25, 10, -2].map(p => sv(c.lat, c.lon, c.heading, p, FOV, gKey));
            try {
              const v = await vlm(apiKey, PROMPT(plantas_tipo, role, c.idx, N), urls);
              perCapture.push({...c, ...v});
            } catch(e) {
              perCapture.push({...c, error:(e as Error).message});
            }
            await new Promise(r=>setTimeout(r,400));
          }
          // Agregación con dedup en bordes interiores
          let ejes_completos = 0, pb_completos = 0;
          for (const r of perCapture) {
            ejes_completos += Number(r.ejes_completos ?? 0);
            pb_completos   += Number(r.pb_completos ?? 0);
          }
          const first = perCapture[0] ?? {};
          const last = perCapture[perCapture.length-1] ?? {};
          const ejes_role = ejes_completos + Number(first.ejes_partial_left ?? 0) + Number(last.ejes_partial_right ?? 0);
          const pb_role = pb_completos + Number(first.pb_partial_left ?? 0) + Number(last.pb_partial_right ?? 0);
          const total_role = ejes_role * plantas_tipo + pb_role;
          facadeResults.push({ role, len_m:len, N, ejes_role, pb_role, total_role, perCapture });
        }

        const total = facadeResults.reduce((s,f)=>s+f.total_role,0);
        const ape = gt_val ? Math.abs(total-gt_val)/gt_val*100 : null;

        out.push({
          building_id:bid, direccion:b?.direccion, rc14, plantas, plantas_tipo,
          is_corner, gt:gt_val, pred_cal4:total,
          ape_pct: ape==null?null:Math.round(ape*10)/10,
          within_15pct: ape!=null && ape<=15,
          facades:facadeResults,
        });
      } catch(e) { out.push({building_id:bid, error:(e as Error).message}); }
    }
    const apes = out.map(o=>o.ape_pct).filter((x):x is number => typeof x==="number");
    const mape = apes.length ? apes.reduce((s,x)=>s+x,0)/apes.length : null;
    await sb.from("app_settings").upsert({
      key:"recount_windows_cal4_last",
      value:{results:out, mape, n:out.length, finished_at:new Date().toISOString()} as any,
      updated_at:new Date().toISOString(),
    },{onConflict:"key"});
    console.log("cal4 done", JSON.stringify({mape, n:out.length}));
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ok:true,async:true,ids,step_m:STEP_M,setback_m:SETBACK_M}),{status:202,headers:{...corsHeaders,"Content-Type":"application/json"}});
});