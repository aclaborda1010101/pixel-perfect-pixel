// analyze_call — F.1.a: analiza transcripciones de calls con Lovable AI
// Modo single: { call_id }  -> analiza una y devuelve resultado
// Modo batch:  { chain: true | omitido } -> coge MAX_PER_RUN sin analyzar y encadena
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const MAX_PER_RUN = 20;
const MIN_CHARS = 200;

const VALID_OUTCOMES = ['interesado','dudoso','no_interesado','no_contestado','agente_bloqueado','otro'];
const VALID_SENTIMENT = ['positivo','neutro','negativo'];

function buildPrompt(transcript: string, dur: number): string {
  return `Eres un analista experto en llamadas comerciales inmobiliarias en España. Analiza la siguiente transcripción y devuelve EXCLUSIVAMENTE un JSON con este schema (sin texto adicional):

{
  "outcome": "interesado|dudoso|no_interesado|no_contestado|agente_bloqueado|otro",
  "sentiment": "positivo|neutro|negativo",
  "objeciones": ["precio"|"herederos"|"ya_en_venta"|"no_quiere_vender"|"timing"|"legal"|"sin_objecion"...],
  "tecnica_score": 0-100,
  "preguntas_abiertas": int,
  "preguntas_cerradas": int,
  "ratio_comercial_cliente": 0.0-1.0,
  "frases_clave_positivas": ["frase literal 1", "frase literal 2"],
  "frases_clave_negativas": ["frase literal 1"],
  "analisis_confianza": 0.0-1.0
}

REGLAS:
- "agente_bloqueado" = la persona que contesta es un portero, conserje, secretaria, asistente o filtro que NO deja hablar con el propietario.
- "no_contestado" = buzón, no responden, contestador, transcripción muy corta o vacía.
- "ratio_comercial_cliente" = fracción del tiempo que habla el comercial (0=todo cliente, 1=todo comercial). Estima por palabras.
- "tecnica_score": evalúa apertura, escucha activa, manejo de objeciones, cierre (0-100).
- "frases_clave_positivas": frases LITERALES del comercial o cliente que indican interés/avance.
- "frases_clave_negativas": frases LITERALES que muestran rechazo, freno o objeción dura.
- "objeciones": array de etiquetas estandarizadas (puede ser ["sin_objecion"] si no hubo).
- Si la transcripción es < 200 caracteres o vacía: outcome="no_contestado", sentiment="neutro", objeciones=["sin_objecion"], score=0, analisis_confianza<=0.3.

DURACIÓN: ${dur}s
TRANSCRIPCIÓN:
"""
${transcript.slice(0, 18000)}
"""`;
}

async function aiAnalyze(transcript: string, dur: number): Promise<any> {
  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-3-flash-preview',
      messages: [{ role: 'user', content: buildPrompt(transcript, dur) }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error(`AI ${r.status}: ${txt.slice(0, 300)}`);
  }
  const j = await r.json();
  const txt = j?.choices?.[0]?.message?.content || '{}';
  return { parsed: JSON.parse(txt), usage: j?.usage || {} };
}

function sanitize(a: any): any {
  const outcome = VALID_OUTCOMES.includes(a?.outcome) ? a.outcome : 'otro';
  const sentiment = VALID_SENTIMENT.includes(a?.sentiment) ? a.sentiment : 'neutro';
  const obj = Array.isArray(a?.objeciones) ? a.objeciones.filter((x: any) => typeof x === 'string').slice(0, 8) : [];
  return {
    outcome,
    sentiment,
    objeciones: obj,
    tecnica_score: Number.isFinite(a?.tecnica_score) ? Math.max(0, Math.min(100, Number(a.tecnica_score))) : null,
    preguntas_abiertas: Number.isFinite(a?.preguntas_abiertas) ? Math.max(0, Math.floor(Number(a.preguntas_abiertas))) : null,
    preguntas_cerradas: Number.isFinite(a?.preguntas_cerradas) ? Math.max(0, Math.floor(Number(a.preguntas_cerradas))) : null,
    ratio_comercial_cliente: Number.isFinite(a?.ratio_comercial_cliente) ? Math.max(0, Math.min(1, Number(a.ratio_comercial_cliente))) : null,
    frases_clave_positivas: Array.isArray(a?.frases_clave_positivas) ? a.frases_clave_positivas.filter((x: any) => typeof x === 'string').slice(0, 5) : [],
    frases_clave_negativas: Array.isArray(a?.frases_clave_negativas) ? a.frases_clave_negativas.filter((x: any) => typeof x === 'string').slice(0, 5) : [],
    analisis_confianza: Number.isFinite(a?.analisis_confianza) ? Math.max(0, Math.min(1, Number(a.analisis_confianza))) : 0.6,
  };
}

