// detect_pipeline_hygiene — D.4 Pipeline Hygiene Coach
// Detecta problemas de higiene en deals NO terminales y crea next_actions.
// HubSpot read-only. Idempotente por día.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const TERMINAL_REGEX = /(ganado|perdido|cerrado|no\s*vende|descartad|no\s*interesa|fuera\s*de\s*precio|closed[_\s]?(won|lost)|lost|won)/i;
const HARDCODED_TERMINAL = new Set(['closedwon','closedlost']);
const ADVANCED_REGEX = /(negoci|oferta|propuesta|visita|cierre|firma)/i;
const NEGOTIATION_REGEX = /(negoci|propuesta|oferta)/i;
const STALE_NEGO_DAYS = 30;
const MAX_PER_RUN = 10;

type StageMap = Record<string,{label:string;terminal:boolean}>;

async function loadDealStageMap(): Promise<StageMap> {
  const out: StageMap = {};
  try {
    const data = await hubspotFetch('/crm/v3/pipelines/deals');
    for (const pipe of (data?.results || [])) {
      for (const st of (pipe.stages || [])) {
        const id = String(st.id);
        const label = String(st.label || '');
        const closed = !!(st.metadata?.isClosed === 'true' || st.metadata?.isClosed === true);
        const terminal = closed || TERMINAL_REGEX.test(label) || HARDCODED_TERMINAL.has(id);
        out[id] = { label, terminal };
      }
    }
  } catch (e) { console.error('pipelines fetch failed', e); }
  return out;
}

