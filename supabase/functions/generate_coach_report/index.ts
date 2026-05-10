// generate_coach_report — F.1.c Coach IA semanal
// Single: { owner_id, week_start? }   -> genera reporte para 1 comercial
// Batch:  { chain?: true } sin owner_id -> procesa MAX_REPORTS_PER_RUN comerciales activos
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const MAX_REPORTS_PER_RUN = 5;

function lastMondayISO(d = new Date()): string {
  const x = new Date(d);
  const day = x.getUTCDay(); // 0=dom
  const diff = (day === 0 ? 6 : day - 1);
  x.setUTCDate(x.getUTCDate() - diff);
  x.setUTCHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
}
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function buildReport(supabase: any, owner_id: string, week_start: string) {
  const week_end = addDaysISO(week_start, 7);
  // calls de la semana
  const { data: calls } = await supabase.from('calls')
    .select('id, fecha, duracion_seg, outcome, sentiment, objeciones, tecnica_score, ratio_comercial_cliente, frases_clave_positivas, frases_clave_negativas, resumen, siguiente_accion')
    .eq('owner_id', owner_id)
    .gte('fecha', week_start)
    .lt('fecha', week_end);
  const list = calls || [];

  // métricas
  const total = list.length;
  const interesados = list.filter((c: any) => c.outcome === 'interesado').length;
  const no_int = list.filter((c: any) => c.outcome === 'no_interesado').length;
  const pos = list.filter((c: any) => c.sentiment === 'positivo').length;
  const neg = list.filter((c: any) => c.sentiment === 'negativo').length;
  const tec = list.filter((c: any) => c.tecnica_score != null).map((c: any) => c.tecnica_score);
  const ratios = list.filter((c: any) => c.ratio_comercial_cliente != null).map((c: any) => c.ratio_comercial_cliente);
  const dur = list.filter((c: any) => c.duracion_seg).map((c: any) => c.duracion_seg);
  const objCount: Record<string, number> = {};
  for (const c of list) for (const o of (c.objeciones || [])) objCount[o] = (objCount[o] || 0) + 1;
  const top_objeciones = Object.entries(objCount).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5);
  const ganadoras = list.filter((c: any) => c.outcome === 'interesado').flatMap((c: any) => c.frases_clave_positivas || []).slice(0, 30);
  const perdedoras = list.filter((c: any) => c.outcome === 'no_interesado').flatMap((c: any) => c.frases_clave_negativas || []).slice(0, 30);

  const metricas = {
    total, interesados, no_interesados: no_int,
    conversion: total ? +(interesados / total * 100).toFixed(1) : 0,
    sentiment_positivo_pct: total ? +(pos / total * 100).toFixed(1) : 0,
    sentiment_negativo_pct: total ? +(neg / total * 100).toFixed(1) : 0,
    tecnica_media: tec.length ? +(tec.reduce((a: any, b: any) => a + b, 0) / tec.length).toFixed(1) : null,
    ratio_comercial_cliente_medio: ratios.length ? +(ratios.reduce((a: any, b: any) => a + b, 0) / ratios.length).toFixed(2) : null,
    duracion_media_seg: dur.length ? Math.round(dur.reduce((a: any, b: any) => a + b, 0) / dur.length) : null,
    top_objeciones,
  };

  if (total === 0) {
    return {
      week_start, week_end, total_calls: 0, metricas,
      fortalezas: [], mejoras: [],
      frases_ganadoras: [],
      plan_accion: [{ titulo: 'Sin actividad esta semana', detalle: 'No se registran llamadas. Revisa cadencia y agenda.' }],
    };
  }

  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const prompt = `Eres un coach comercial senior especializado en captación inmobiliaria en España. Genera un reporte de coaching personalizado en castellano basándote EXCLUSIVAMENTE en estos datos reales del comercial durante la semana ${week_start} a ${week_end}.

DATOS:
${JSON.stringify(metricas, null, 2)}

EJEMPLOS DE FRASES GANADORAS DETECTADAS (de calls con resultado=interesado):
${ganadoras.slice(0, 10).map((f: string) => `- "${f}"`).join('\n') || '- (ninguna)'}

EJEMPLOS DE FRASES PERDEDORAS DETECTADAS (de calls con resultado=no_interesado):
${perdedoras.slice(0, 10).map((f: string) => `- "${f}"`).join('\n') || '- (ninguna)'}

Devuelve EXCLUSIVAMENTE este JSON:
{
  "fortalezas": [{"titulo":"...","detalle":"..."}, ... 3 items],
  "mejoras": [{"titulo":"...","detalle":"..."}, ... 3 items],
  "frases_ganadoras": ["frase 1", ... hasta 5 frases concretas, idealmente literales del listado anterior],
  "plan_accion": [{"titulo":"...","detalle":"...","kpi":"..."}, ... 3-5 items concretos para la próxima semana]
}

Sé específico, directo y accionable. Cita números reales. Tono profesional, en castellano.`;

  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = await r.json();
  const ai = JSON.parse(j?.choices?.[0]?.message?.content || '{}');

  return {
    week_start, week_end, total_calls: total, metricas,
    fortalezas: Array.isArray(ai.fortalezas) ? ai.fortalezas.slice(0, 5) : [],
    mejoras: Array.isArray(ai.mejoras) ? ai.mejoras.slice(0, 5) : [],
    frases_ganadoras: Array.isArray(ai.frases_ganadoras) ? ai.frases_ganadoras.filter((x: any) => typeof x === 'string').slice(0, 8) : [],
    plan_accion: Array.isArray(ai.plan_accion) ? ai.plan_accion.slice(0, 6) : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }

  const week_start: string = body.week_start || lastMondayISO();

  const persistOne = async (owner_id: string) => {
    const rep = await buildReport(supabase, owner_id, week_start);
    const { error } = await supabase.from('coach_reports').upsert({
      owner_id,
      week_start: rep.week_start,
      week_end: rep.week_end,
      fortalezas: rep.fortalezas,
      mejoras: rep.mejoras,
      frases_ganadoras: rep.frases_ganadoras,
      plan_accion: rep.plan_accion,
      total_calls: rep.total_calls,
      metricas: rep.metricas,
      generated_at: new Date().toISOString(),
    }, { onConflict: 'owner_id,week_start' });
    if (error) throw new Error(error.message);
    return rep;
  };

  // SINGLE
  if (body.owner_id) {
    try {
      const rep = await persistOne(body.owner_id);
      return new Response(JSON.stringify({ ok: true, owner_id: body.owner_id, report: rep }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  // BATCH: comerciales con al menos 1 call en la semana
  const week_end = addDaysISO(week_start, 7);
  const { data: ownersWithCalls } = await supabase.from('calls')
    .select('owner_id').gte('fecha', week_start).lt('fecha', week_end).not('owner_id', 'is', null);
  const ownerIds = Array.from(new Set((ownersWithCalls || []).map((r: any) => r.owner_id)));

  // Excluye los ya generados esta semana
  const { data: doneRep } = await supabase.from('coach_reports').select('owner_id').eq('week_start', week_start);
  const doneSet = new Set((doneRep || []).map((r: any) => r.owner_id));
  const pending = ownerIds.filter((id: any) => !doneSet.has(id)).slice(0, MAX_REPORTS_PER_RUN);

  let ok = 0, fail = 0;
  const reports: any[] = [];
  for (const oid of pending) {
    try {
      const rep = await persistOne(oid as string);
      reports.push({ owner_id: oid, fortalezas_n: rep.fortalezas.length, total_calls: rep.total_calls });
      ok++;
    } catch (e: any) {
      console.error('coach fail', oid, e);
      fail++;
    }
  }

  // Chain si quedan más
  const remaining = ownerIds.filter((id: any) => !doneSet.has(id)).length - pending.length;
  let chained = false;
  if (body.chain !== false && remaining > 0) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate_coach_report`;
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ week_start, chain: true }),
      }).catch(() => {}));
      chained = true;
    } catch (e) { console.error('chain fail', e); }
  }

  return new Response(JSON.stringify({
    ok: true, week_start, candidates: ownerIds.length, processed: pending.length,
    ok_count: ok, fail_count: fail, remaining, chained,
    phase: chained ? 'continuing' : 'done', reports, latencia_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});