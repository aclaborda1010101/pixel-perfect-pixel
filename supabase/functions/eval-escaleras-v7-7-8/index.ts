// eval-escaleras-v7.7 + v7.8 (combo, ctrl_10x10_v1)
// v7.7: OCR de la leyenda/cuadro de superficies del FXCC. Pedimos al VLM que
//        lea texto de la lámina P01 (rótulos "ESC", "ESCALERA A/B/C",
//        "CAJA DE ESCALERA", "NÚCLEO", o lista de viviendas V.A/V.B/V.C/V.D
//        en cuadros de distribución). El conteo de letras únicas o de
//        ocurrencias del literal "ESCALERA" da pred_n.
// v7.8: conteo de portales residenciales en PB. Para Madrid 1-portal/1-núcleo
//        es proxy razonable: pred_n = max(1, portales_PB). Si PB no legible →
//        respeta base v7.2-gemini. Nunca inventa: si conf<0.7 → needs_review.
// Ambas miden sobre ctrl_10x10_v1 y escriben filas separadas (version='v7.7'
// y version='v7.8') en escaleras_eval_results.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MODEL = "google/gemini-2.5-pro";

const PROMPT_LEYENDA = `Eres un experto en planos FXCC de Madrid. Te paso UNA
sola lámina. Lee TEXTO (OCR + interpretación):
1) Identifica la planta (etiqueta_planta).
2) Si es PLANTA 1 (P01): localiza rótulos "ESCALERA A/B/C...", "ESC.A", "CAJA
   DE ESCALERA", "NÚCLEO 1/2..." o el cuadro de viviendas (V.A, V.B...). El
   nº de letras de escalera DISTINTAS es el n_escaleras_leyenda. Si no hay
   rótulos explícitos, devuelve null y baja la confianza.
3) Si es PB: cuenta portales residenciales (entradas a viviendas, ignora
   locales/garaje).
Prohibido inventar. JSON estricto:
{"etiqueta_planta":string,"es_p01":bool,"es_pb":bool,"p01_legible":bool,
 "pb_legible":bool,"n_escaleras_leyenda":number|null,
 "letras_detectadas":[string],"n_portales_pb":number|null,
 "confidence":number,"razon":string}`;

async function vlm(apiKey:string, imageUrl:string) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions",{
    method:"POST",
    headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},
    body:JSON.stringify({model:MODEL,messages:[{role:"user",content:[
      {type:"text",text:PROMPT_LEYENDA},
      {type:"image_url",image_url:{url:imageUrl}},
    ]}],response_format:{type:"json_object"}}),
  });
  if(!r.ok) throw new Error(`gw ${r.status}`);
  const j = await r.json();
  return JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
}

async function evalOne(sb:any, apiKey:string, set_name:string, bid:string, gt:number) {
  const { data: baseRow } = await sb.from("escaleras_eval_results")
    .select("pred_n,needs_review,error").eq("set_name",set_name)
    .eq("version","v7.2-gemini").eq("building_id",bid).maybeSingle();
  const base = baseRow ?? {pred_n:null,needs_review:true,error:null};

  if (base.error && /sin FXCC/i.test(base.error)) {
    return {v77:{pred_n:null,needs_review:true,confidence:0,evidencia:{base,motivo:"sin FXCC"},error:"sin FXCC"},
            v78:{pred_n:null,needs_review:true,confidence:0,evidencia:{base,motivo:"sin FXCC"},error:"sin FXCC"}};
  }
  const { data: cat } = await sb.from("catastro_data")
    .select("fxcc_pages_urls,plantas_pages_urls").eq("building_id",bid).maybeSingle();
  const pages:string[] = Array.isArray(cat?.fxcc_pages_urls)&&cat!.fxcc_pages_urls.length
    ? cat!.fxcc_pages_urls : (Array.isArray(cat?.plantas_pages_urls)?cat!.plantas_pages_urls:[]);
  if (!pages.length) {
    return {v77:{pred_n:null,needs_review:true,confidence:0,evidencia:{motivo:"sin FXCC"},error:"sin FXCC"},
            v78:{pred_n:null,needs_review:true,confidence:0,evidencia:{motivo:"sin FXCC"},error:"sin FXCC"}};
  }

  const reads:any[] = [];
  for (let i=0;i<pages.length;i++) {
    try { reads.push({idx:i, url:pages[i], ...(await vlm(apiKey,pages[i]))}); }
    catch(e){ reads.push({idx:i,url:pages[i],error:(e as Error).message}); }
    await new Promise(r=>setTimeout(r,300));
  }

  // v7.7: mejor P01 con leyenda legible
  const p01s = reads.filter(r=>r.es_p01 && r.p01_legible && r.n_escaleras_leyenda!=null);
  p01s.sort((a,b)=>(b.confidence??0)-(a.confidence??0));
  const bestP01 = p01s[0];
  let v77:any;
  if (bestP01 && (bestP01.confidence??0)>=0.7) {
    const n = Math.round(Number(bestP01.n_escaleras_leyenda));
    v77 = {pred_n:n, needs_review:false, confidence:bestP01.confidence,
      evidencia:{base, idx:bestP01.idx, letras:bestP01.letras_detectadas, razon:"OCR leyenda P01"}};
  } else {
    v77 = {pred_n:base.pred_n??null, needs_review: bestP01==null ? true : true,
      confidence: bestP01?.confidence ?? 0,
      evidencia:{base, motivo: bestP01?"leyenda conf baja":"sin P01 con leyenda", reads}};
    if (v77.pred_n==null) v77.needs_review = true;
  }

  // v7.8: mejor PB con portales legibles
  const pbs = reads.filter(r=>r.es_pb && r.pb_legible && r.n_portales_pb!=null);
  pbs.sort((a,b)=>(b.confidence??0)-(a.confidence??0));
  const bestPB = pbs[0];
  let v78:any;
  if (bestPB && (bestPB.confidence??0)>=0.7) {
    const portales = Math.max(1, Math.round(Number(bestPB.n_portales_pb)));
    v78 = {pred_n:portales, needs_review:false, confidence:bestPB.confidence,
      evidencia:{base, idx:bestPB.idx, portales, razon:"portales PB → núcleos"}};
  } else {
    v78 = {pred_n:base.pred_n??null, needs_review:true,
      confidence:bestPB?.confidence??0,
      evidencia:{base, motivo: bestPB?"PB conf baja":"sin PB legible"}};
  }
  return {v77, v78};
}