async function analyzeOne(supabase: any, callRow: any): Promise<{ ok: boolean; error?: string; result?: any }> {
  const t0 = Date.now();
  const transcript = (callRow.transcripcion || '').trim();
  const dur = callRow.duracion_seg || 0;

  let parsed: any = null;
  let usage: any = {};
  let modelo = 'google/gemini-3-flash-preview';

  if (!transcript || transcript.length < MIN_CHARS) {
    parsed = {
      outcome: 'no_contestado', sentiment: 'neutro',
      objeciones: ['sin_objecion'], tecnica_score: 0,
      preguntas_abiertas: 0, preguntas_cerradas: 0,
      ratio_comercial_cliente: null,
      frases_clave_positivas: [], frases_clave_negativas: [],
      analisis_confianza: 0.2,
    };
    modelo = 'heuristic';
  } else {
    try {
      const r = await aiAnalyze(transcript, dur);
      parsed = r.parsed;
      usage = r.usage;
    } catch (e: any) {
      await supabase.from('agent_runs').insert({
        agent_name: 'analyze_call', scope_type: 'call', scope_id: callRow.id,
        modelo, latencia_ms: Date.now() - t0, error: String(e.message || e).slice(0, 500),
      });
      return { ok: false, error: String(e.message || e) };
    }
  }

  const clean = sanitize(parsed);
  const { error: upErr } = await supabase.from('calls').update({
    ...clean,
    analyzed_at: new Date().toISOString(),
  }).eq('id', callRow.id);
  if (upErr) {
    await supabase.from('agent_runs').insert({
      agent_name: 'analyze_call', scope_type: 'call', scope_id: callRow.id,
      modelo, latencia_ms: Date.now() - t0, error: `update: ${upErr.message}`,
    });
    return { ok: false, error: upErr.message };
  }

  await supabase.from('agent_runs').insert({
    agent_name: 'analyze_call', scope_type: 'call', scope_id: callRow.id,
    modelo, latencia_ms: Date.now() - t0,
    tokens_in: usage?.prompt_tokens || null,
    tokens_out: usage?.completion_tokens || null,
    confianza: clean.analisis_confianza,
    resultado: { outcome: clean.outcome, sentiment: clean.sentiment },
  });

  return { ok: true, result: { id: callRow.id, ...clean } };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }

  // SINGLE
  if (body.call_id) {
    const { data: c, error } = await supabase.from('calls')
      .select('id, transcripcion, duracion_seg').eq('id', body.call_id).maybeSingle();
    if (error || !c) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const r = await analyzeOne(supabase, c);
    return new Response(JSON.stringify(r), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // BATCH
  const chain: boolean = body.chain !== false;
  const { data: rows, error } = await supabase.from('calls')
    .select('id, transcripcion, duracion_seg')
    .is('analyzed_at', null)
    .not('transcripcion', 'is', null)
    .order('fecha', { ascending: false })
    .limit(MAX_PER_RUN);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let processed = 0, ok = 0, fail = 0;
  const dist: Record<string, number> = {};
  const sent: Record<string, number> = {};
  for (const row of (rows || [])) {
    processed++;
    const r = await analyzeOne(supabase, row);
    if (r.ok) {
      ok++;
      const o = r.result.outcome; dist[o] = (dist[o] || 0) + 1;
      const s = r.result.sentiment; sent[s] = (sent[s] || 0) + 1;
    } else {
      fail++;
    }
  }

  // Cursor + estado
  const { count: pending } = await supabase.from('calls').select('id', { count: 'exact', head: true })
    .is('analyzed_at', null).not('transcripcion', 'is', null);

  await supabase.from('hubspot_sync_state').upsert({
    entity: 'analyze_calls',
    last_run_at: new Date().toISOString(),
    last_run_status: pending && pending > 0 ? 'continuing' : 'done',
    total_synced: ok,
    metadatos: { processed, ok, fail, pending, dist, sent, last_chunk_ms: Date.now() - t0 },
  }, { onConflict: 'entity' });

  let chained = false;
  if (chain && processed >= MAX_PER_RUN && (pending || 0) > 0) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze_call`;
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ chain: true }),
      }).catch(() => {}));
      chained = true;
    } catch (e) { console.error('chain fail', e); }
  }

  return new Response(JSON.stringify({
    ok: true, processed, ok_count: ok, fail_count: fail, pending, dist, sent,
    chained, phase: chained ? 'continuing' : 'done', latencia_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});