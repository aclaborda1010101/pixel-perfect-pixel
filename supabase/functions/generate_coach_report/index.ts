// generate_coach_report — F.1.c Coach IA semanal (por comercial real de HubSpot)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const MAX_REPORTS_PER_RUN = 5;
const MIN_CALLS_FOR_REPORT = 10;

function lastMondayISO(d = new Date()): string {
  const x = new Date(d);
  const day = x.getUTCDay();
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
function todayISO(): string { return new Date().toISOString().slice(0, 10); }
function daysAgoISO(n: number): string {
  const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10);
}

async function buildReport(supabase: any, comercial_hs_id: string, week_start: string, week_end: string) {
  const { data: calls } = await supabase.from('calls')
    .select('id, fecha, duracion_seg, outcome, sentiment, objeciones, tecnica_score, ratio_comercial_cliente, pivot_moments, tacticas_usadas, owner_id, comercial_nombre')
    .eq('comercial_hs_id', comercial_hs_id)
    .gte('fecha', week_start)
    .lte('fecha', week_end + 'T23:59:59Z');
  const list = calls || [];
  const comercial_nombre = list.find((c: any) => c.comercial_nombre)?.comercial_nombre || comercial_hs_id;

  const total = list.length;
  const interesados = list.filter((c: any) => c.outcome === 'interesado').length;
  const no_int = list.filter((c: any) => c.outcome === 'no_interesado').length;
  const pos = list.filter((c: any) => c.sentiment === 'positivo').length;
  const neg = list.filter((c: any) => c.sentiment === 'negativo').length;
  const tec = list.filter((c: any) => c.tecnica_score != null).map((c: any) => c.tecnica_score);
  const ratios = list.filter((c: any) => c.ratio_comercial_cliente != null).map((c: any) => c.ratio_comercial_cliente);
  // Duración media solo cuenta llamadas reales: excluye no contestadas y duración 0/null
  const dur = list
    .filter((c: any) => c.outcome !== 'no_contestado' && c.duracion_seg && c.duracion_seg > 0)
    .map((c: any) => c.duracion_seg);
  const objCount: Record<string, number> = {};
  for (const c of list) for (const o of (c.objeciones || [])) objCount[o] = (objCount[o] || 0) + 1;
  const top_objeciones = Object.entries(objCount).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5);

  // Análisis causal: agrega pivot_moments
  const allPivots: any[] = [];
  for (const c of list) {
    for (const p of (c.pivot_moments || [])) allPivots.push({ ...p, call_id: c.id, fecha: c.fecha, outcome: c.outcome });
  }
  const tacticaStats: Record<string, { total: number; alto: number; medio: number; bajo: number; positivo: number; negativo: number }> = {};
  for (const p of allPivots) {
    const t = p.tactica;
    if (!t) continue;
    tacticaStats[t] = tacticaStats[t] || { total: 0, alto: 0, medio: 0, bajo: 0, positivo: 0, negativo: 0 };
    const s = tacticaStats[t];
    s.total++;
    if (p.impacto === 'alto') s.alto++;
    else if (p.impacto === 'medio') s.medio++;
    else if (p.impacto === 'bajo') s.bajo++;
    if (p.estado_cliente_despues === 'curioso' || p.estado_cliente_despues === 'considerando' || p.estado_cliente_despues === 'comprometido') s.positivo++;
    else if (p.estado_cliente_despues === 'cerrado_negativo') s.negativo++;
  }
  const tacticaArr = Object.entries(tacticaStats).map(([tactica, s]: any) => ({
    tactica, total: s.total, alto: s.alto,
    ratio_alto: s.total ? +(s.alto / s.total * 100).toFixed(1) : 0,
    ratio_positivo: s.total ? +(s.positivo / s.total * 100).toFixed(1) : 0,
    ratio_negativo: s.total ? +(s.negativo / s.total * 100).toFixed(1) : 0,
  }));
  const tacticas_efectivas = [...tacticaArr].sort((a, b) => b.ratio_alto - a.ratio_alto).slice(0, 5);
  const tacticas_fallidas = [...tacticaArr].filter(t => t.ratio_negativo > 0).sort((a, b) => b.ratio_negativo - a.ratio_negativo).slice(0, 5);
  const top_pivots_alto = allPivots
    .filter((p: any) => p.impacto === 'alto')
    .slice(0, 8);

  const metricas = {
    comercial_nombre, total, interesados, no_interesados: no_int,
    conversion: total ? +(interesados / total * 100).toFixed(1) : 0,
    sentiment_positivo_pct: total ? +(pos / total * 100).toFixed(1) : 0,
    sentiment_negativo_pct: total ? +(neg / total * 100).toFixed(1) : 0,
    tecnica_media: tec.length ? +(tec.reduce((a: any, b: any) => a + b, 0) / tec.length).toFixed(1) : null,
    ratio_comercial_cliente_medio: ratios.length ? +(ratios.reduce((a: any, b: any) => a + b, 0) / ratios.length).toFixed(2) : null,
    duracion_media_seg: dur.length ? Math.round(dur.reduce((a: any, b: any) => a + b, 0) / dur.length) : null,
    top_objeciones,
    pivot_moments_total: allPivots.length,
    pivot_moments_por_call: total ? +(allPivots.length / total).toFixed(2) : 0,
    tacticas_efectivas,
    tacticas_fallidas,
  };

  if (total < MIN_CALLS_FOR_REPORT) {
    return {
      week_start, week_end, total_calls: total, metricas, comercial_nombre,
      fortalezas: [], mejoras: [],
      frases_ganadoras: [],
      plan_accion: [{
        titulo: total === 0 ? 'Sin actividad en este periodo' : 'Muestra insuficiente para coaching',
        detalle: total === 0
          ? 'No se registran llamadas en el rango seleccionado. Revisa cadencia y agenda.'
          : `Solo ${total} llamadas en el rango. Mínimo ${MIN_CALLS_FOR_REPORT} para generar un plan fiable.`,
      }],
      skipped: true,
    };
  }

  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const prompt = `Eres un coach comercial senior especializado en captación inmobiliaria en España. Genera un reporte de coaching CAUSAL en castellano para ${comercial_nombre} basándote EXCLUSIVAMENTE en estos datos reales del periodo ${week_start} a ${week_end}.

MÉTRICAS:
${JSON.stringify(metricas, null, 2)}

TOP MOMENTOS PIVOTE DE ALTO IMPACTO (sus propias calls):
${top_pivots_alto.map((p: any) => `- [${p.estado_cliente_antes} → ${p.estado_cliente_despues}] tactica=${p.tactica} | "${p.trigger_frase}" (objeción: ${p.objecion_neutralizada || '-'})`).join('\n') || '- (ninguno detectado)'}

TÁCTICAS QUE LE FUNCIONAN (mayor % de impacto alto):
${tacticas_efectivas.map((t: any) => `- ${t.tactica}: ${t.alto}/${t.total} alto (${t.ratio_alto}%)`).join('\n') || '- (sin datos)'}

TÁCTICAS QUE LE FALLAN (mayor % de cierre negativo):
${tacticas_fallidas.map((t: any) => `- ${t.tactica}: ${t.ratio_negativo}% acaba en cerrado_negativo`).join('\n') || '- (sin datos)'}

Devuelve EXCLUSIVAMENTE este JSON:
{
  "fortalezas": [{"titulo":"...","detalle":"..."}, ... 2-3 items, citando tácticas concretas con sus ratios],
  "mejoras": [{"titulo":"...","detalle":"..."}, ... 2-3 items, identificando patrones que están fallando],
  "frases_ganadoras": ["frase 1", ... hasta 5 — usa las trigger_frase reales del comercial cuando tengan impacto alto],
  "top_pivots": [{"estado_antes":"...","estado_despues":"...","tactica":"...","frase":"...","por_que_funciono":"..."}, ... hasta 3],
  "recomendaciones": [{"contexto":"cuando aparece objeción X con buyer_persona Y","recomendacion":"usa táctica Z porque convierte W%"}, ... hasta 3],
  "plan_accion": [{"titulo":"...","detalle":"...","kpi":"..."}, ... 3-5 items concretos]
}

CRÍTICO: cita números reales y tácticas concretas. NO generalices. Si una táctica tiene ratio bajo, recomienda probar otra y di cuál. Tono profesional, directo, en castellano.`;

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
    week_start, week_end, total_calls: total, metricas, comercial_nombre,
    fortalezas: Array.isArray(ai.fortalezas) ? ai.fortalezas.slice(0, 5) : [],
    mejoras: Array.isArray(ai.mejoras) ? ai.mejoras.slice(0, 5) : [],
    frases_ganadoras: Array.isArray(ai.frases_ganadoras) ? ai.frases_ganadoras.filter((x: any) => typeof x === 'string').slice(0, 8) : [],
    plan_accion: Array.isArray(ai.plan_accion) ? ai.plan_accion.slice(0, 6) : [],
    top_pivots: Array.isArray(ai.top_pivots) ? ai.top_pivots.slice(0, 3) : [],
    recomendaciones: Array.isArray(ai.recomendaciones) ? ai.recomendaciones.slice(0, 5) : [],
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }

  // Acepta `from`/`to` (rango libre) o `week_start` (legacy, semana de 7d). Default = últimos 30d.
  const week_start: string = body.from || body.week_start || daysAgoISO(30);
  const week_end: string = body.to || (body.week_start ? addDaysISO(body.week_start, 6) : todayISO());

  const persistOne = async (comercial_hs_id: string) => {
    const rep = await buildReport(supabase, comercial_hs_id, week_start, week_end);
    // owner_id es NOT NULL en esquema; usar un owner_id real de las calls del comercial como placeholder
    const { data: anyCall } = await supabase.from('calls').select('owner_id')
      .eq('comercial_hs_id', comercial_hs_id).not('owner_id','is',null).limit(1).maybeSingle();
    const placeholderOwner = anyCall?.owner_id || '00000000-0000-0000-0000-000000000000';
    await supabase.from('coach_reports').delete()
      .eq('comercial_hs_id', comercial_hs_id).eq('week_start', rep.week_start);
    const { error } = await supabase.from('coach_reports').insert({
      comercial_hs_id,
      owner_id: placeholderOwner,
      week_start: rep.week_start,
      week_end: rep.week_end,
      fortalezas: rep.fortalezas,
      mejoras: rep.mejoras,
      frases_ganadoras: rep.frases_ganadoras,
      plan_accion: rep.plan_accion,
      total_calls: rep.total_calls,
      metricas: { ...rep.metricas, top_pivots: rep.top_pivots || [], recomendaciones: rep.recomendaciones || [] },
      generated_at: new Date().toISOString(),
    });
    if (error) throw new Error(error.message);
    return rep;
  };

  if (body.comercial_hs_id || body.owner_id) {
    try {
      const cid = body.comercial_hs_id || body.owner_id;
      const rep = await persistOne(cid);
      return new Response(JSON.stringify({ ok: true, comercial_hs_id: cid, report: rep }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (e: any) {
      return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
  }

  const { data: callsRows } = await supabase.from('calls')
    .select('comercial_hs_id').gte('fecha', week_start).lte('fecha', week_end + 'T23:59:59Z').not('comercial_hs_id', 'is', null);
  const ownerIds = Array.from(new Set((callsRows || []).map((r: any) => r.comercial_hs_id)));

  const { data: doneRep } = await supabase.from('coach_reports').select('comercial_hs_id').eq('week_start', week_start).not('comercial_hs_id','is',null);
  const doneSet = new Set((doneRep || []).map((r: any) => r.comercial_hs_id));
  const pending = ownerIds.filter((id: any) => !doneSet.has(id)).slice(0, MAX_REPORTS_PER_RUN);

  let ok = 0, fail = 0;
  const reports: any[] = [];
  for (const cid of pending) {
    try {
      const rep = await persistOne(cid as string);
      reports.push({ comercial_hs_id: cid, comercial_nombre: rep.comercial_nombre, fortalezas_n: rep.fortalezas.length, total_calls: rep.total_calls });
      ok++;
    } catch (e: any) {
      console.error('coach fail', cid, e);
      fail++;
    }
  }

  const remaining = ownerIds.filter((id: any) => !doneSet.has(id)).length - pending.length;
  let chained = false;
  if (body.chain !== false && remaining > 0) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate_coach_report`;
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ from: week_start, to: week_end, chain: true }),
      }).catch(() => {}));
      chained = true;
    } catch (e) { console.error('chain fail', e); }
  }

  return new Response(JSON.stringify({
    ok: true, week_start, week_end, candidates: ownerIds.length, processed: pending.length,
    ok_count: ok, fail_count: fail, remaining, chained,
    phase: chained ? 'continuing' : 'done', reports, latencia_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
