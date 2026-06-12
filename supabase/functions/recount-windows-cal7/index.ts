// recount-windows-cal7
// Mejoras vs cal-5:
// 1) Para fachadas LINEALES (no esquina) se hacen SIEMPRE 2 capturas
//    disjuntas (mitad izquierda + mitad derecha) además de la full,
//    y el conteo del frente = max(full, half_izq+half_der). Esto cubre
//    oclusión por árboles (los 2 puntos de vista distintos suelen
//    "rodear" el árbol y exponer ejes que la full no veía).
// 2) Regla explícita de PB: si la planta baja es uso COMERCIAL
//    (escaparates, persianas metálicas, puertas de local, sin balcones
//    ni ventanas de vivienda), pb_completos = 0. El GT humano de
//    Madrid no cuenta huecos de local comercial.
// 3) Resto del flujo idéntico a cal-5: una huella geométrica por
//    frente, esquinas con principal+secundaria.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";
const FOV_MAX = 90, FOV_MIN = 50;
const DIST_MAX = 25, DIST_MIN = 8;

const sv=(lat:number,lng:number,h:number,p:number,fov:number,k:string)=>
  `https://maps.googleapis.com/maps/api/streetview?size=640x640&location=${lat},${lng}&heading=${h.toFixed(2)}&fov=${fov.toFixed(0)}&pitch=${p}&source=outdoor&key=${k}`;

function offset(lat:number,lon:number,d:number,bDeg:number){
  const b=bDeg*Math.PI/180;
  return {lat:lat+(d*Math.cos(b))/111320, lon:lon+(d*Math.sin(b))/(111320*Math.cos(lat*Math.PI/180))};
}
function frameFor(len:number){
  const target=len*1.10;
  for(let fov=FOV_MAX;fov>=FOV_MIN;fov-=5){
    const dist=(target/2)/Math.tan((fov/2)*Math.PI/180);
    if(dist<=DIST_MAX) return {fov, dist:Math.max(DIST_MIN,dist)};
  }
  return {fov:FOV_MIN, dist:DIST_MAX};
}

const PB_RULE = `REGLA PB: si la planta baja es USO COMERCIAL (escaparates, persianas metálicas, rótulos, puertas de local, sin balcones ni ventanas de vivienda), pb_completos=0. Solo cuenta huecos de PB si son claramente residenciales (con balcón, reja de vivienda o ventana de portería/vivienda).`;

const PROMPT_FULL=(p:number,r:string,l:number)=>
`Arquitecto técnico. Fachada ${r} (Madrid residencial). Longitud ~${l.toFixed(0)}m. Plantas sobre rasante: ${p}.
Te paso 3 zooms de la MISMA captura del frente completo.
Cuenta EJES VERTICALES de huecos vidriados residenciales del edificio objetivo (NO vecinos, NO portal, NO escaparates).
${PB_RULE}
JSON: {"ejes_completos":number,"pb_completos":number,"huecos_por_planta_visibles":[number],"oclusion_arbolado":"alta"|"media"|"baja","confianza":"alta"|"media"|"baja","comentario":string}`;

const PROMPT_HALF=(p:number,r:string,half:string,l:number)=>
`Arquitecto técnico. Fachada ${r} (Madrid residencial). Longitud total ~${l.toFixed(0)}m. Plantas: ${p}.
Captura encuadra la MITAD ${half.toUpperCase()} del frente. Cuenta SOLO ejes cuyo eje vertical caiga en esa mitad del edificio objetivo. Ignora vecinos y la otra mitad.
${PB_RULE}
JSON: {"ejes_completos":number,"pb_completos":number,"huecos_por_planta_visibles":[number],"oclusion_arbolado":"alta"|"media"|"baja","confianza":"alta"|"media"|"baja","comentario":string}`;

