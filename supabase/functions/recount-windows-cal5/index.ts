// recount-windows-cal5
// Rediseño del dedup: UNA captura por frente, con FOV/distancia adaptadas
// para encuadrar el frente entero (de esquina a esquina) y SIN suma entre
// capturas solapadas. Para fachadas >50m → 2 capturas explícitamente
// disjuntas (mitad izquierda / mitad derecha) y el prompt prohíbe contar
// ejes fuera de su mitad.
//
// Esquinas: se procesan principal + secundaria (frentes geométricamente
// distintos), no hay doble conteo porque cada captura mira a una pared
// distinta.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const FOV_MAX = 90;
const FOV_MIN = 50;
const DIST_MAX = 25;
const DIST_MIN = 8;
const SPLIT_LEN_M = 50; // >50m → split en 2 captures disjuntas

const sv = (lat:number,lng:number,h:number,p:number,fov:number,k:string) =>
  `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${h.toFixed(2)}&fov=${fov.toFixed(0)}&pitch=${p}&source=outdoor&key=${k}`;

function offset(lat:number, lon:number, distM:number, bearingDeg:number) {
  const b = bearingDeg * Math.PI/180;
  const dx = distM * Math.sin(b);
  const dy = distM * Math.cos(b);
  return { lat: lat + dy/111320, lon: lon + dx/(111320*Math.cos(lat*Math.PI/180)) };
}

// Devuelve (distancia, fov) tales que el ancho del frame cubre len_m + margen
function frameFor(len_m:number) {
  const target = len_m * 1.10; // 10% margen
  // probar FOV decreciendo hasta caber con dist<=DIST_MAX
  for (let fov = FOV_MAX; fov >= FOV_MIN; fov -= 5) {
    const half = fov/2 * Math.PI/180;
    const dist = (target/2) / Math.tan(half);
    if (dist <= DIST_MAX) return { fov, dist: Math.max(DIST_MIN, dist) };
  }
  return { fov: FOV_MIN, dist: DIST_MAX };
}

const PROMPT_FULL = (plantas:number, role:string, len:number) =>
`Arquitecto técnico. Fachada ${role} (Madrid, residencial). Longitud real ~${len.toFixed(0)}m.
Plantas SOBRE rasante (Catastro): ${plantas}. Te paso 3 zooms de la MISMA captura
que abarca el FRENTE COMPLETO de esquina a esquina.

Cuenta EJES VERTICALES de huecos vidriados residenciales (ventanas+balconeras+miradores;
NO puertas portal, NO escaparates locales, NO ventanas de edificios vecinos).
- "ejes_completos" = ejes plenamente visibles del FRENTE INDICADO.
- Si la imagen incluye fachadas de edificios adyacentes (izquierda/derecha del nuestro),
  NO los cuentes. Solo el edificio objetivo.
- "pb_completos" = huecos vidriados residenciales en planta baja (0 si PB es comercial).
- "huecos_por_planta_visibles": array de huecos por planta de arriba a abajo.

JSON ESTRICTO:
{"ejes_completos":number,"pb_completos":number,
 "huecos_por_planta_visibles":[number,...],"confianza":"alta"|"media"|"baja","comentario":string}`;