Deno.serve(async (req)=>{
  if (req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if(!apiKey) return new Response(JSON.stringify({error:"missing key"}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  const body = await req.json().catch(()=>({}));
  const set_name:string = body.set_name ?? "ctrl_10x10_v1";
  const batchSize:number = Math.max(1, Math.min(5, Number(body.batch_size ?? 3)));
  const force:boolean = body.force === true;
  const onlyIds:string[]|null = Array.isArray(body.building_ids)&&body.building_ids.length ? body.building_ids : null;
  const sb = createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let q = sb.from("escaleras_control_set").select("building_id,gt").eq("set_name",set_name);
  if (onlyIds) q = q.in("building_id",onlyIds);
  const { data: rows, error } = await q;
  if (error) return new Response(JSON.stringify({error:error.message}),{status:500,headers:{...corsHeaders,"Content-Type":"application/json"}});
  let items = rows ?? [];

  if (!force && items.length) {
    const { data: done } = await sb.from("escaleras_eval_results")
      .select("building_id,version").in("version",["v7.7","v7.8"])
      .eq("set_name",set_name).in("building_id",items.map((i:any)=>i.building_id));
    const counts = new Map<string,number>();
    (done??[]).forEach((d:any)=>counts.set(d.building_id,(counts.get(d.building_id)??0)+1));
    items = items.filter((i:any)=>(counts.get(i.building_id)??0)<2);
  }

  const batch = items.slice(0, batchSize);
  const remaining = items.slice(batchSize).map((i:any)=>i.building_id);

  const run = async () => {
    for (const it of batch) {
      try {
        const r = await evalOne(sb, apiKey, set_name, it.building_id, it.gt);
        for (const [ver, res] of [["v7.7",r.v77],["v7.8",r.v78]] as const) {
          await sb.from("escaleras_eval_results").upsert({
            set_name, version:ver, building_id:it.building_id, gt:it.gt,
            pred_n: res.pred_n ?? null,
            pred_segundas: res.pred_n==null ? null : res.pred_n>=2,
            needs_review: !!res.needs_review,
            confidence: res.confidence ?? null,
            evidencia: res.evidencia ?? null,
            error: res.error ?? null,
          },{onConflict:"set_name,version,building_id"});
        }
      } catch(e) { console.warn("v7.7/8 err", it.building_id, (e as Error).message); }
      await new Promise(r=>setTimeout(r,400));
    }
    if (remaining.length) {
      try {
        await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/eval-escaleras-v7-7-8`,{
          method:"POST",
          headers:{"Content-Type":"application/json",
            Authorization:`Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            apikey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!},
          body:JSON.stringify({set_name, building_ids:remaining, batch_size:batchSize, force}),
        });
      } catch(e){ console.warn("v7.7/8 reinvoke fail",(e as Error).message); }
    }
  };
  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(run());
  return new Response(JSON.stringify({ok:true,async:true,batch:batch.length,remaining:remaining.length}),
    {status:202,headers:{...corsHeaders,"Content-Type":"application/json"}});
});