async function vlm(k:string,prompt:string,urls:string[]){
  const r=await fetch("https://ai.gateway.lovable.dev/v1/chat/completions",{
    method:"POST",headers:{Authorization:`Bearer ${k}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,messages:[{role:"user",content:[{type:"text",text:prompt},...urls.map(u=>({type:"image_url",image_url:{url:u}}))]}],response_format:{type:"json_object"}})});
  if(!r.ok) throw new Error(`gw ${r.status}: ${await r.text().catch(()=>'')}`);
  const j=await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  const apiKey=Deno.env.get("LOVABLE_API_KEY"); const gKey=Deno.env.get("GOOGLE_MAPS_API_KEY");
  if(!apiKey||!gKey) return new Response(JSON.stringify({error:"missing keys"}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const body=await req.json().catch(()=>({}));
  const ids:string[]=body.building_ids ?? [
    "f62fef57-e8cc-43fe-bb5a-fba80980d487","3402ffbd-8dbe-4257-8132-8730f3c2ba2a",
    "0485d8cf-c1a2-4412-b38f-e37fb18961a2","5a0f81c0-6c9f-402e-bb24-2e5073cdc4c2",
    "33e39048-881b-4d85-a790-852d573de122","67248b55-818d-4e8e-a525-2e3b11ff7dde"];
  const chain:boolean=body.chain!==false;
  const perInv:number=Math.max(1,Math.min(3,Number(body.per_invocation??1)));
  const reset:boolean=body.reset===true;
  const sb=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const slice=ids.slice(0,perInv); const remaining=ids.slice(perInv);
  const run=async()=>{
    const {data:prev}=await sb.from("app_settings").select("value").eq("key","recount_windows_cal7_last").maybeSingle();
    const prevR:any[]=(!reset&&Array.isArray((prev?.value as any)?.results))?(prev!.value as any).results:[];
    const byId=new Map<string,any>(); for(const r of prevR) byId.set(r.building_id,r);

    for(const bid of slice){
      try{
        const {data:b}=await sb.from("buildings").select("id,direccion,refcatastral,catastro_ref").eq("id",bid).maybeSingle();
        const rc14=(b?.refcatastral??b?.catastro_ref??"").substring(0,14);
        const {data:cac}=await sb.from("catastro_authority_cache").select("numero_plantas").eq("refcatastral_14",rc14).maybeSingle();
        const {data:pgc}=await sb.from("parcel_geometry_cache").select("street_edges_jsonb,is_corner").eq("refcatastral_14",rc14).maybeSingle();
        const {data:gtH}=await sb.from("facade_window_ground_truth").select("human_count").eq("building_id",bid).maybeSingle();
        const plantas=Number(cac?.numero_plantas??0); const pt=Math.max(0,plantas-1);
        const gt=gtH?.human_count??null;
        const edges:any[]=Array.isArray(pgc?.street_edges_jsonb)?pgc!.street_edges_jsonb:[];
        if(!edges.length){byId.set(bid,{building_id:bid,direccion:b?.direccion,error:"sin street_edges"}); continue;}
        const principal=edges.find(e=>e.role==="principal")??[...edges].sort((a,b)=>b.len_m-a.len_m)[0];
        const is_corner=pgc?.is_corner??false;
        let sec:any=null;
        if(is_corner) sec=edges.find(e=>e!==principal && e.len_m>=8 && Math.abs(((e.bearing-principal.bearing+540)%360)-180)>=40 && Math.abs(((e.bearing-principal.bearing+540)%360)-180)<=140)??null;
        const roles:any[]=[{role:"principal",edge:principal}]; if(sec) roles.push({role:"secundaria",edge:sec});

        const facadeR:any[]=[];
        for(const {role,edge} of roles){
          const len=Number(edge.len_m); const a=edge.a as[number,number]; const b2=edge.b as[number,number];
          const heading=Number(edge.heading); const outside=Number(edge.outside_bearing);
          // Captura FULL
          const ff=frameFor(len);
          const tLat=a[1]+0.5*(b2[1]-a[1]); const tLon=a[0]+0.5*(b2[0]-a[0]);
          const camF=offset(tLat,tLon,ff.dist,outside);
          const urlsF=[25,10,-2].map(p=>sv(camF.lat,camF.lon,heading,p,ff.fov,gKey));
          let vF:any={};
          try{ vF=await vlm(apiKey,PROMPT_FULL(pt,role,len),urlsF); }catch(e){ vF={error:(e as Error).message}; }
          await new Promise(r=>setTimeout(r,300));

          const fullEjes=Number(vF.ejes_completos??0); const fullPb=Number(vF.pb_completos??0);
          const oclusion=String(vF.oclusion_arbolado??"baja").toLowerCase();
          // HALVES SOLO si full reporta oclusion ALTA. Sin max: usamos halfL+halfR directamente.
          let halves:any[]=[]; let halfEjes=0; let halfPb=0; let usedHalves=false;
          if (oclusion==="alta") {
            const fh=frameFor(len/2);
            for(const [idx,half] of [[0,"izquierda"],[1,"derecha"]] as const){
              const t=idx===0?0.25:0.75;
              const tL=a[1]+t*(b2[1]-a[1]); const tO=a[0]+t*(b2[0]-a[0]);
              const cam=offset(tL,tO,fh.dist,outside);
              const urls=[25,10,-2].map(p=>sv(cam.lat,cam.lon,heading,p,fh.fov,gKey));
              try{ const v=await vlm(apiKey,PROMPT_HALF(pt,role,half,len),urls); halves.push({half,...v}); }
              catch(e){ halves.push({half,error:(e as Error).message}); }
              await new Promise(r=>setTimeout(r,300));
            }
            halfEjes=halves.reduce((s,h)=>s+Number(h.ejes_completos??0),0);
            halfPb=halves.reduce((s,h)=>s+Number(h.pb_completos??0),0);
            usedHalves=true;
          }
          const ejes_role= usedHalves ? halfEjes : fullEjes;
          const pb_role  = usedHalves ? halfPb   : fullPb;
          const total_role=ejes_role*pt+pb_role;
          facadeR.push({role,len_m:len,oclusion,usedHalves,fullEjes,halfEjes,fullPb,halfPb,ejes_role,pb_role,total_role,full:vF,halves});
        }
        const total=facadeR.reduce((s,f)=>s+f.total_role,0);
        const ape=gt?Math.abs(total-gt)/gt*100:null;
        const row={building_id:bid,direccion:b?.direccion,rc14,plantas,plantas_tipo:pt,is_corner,gt,pred_cal7:total,
          ape_pct:ape==null?null:Math.round(ape*10)/10,
          within_10pct:ape!=null&&ape<=10, within_15pct:ape!=null&&ape<=15, facades:facadeR};
        byId.set(bid,row);
        const cur=Array.from(byId.values());
        const apes=cur.map((o:any)=>o.ape_pct).filter((x:any):x is number=>typeof x==="number");
        const mape=apes.length?apes.reduce((s,x)=>s+x,0)/apes.length:null;
        const w10=cur.filter((o:any)=>o.within_10pct===true).length;
        const w15=cur.filter((o:any)=>o.within_15pct===true).length;
        await sb.from("app_settings").upsert({key:"recount_windows_cal7_last",
          value:{results:cur,mape,within_10pct:w10,within_15pct:w15,n:cur.length,updated_at:new Date().toISOString()} as any,
          updated_at:new Date().toISOString()},{onConflict:"key"});
      }catch(e){ byId.set(bid,{building_id:bid,error:(e as Error).message}); }
    }
    const out=Array.from(byId.values());
    const apes=out.map((o:any)=>o.ape_pct).filter((x:any):x is number=>typeof x==="number");
    const mape=apes.length?apes.reduce((s,x)=>s+x,0)/apes.length:null;
    const w10=out.filter((o:any)=>o.within_10pct===true).length;
    const w15=out.filter((o:any)=>o.within_15pct===true).length;
    await sb.from("app_settings").upsert({key:"recount_windows_cal7_last",
      value:{results:out,mape,within_10pct:w10,within_15pct:w15,n:out.length,
        finished_at: remaining.length?undefined:new Date().toISOString(),
        updated_at:new Date().toISOString()} as any,
      updated_at:new Date().toISOString()},{onConflict:"key"});
    console.log("cal7 batch done",JSON.stringify({mape,w10,w15,n:out.length,remaining:remaining.length}));
    if(chain && remaining.length){
      try{
        const srk=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/recount-windows-cal7`,{
          method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${srk}`,apikey:srk},
          body:JSON.stringify({building_ids:remaining,chain:true,per_invocation:perInv})});
      }catch(e){ console.warn("cal7 chain fail",(e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ok:true,async:true,processing:slice,remaining:remaining.length}),{status:202,headers:{...corsHeaders,"Content-Type":"application/json"}});
});