const PROMPT_HALF = (plantas:number, role:string, half:"izquierda"|"derecha", len:number) =>
`Arquitecto técnico. Fachada ${role} (Madrid, residencial). Longitud real ~${len.toFixed(0)}m.
Plantas SOBRE rasante (Catastro): ${plantas}. Te paso 3 zooms de la MISMA captura.

Esta captura encuadra la MITAD ${half.toUpperCase()} del frente. Cuenta SOLO ejes
cuyo eje vertical caiga en la MITAD ${half.toUpperCase()} del edificio objetivo;
ignora cualquier eje que esté en la otra mitad (aunque sea visible).
No cuentes edificios vecinos. PB residencial igual.

JSON ESTRICTO:
{"ejes_completos":number,"pb_completos":number,
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
  const chain: boolean = body.chain !== false;
  const perInvocation: number = Math.max(1, Math.min(3, Number(body.per_invocation ?? 1)));
  const reset: boolean = body.reset === true;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const slice = ids.slice(0, perInvocation);
  const remaining = ids.slice(perInvocation);

  const run = async () => {
    const { data: prev } = await sb.from("app_settings").select("value").eq("key","recount_windows_cal5_last").maybeSingle();
    const prevResults:any[] = (!reset && Array.isArray((prev?.value as any)?.results)) ? (prev!.value as any).results : [];
    const byId = new Map<string, any>();
    for (const r of prevResults) byId.set(r.building_id, r);

    for (const bid of slice) {
      try {
        const { data: b } = await sb.from("buildings").select("id,direccion,refcatastral,catastro_ref").eq("id",bid).maybeSingle();
        const rc14 = (b?.refcatastral ?? b?.catastro_ref ?? "").substring(0,14);
        const { data: cac } = await sb.from("catastro_authority_cache").select("numero_plantas").eq("refcatastral_14",rc14).maybeSingle();
        const { data: pgc } = await sb.from("parcel_geometry_cache").select("street_edges_jsonb,is_corner").eq("refcatastral_14",rc14).maybeSingle();
        const { data: gtH } = await sb.from("facade_window_ground_truth").select("human_count,notes").eq("building_id",bid).maybeSingle();
        const plantas = Number(cac?.numero_plantas ?? 0);
        const plantas_tipo = Math.max(0, plantas-1);
        const gt_val = gtH?.human_count ?? null;

        const edges:any[] = Array.isArray(pgc?.street_edges_jsonb) ? pgc!.street_edges_jsonb : [];
        if (!edges.length) { byId.set(bid,{building_id:bid, direccion:b?.direccion, error:"sin street_edges"}); continue; }

        const principal = edges.find(e=>e.role==="principal") ?? [...edges].sort((a,b)=>b.len_m-a.len_m)[0];
        const is_corner = pgc?.is_corner ?? false;
        let secundaria:any = null;
        if (is_corner) {
          secundaria = edges.find(e=>e!==principal && e.len_m>=8 && Math.abs(((e.bearing-principal.bearing+540)%360)-180)>=40 && Math.abs(((e.bearing-principal.bearing+540)%360)-180)<=140) ?? null;
        }
        const rolesToProcess:any[] = [{role:"principal", edge:principal}];
        if (secundaria) rolesToProcess.push({role:"secundaria", edge:secundaria});

        const facadeResults:any[] = [];
        for (const {role, edge} of rolesToProcess) {
          const len = Number(edge.len_m);
          const a = edge.a as [number,number]; const b2 = edge.b as [number,number];
          const heading = Number(edge.heading);
          const outside = Number(edge.outside_bearing);

          const perCapture:any[] = [];
          if (len <= SPLIT_LEN_M) {
            const { fov, dist } = frameFor(len);
            const tLat = a[1] + 0.5*(b2[1]-a[1]);
            const tLon = a[0] + 0.5*(b2[0]-a[0]);
            const cam = offset(tLat, tLon, dist, outside);
            const urls = [25, 10, -2].map(p => sv(cam.lat, cam.lon, heading, p, fov, gKey));
            try {
              const v = await vlm(apiKey, PROMPT_FULL(plantas_tipo, role, len), urls);
              perCapture.push({mode:"full", lat:cam.lat, lon:cam.lon, heading, fov, dist, ...v});
            } catch(e) {
              perCapture.push({mode:"full", error:(e as Error).message});
            }
          } else {
            // Split en 2 mitades disjuntas
            const halfLen = len/2;
            const { fov, dist } = frameFor(halfLen);
            for (const [idx, half] of [[0,"izquierda"],[1,"derecha"]] as const) {
              const t = idx===0 ? 0.25 : 0.75;
              const tLat = a[1] + t*(b2[1]-a[1]);
              const tLon = a[0] + t*(b2[0]-a[0]);
              const cam = offset(tLat, tLon, dist, outside);
              const urls = [25, 10, -2].map(p => sv(cam.lat, cam.lon, heading, p, fov, gKey));
              try {
                const v = await vlm(apiKey, PROMPT_HALF(plantas_tipo, role, half, len), urls);
                perCapture.push({mode:"half", half, lat:cam.lat, lon:cam.lon, heading, fov, dist, ...v});
              } catch(e) {
                perCapture.push({mode:"half", half, error:(e as Error).message});
              }
              await new Promise(r=>setTimeout(r,400));
            }
          }

          // Suma simple (no hay solape: full=1 captura, half=2 disjuntas)
          let ejes_role = 0, pb_role = 0;
          for (const r of perCapture) {
            ejes_role += Number(r.ejes_completos ?? 0);
            pb_role   += Number(r.pb_completos ?? 0);
          }
          const total_role = ejes_role * plantas_tipo + pb_role;
          facadeResults.push({ role, len_m:len, ejes_role, pb_role, total_role, perCapture });
        }

        const total = facadeResults.reduce((s,f)=>s+f.total_role,0);
        const ape = gt_val ? Math.abs(total-gt_val)/gt_val*100 : null;
        const row = {
          building_id:bid, direccion:b?.direccion, rc14, plantas, plantas_tipo,
          is_corner, gt:gt_val, pred_cal5:total,
          ape_pct: ape==null?null:Math.round(ape*10)/10,
          within_10pct: ape!=null && ape<=10,
          within_15pct: ape!=null && ape<=15,
          facades:facadeResults,
        };
        byId.set(bid, row);
        const cur = Array.from(byId.values());
        const apes = cur.map((o:any)=>o.ape_pct).filter((x:any):x is number => typeof x==="number");
        const mape = apes.length ? apes.reduce((s,x)=>s+x,0)/apes.length : null;
        await sb.from("app_settings").upsert({
          key:"recount_windows_cal5_last",
          value:{results:cur, mape, n:cur.length, updated_at:new Date().toISOString()} as any,
          updated_at:new Date().toISOString(),
        },{onConflict:"key"});
      } catch(e) { byId.set(bid,{building_id:bid, error:(e as Error).message}); }
    }
    const out = Array.from(byId.values());
    const apes = out.map((o:any)=>o.ape_pct).filter((x:any):x is number => typeof x==="number");
    const mape = apes.length ? apes.reduce((s,x)=>s+x,0)/apes.length : null;
    await sb.from("app_settings").upsert({
      key:"recount_windows_cal5_last",
      value:{results:out, mape, n:out.length, finished_at: remaining.length?undefined:new Date().toISOString(), updated_at:new Date().toISOString()} as any,
      updated_at:new Date().toISOString(),
    },{onConflict:"key"});
    console.log("cal5 batch done", JSON.stringify({mape, n:out.length, processed:slice.length, remaining:remaining.length}));
    if (chain && remaining.length) {
      try {
        const srk = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/recount-windows-cal5`, {
          method:"POST",
          headers:{ "Content-Type":"application/json", Authorization:`Bearer ${srk}`, apikey:srk },
          body:JSON.stringify({ building_ids: remaining, chain:true, per_invocation: perInvocation }),
        });
      } catch(e) { console.warn("cal5 chain failed", (e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ok:true,async:true,processing:slice,remaining:remaining.length}),{status:202,headers:{...corsHeaders,"Content-Type":"application/json"}});
});