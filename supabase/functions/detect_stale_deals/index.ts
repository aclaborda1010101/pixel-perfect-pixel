// detect_stale_deals — D.3 Stale Deal Reviver
// Detecta buildings con dealstage no-terminal y > 14 días sin actividad,
// llama Lovable AI para sugerir próxima acción y persiste en next_actions.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const STALE_DAYS = 14;
const TERMINAL_REGEX = /(ganado|perdido|cerrado|no\s*vende|descartad|no\s*interesa|fuera\s*de\s*precio|closed[_\s]?(won|lost)|lost|won)/i;
const HARDCODED_TERMINAL = new Set(['closedwon','closedlost']);
const MAX_PER_RUN = 50;

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

function urgencyToDueDate(u: string): string {
  const d = new Date();
  if (u === 'alta') d.setDate(d.getDate()+1);
  else if (u === 'media') d.setDate(d.getDate()+3);
  else d.setDate(d.getDate()+7);
  return d.toISOString().slice(0,10);
}

async function aiSuggest(ctx: any): Promise<any> {
  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const prompt = `Eres un consultor inmobiliario senior especializado en captación de edificios en Madrid. Analiza este deal estancado y propone la mejor próxima acción.

CONTEXTO:
- Edificio: ${ctx.direccion} (${ctx.ciudad || 'desc'})
- Etapa actual: ${ctx.dealstage_label || ctx.dealstage_id || 'desconocida'}
- Días sin actividad: ${ctx.dias_sin_actividad}
- Última llamada (resumen): ${ctx.ultima_call_resumen || 'ninguna'}
- Influencer principal: ${ctx.influencer_nombre || 'no identificado'} (rol=${ctx.influencer_rol || '-'}, persona=${ctx.influencer_persona || '-'})
- Número de propietarios: ${ctx.numero_propietarios || '?'}

Devuelve estrictamente este JSON (sin texto adicional):
{"proxima_accion":"llamar|whatsapp|email|visita|esperar|descartar","urgencia":"alta|media|baja","razon":"motivo en 1 frase","mensaje_sugerido":"mensaje listo para enviar al comercial, máx 2 frases en español"}`;
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method:'POST',
    headers:{Authorization:`Bearer ${LK}`,'Content-Type':'application/json'},
    body: JSON.stringify({
      model:'google/gemini-3-flash-preview',
      messages:[{role:'user',content:prompt}],
      response_format:{type:'json_object'},
    }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${await r.text()}`);
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content || '{}';
  try { return JSON.parse(txt); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const onlyId: string | undefined = body.building_id;

  const stageMap = await loadDealStageMap();
  const stageMapSize = Object.keys(stageMap).length;

  // Selecciona buildings candidatos
  let q = supabase.from('buildings').select('id, direccion, ciudad, numero_propietarios, last_synced_at, metadatos').order('last_synced_at', { ascending: true });
  if (onlyId) q = q.eq('id', onlyId);
  else q = q.limit(800);
  const { data: bs, error: bErr } = await q;
  if (bErr) return new Response(JSON.stringify({ ok:false, error:bErr.message }), { status:500, headers:{...corsHeaders,'Content-Type':'application/json'}});

  let scanned=0, stale=0, suggested=0, skipped_terminal=0, skipped_recent=0, errors=0;
  const dist: Record<string,number> = { alta:0, media:0, baja:0 };
  const top: any[] = [];

  for (const b of (bs||[])) {
    if (suggested >= MAX_PER_RUN && !onlyId) break;
    scanned++;
    const meta:any = b.metadatos || {};
    const dealstageId = meta.dealstage ? String(meta.dealstage) : null;
    const stageInfo = dealstageId ? stageMap[dealstageId] : null;
    if (stageInfo?.terminal) { skipped_terminal++; continue; }

    // Última actividad
    const { data: lastCallArr } = await supabase
      .from('calls').select('fecha,resumen').eq('owner_id', null as any).limit(1); // placeholder, will replace
    // Actividad real: vía associated_contact_ids en hubspot_*; pero más simple — usar last_synced_at + última call/note via hubspot_calls/notes asociados al deal
    const dealId = meta._hubspot_deal_id ? String(meta._hubspot_deal_id) : null;
    let lastCall: any = null, lastNote: any = null, lastTask: any = null;
    if (dealId) {
      const { data: c } = await supabase.from('hubspot_calls').select('hs_timestamp,hs_call_body,hs_call_title').contains('associated_deal_ids', [dealId]).order('hs_timestamp',{ascending:false}).limit(1);
      lastCall = c?.[0] || null;
      const { data: n } = await supabase.from('hubspot_notes').select('hs_timestamp,hs_note_body').contains('associated_deal_ids', [dealId]).order('hs_timestamp',{ascending:false}).limit(1);
      lastNote = n?.[0] || null;
      const { data: t } = await supabase.from('hubspot_tasks').select('hs_task_completion_date,hs_lastmodifieddate,hs_task_subject').contains('associated_deal_ids', [dealId]).order('hs_lastmodifieddate',{ascending:false}).limit(1);
      lastTask = t?.[0] || null;
    }
    const candidates = [
      lastCall?.hs_timestamp, lastNote?.hs_timestamp,
      lastTask?.hs_task_completion_date || lastTask?.hs_lastmodifieddate,
      b.last_synced_at, meta.hs_lastmodifieddate,
    ].filter(Boolean).map((x:string)=> new Date(x).getTime()).filter(Number.isFinite);
    const lastActivity = candidates.length ? Math.max(...candidates) : 0;
    const days = lastActivity ? Math.floor((Date.now()-lastActivity)/86400000) : 9999;
    if (days < STALE_DAYS) { skipped_recent++; continue; }
    stale++;

    // Influencer
    const { data: bo } = await supabase.from('building_owners')
      .select('owner_id, es_influencer, owners(nombre, rol, buyer_persona)')
      .eq('building_id', b.id).eq('es_influencer', true).limit(1);
    const inf:any = bo?.[0] || null;
    const ownerInf:any = inf?.owners || null;

    let ai:any = null;
    try {
      ai = await aiSuggest({
        direccion: b.direccion, ciudad: b.ciudad,
        dealstage_label: stageInfo?.label, dealstage_id: dealstageId,
        dias_sin_actividad: days,
        ultima_call_resumen: lastCall?.hs_call_body?.slice(0,400) || null,
        influencer_nombre: ownerInf?.nombre || null,
        influencer_rol: ownerInf?.rol || null,
        influencer_persona: ownerInf?.buyer_persona || null,
        numero_propietarios: b.numero_propietarios,
      });
    } catch (e) { errors++; console.error('AI fail', b.id, e); continue; }
    if (!ai || !ai.proxima_accion) { errors++; continue; }
    const urg = ['alta','media','baja'].includes(ai.urgencia) ? ai.urgencia : 'media';
    dist[urg] = (dist[urg]||0)+1;

    // Upsert idempotente vía índice único (scope_type,scope_id,origen,date)
    const today = new Date().toISOString().slice(0,10);
    // Try delete-then-insert para idempotencia (no hay onConflict por expression)
    await supabase.from('next_actions').delete()
      .eq('scope_type','building').eq('scope_id', b.id).eq('origen','stale_deal_reviver')
      .gte('created_at', today+'T00:00:00Z').lte('created_at', today+'T23:59:59Z');
    const { error: insErr } = await supabase.from('next_actions').insert({
      scope_type: 'building', scope_id: b.id,
      titulo: `[${urg.toUpperCase()}] ${ai.razon || ai.proxima_accion}`.slice(0,200),
      detalle: ai.mensaje_sugerido || null,
      vencimiento: urgencyToDueDate(urg),
      estado: 'pendiente',
      origen: 'stale_deal_reviver',
    });
    if (insErr) { errors++; console.error('insert fail', insErr); continue; }
    suggested++;
    if (top.length < 5) top.push({ building_id: b.id, direccion: b.direccion, dias: days, urgencia: urg, accion: ai.proxima_accion, razon: ai.razon, mensaje: ai.mensaje_sugerido });
  }

  await supabase.from('agent_runs').insert({
    agent_name: 'stale_deal_reviver',
    scope_type: onlyId ? 'building' : 'global',
    scope_id: onlyId || null,
    modelo: 'google/gemini-3-flash-preview',
    latencia_ms: Date.now()-t0,
    resultado: { scanned, stale, suggested, skipped_terminal, skipped_recent, errors, dist, stageMapSize },
  });

  return new Response(JSON.stringify({
    ok: true, scanned, stale, suggested, skipped_terminal, skipped_recent, errors, distribucion: dist, top, stageMapSize,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type':'application/json' } });
});