const PROBLEMS: Record<string,{titulo:string;detalle:string}> = {
  a: { titulo: '[HYGIENE-a] Deal sin tarea pendiente', detalle: 'Crea una tarea de seguimiento en HubSpot para no perder el hilo.' },
  b: { titulo: '[HYGIENE-b] Deal sin fecha de cierre', detalle: 'Asigna un closedate realista al deal en HubSpot para forecasting.' },
  c: { titulo: '[HYGIENE-c] Deal sin propietario asignado', detalle: 'Asocia un contacto propietario al deal en HubSpot.' },
  d: { titulo: '[HYGIENE-d] Negociación >30d sin avance', detalle: 'Avanza la etapa o cierra el deal: lleva más de 30 días sin movimiento de stage.' },
  e: { titulo: '[HYGIENE-e] Etapa avanzada con amount vacío/0', detalle: 'Carga el importe del deal en HubSpot — la etapa actual exige amount.' },
  f: { titulo: '[HYGIENE-f] Propietario sin contacto asociado al deal', detalle: 'Vincula los contactos propietarios al deal en HubSpot (associations).' },
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch {}
  const onlyId: string | undefined = body.building_id;
  const chain: boolean = body.chain !== false;

  const stageMap = await loadDealStageMap();
  const terminalIds = Object.entries(stageMap).filter(([_,v])=>v.terminal).map(([k])=>k);

  const today = new Date().toISOString().slice(0,10);
  const todayStart = today + 'T00:00:00Z';

  // Buildings ya procesados hoy (cursor)
  const { data: doneToday } = await supabase.from('next_actions')
    .select('scope_id').eq('scope_type','building').eq('origen','pipeline_hygiene')
    .gte('created_at', todayStart);
  const doneSet = new Set((doneToday||[]).map((r:any)=>r.scope_id).filter(Boolean));

  let q = supabase.from('buildings').select('id, direccion, metadatos');
  if (onlyId) q = q.eq('id', onlyId);
  else {
    if (terminalIds.length) q = q.not('metadatos->>dealstage','in',`(${terminalIds.map(x=>`"${x}"`).join(',')})`);
    if (doneSet.size) q = q.not('id','in',`(${Array.from(doneSet).map(x=>`"${x}"`).join(',')})`);
    q = q.limit(MAX_PER_RUN);
  }
  const { data: bs, error: bErr } = await q;
  if (bErr) return new Response(JSON.stringify({ ok:false, error:bErr.message }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'}});

  let scanned=0, with_problems=0, total_problems=0, errors=0, skipped_terminal=0;
  const dist: Record<string,number> = { a:0,b:0,c:0,d:0,e:0,f:0 };
  const perBuilding: Array<{ building_id:string; direccion:string; problems:string[] }> = [];

  for (const b of (bs||[])) {
    scanned++;
    const meta:any = b.metadatos || {};
    const dealstageId = meta.dealstage ? String(meta.dealstage) : null;
    const stageInfo = dealstageId ? stageMap[dealstageId] : null;
    if (stageInfo?.terminal) { skipped_terminal++; continue; }
    const stageLabel = stageInfo?.label || '';
    const dealId = meta._hubspot_deal_id ? String(meta._hubspot_deal_id) : null;

    const problems: string[] = [];

    // Rule a: tarea pendiente
    if (dealId) {
      const { data: tasks } = await supabase.from('hubspot_tasks')
        .select('hs_task_status').contains('associated_deal_ids', [dealId]);
      const hasPending = (tasks||[]).some((t:any)=> t.hs_task_status && String(t.hs_task_status).toUpperCase() !== 'COMPLETED');
      if (!hasPending) problems.push('a');
    } else { problems.push('a'); }

    // Rule b: closedate
    const cd = meta.closedate;
    const cdDate = cd ? new Date(cd).getTime() : 0;
    if (!cd || (cdDate && cdDate < Date.now())) problems.push('b');

    // Rule c: building_owners vacío
    const { count: ownersCount } = await supabase.from('building_owners')
      .select('owner_id', { count:'exact', head:true }).eq('building_id', b.id);
    if (!ownersCount || ownersCount === 0) problems.push('c');

    // Rule d: negociación >30d sin cambio
    if (NEGOTIATION_REGEX.test(stageLabel)) {
      const lastMod = meta.hs_lastmodifieddate ? new Date(meta.hs_lastmodifieddate).getTime() : 0;
      const days = lastMod ? (Date.now()-lastMod)/86400000 : 9999;
      if (days > STALE_NEGO_DAYS) problems.push('d');
    }

    // Rule e: amount vacío en etapa avanzada
    if (ADVANCED_REGEX.test(stageLabel)) {
      const amt = parseFloat(meta.amount || '0');
      if (!amt || amt <= 0) problems.push('e');
    }

    // Rule f: owners pero sin contacts asociados al deal
    if (ownersCount && ownersCount > 0 && dealId) {
      const { data: eng } = await supabase.from('hubspot_calls')
        .select('associated_contact_ids').contains('associated_deal_ids',[dealId]).limit(1);
      const { data: eng2 } = await supabase.from('hubspot_notes')
        .select('associated_contact_ids').contains('associated_deal_ids',[dealId]).limit(1);
      const anyContact = [...(eng||[]),...(eng2||[])].some((r:any)=> Array.isArray(r.associated_contact_ids) && r.associated_contact_ids.length>0);
      if (!anyContact) problems.push('f');
    }

    if (!problems.length) continue;
    with_problems++;

    // Idempotencia: borra todas las hygiene actions de hoy para este building y reinserta
    await supabase.from('next_actions').delete()
      .eq('scope_type','building').eq('scope_id', b.id).eq('origen','pipeline_hygiene')
      .gte('created_at', todayStart);

    const venc = new Date(); venc.setDate(venc.getDate()+1);
    const vencStr = venc.toISOString().slice(0,10);
    const rows = problems.map(code => ({
      scope_type:'building', scope_id: b.id,
      titulo: PROBLEMS[code].titulo,
      detalle: PROBLEMS[code].detalle + ` (Edificio: ${b.direccion}, etapa: ${stageLabel || '?'})`,
      vencimiento: vencStr,
      estado:'pendiente',
      origen:'pipeline_hygiene',
    }));
    const { error: insErr } = await supabase.from('next_actions').insert(rows);
    if (insErr) { errors++; console.error('hygiene insert', insErr); continue; }
    problems.forEach(c => { dist[c]=(dist[c]||0)+1; total_problems++; });
    perBuilding.push({ building_id: b.id, direccion: b.direccion, problems });
  }

  await supabase.from('agent_runs').insert({
    agent_name:'pipeline_hygiene',
    scope_type: onlyId ? 'building' : 'global',
    scope_id: onlyId || null,
    latencia_ms: Date.now()-t0,
    resultado: { scanned, with_problems, total_problems, dist, errors, already_done_today: doneSet.size },
  });

  let chained = false;
  if (chain && !onlyId && scanned >= MAX_PER_RUN) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/detect_pipeline_hygiene`;
      // @ts-ignore
      EdgeRuntime.waitUntil(fetch(url, {
        method:'POST',
        headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ chain: true }),
      }).catch(()=>{}));
      chained = true;
    } catch (e) { console.error('chain fail', e); }
  }

  // top-5 buildings con más problemas (de este chunk)
  const top5 = [...perBuilding].sort((a,b)=> b.problems.length - a.problems.length).slice(0,5);

  return new Response(JSON.stringify({
    ok:true, scanned, with_problems, total_problems, distribucion: dist,
    skipped_terminal, errors, already_done_today: doneSet.size, chained,
    phase: chained ? 'continuing' : 'done', top5,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type':'application/json' } });
});