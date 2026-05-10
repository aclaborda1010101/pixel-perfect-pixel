// analyze_call — análisis CAUSAL: detecta momentos pivote dentro de cada transcripción
// Modo single: { call_id }
// Modo batch:  { chain?: bool, force_reanalyze?: bool }
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
const VALID_TACTICAS = ['preguntas_abiertas','neutralizacion_objecion','reframe','validacion_emocional','prueba_social','personalizacion','urgencia_legitima','escucha_activa','cierre_directo'];
const VALID_ESTADOS_ANTES = ['cerrado','resistente','esceptico','dudoso','abierto'];
const VALID_ESTADOS_DESPUES = ['curioso','considerando','comprometido','sigue_cerrado','cerrado_negativo'];
const VALID_IMPACTO = ['alto','medio','bajo'];

function buildPrompt(transcript: string, dur: number): string {
  return `Eres un analista experto en llamadas comerciales inmobiliarias en España. Analiza la siguiente transcripción y devuelve EXCLUSIVAMENTE un JSON válido (sin texto adicional) con este schema:

{
  "outcome": "interesado|dudoso|no_interesado|no_contestado|agente_bloqueado|otro",
  "sentiment": "positivo|neutro|negativo",
  "objeciones": ["precio"|"herederos"|"ya_en_venta"|"no_quiere_vender"|"timing"|"legal"|"sin_objecion"...],
  "tecnica_score": 0-100,
  "preguntas_abiertas": int,
  "preguntas_cerradas": int,
  "ratio_comercial_cliente": 0.0-1.0,
  "pivot_moments": [
    {
      "posicion_relativa": 0.0-1.0,
      "estado_cliente_antes": "cerrado|resistente|esceptico|dudoso|abierto",
      "trigger_frase": "frase LITERAL del comercial 1-2 oraciones",
      "tactica": "preguntas_abiertas|neutralizacion_objecion|reframe|validacion_emocional|prueba_social|personalizacion|urgencia_legitima|escucha_activa|cierre_directo",
      "estado_cliente_despues": "curioso|considerando|comprometido|sigue_cerrado|cerrado_negativo",
      "impacto": "alto|medio|bajo",
      "objecion_neutralizada": "precio|herederos|ya_en_venta|no_quiere_vender|timing|legal|ya_intentado|otro"
    }
  ],
  "analisis_confianza": 0.0-1.0
}

REGLAS CRÍTICAS SOBRE pivot_moments (ANÁLISIS CAUSAL — NO CORRELACIONAL):
- Un "momento pivote" es un punto exacto en la conversación donde el cliente CAMBIA DE ESTADO (resistente→considerando, escéptico→curioso, abierto→cerrado_negativo, etc.).
- Para cada pivote, extrae la frase EXACTA y LITERAL del comercial inmediatamente anterior al cambio (1–2 oraciones, sin parafrasear).
- Clasifica la táctica que usó el comercial en esa frase (una sola, la dominante).
- Indica estado del cliente ANTES y DESPUÉS de ese movimiento del comercial.
- Impacto: "alto" si cambió radicalmente la dirección de la call; "medio" si abrió una conversación; "bajo" si fue un micro-avance.
- Devuelve entre 0 y 5 pivotes. Si la call no tiene NINGÚN cambio de estado claro (ni positivo ni negativo), devuelve [].
- NO inventes frases. Si no puedes citar literal, NO incluyas el pivote.
- Pivotes negativos también cuentan (cuando el comercial dijo algo que cerró al cliente).

OTRAS REGLAS:
- "agente_bloqueado" = portero/secretaria que filtra al propietario.
- "no_contestado" = buzón, contestador, transcripción muy corta o vacía.
- "ratio_comercial_cliente" = fracción del tiempo que habla el comercial (0..1).
- "frases_clave_positivas" / "frases_clave_negativas": ya no se usan, omite estos campos.
- Si transcripción < 200 chars: outcome="no_contestado", pivot_moments=[].

DURACIÓN: ${dur}s
TRANSCRIPCIÓN:
"""
${transcript.slice(0, 24000)}
"""`;
}

async function aiAnalyze(transcript: string, dur: number): Promise<any> {
  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const r = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${LK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'google/gemini-2.5-flash',
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

function sanitizePivot(p: any): any | null {
  if (!p || typeof p !== 'object') return null;
  const tactica = VALID_TACTICAS.includes(p?.tactica) ? p.tactica : null;
  const ea = VALID_ESTADOS_ANTES.includes(p?.estado_cliente_antes) ? p.estado_cliente_antes : null;
  const ed = VALID_ESTADOS_DESPUES.includes(p?.estado_cliente_despues) ? p.estado_cliente_despues : null;
  const imp = VALID_IMPACTO.includes(p?.impacto) ? p.impacto : null;
  const frase = typeof p?.trigger_frase === 'string' ? p.trigger_frase.trim().slice(0, 600) : '';
  if (!tactica || !ea || !ed || !imp || frase.length < 5) return null;
  return {
    posicion_relativa: Number.isFinite(p?.posicion_relativa) ? Math.max(0, Math.min(1, Number(p.posicion_relativa))) : 0.5,
    estado_cliente_antes: ea,
    trigger_frase: frase,
    tactica,
    estado_cliente_despues: ed,
    impacto: imp,
    objecion_neutralizada: typeof p?.objecion_neutralizada === 'string' ? p.objecion_neutralizada.slice(0, 60) : null,
  };
}

function sanitize(a: any): any {
  const outcome = VALID_OUTCOMES.includes(a?.outcome) ? a.outcome : 'otro';
  const sentiment = VALID_SENTIMENT.includes(a?.sentiment) ? a.sentiment : 'neutro';
  const obj = Array.isArray(a?.objeciones) ? a.objeciones.filter((x: any) => typeof x === 'string').slice(0, 8) : [];
  const pivotsRaw = Array.isArray(a?.pivot_moments) ? a.pivot_moments.slice(0, 5) : [];
  const pivots = pivotsRaw.map(sanitizePivot).filter(Boolean);
  const tacticas = Array.from(new Set(pivots.map((p: any) => p.tactica)));
  return {
    outcome,
    sentiment,
    objeciones: obj,
    tecnica_score: Number.isFinite(a?.tecnica_score) ? Math.max(0, Math.min(100, Number(a.tecnica_score))) : null,
    preguntas_abiertas: Number.isFinite(a?.preguntas_abiertas) ? Math.max(0, Math.floor(Number(a.preguntas_abiertas))) : null,
    preguntas_cerradas: Number.isFinite(a?.preguntas_cerradas) ? Math.max(0, Math.floor(Number(a.preguntas_cerradas))) : null,
    ratio_comercial_cliente: Number.isFinite(a?.ratio_comercial_cliente) ? Math.max(0, Math.min(1, Number(a.ratio_comercial_cliente))) : null,
    pivot_moments: pivots,
    tacticas_usadas: tacticas,
    analisis_confianza: Number.isFinite(a?.analisis_confianza) ? Math.max(0, Math.min(1, Number(a.analisis_confianza))) : 0.6,
  };
}

async function analyzeOne(supabase: any, callRow: any): Promise<{ ok: boolean; error?: string; result?: any }> {
  const t0 = Date.now();
  const transcript = (callRow.transcripcion || '').trim();
  const dur = callRow.duracion_seg || 0;

  let parsed: any = null;
  let usage: any = {};
  let modelo = 'google/gemini-2.5-flash';

  if (!transcript || transcript.length < MIN_CHARS) {
    parsed = {
      outcome: 'no_contestado', sentiment: 'neutro',
      objeciones: ['sin_objecion'], tecnica_score: 0,
      preguntas_abiertas: 0, preguntas_cerradas: 0,
      ratio_comercial_cliente: null,
      pivot_moments: [],
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
    resultado: { outcome: clean.outcome, sentiment: clean.sentiment, n_pivots: clean.pivot_moments.length, tacticas: clean.tacticas_usadas },
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
  const force: boolean = !!body.force_reanalyze;
  const stateEntity = force ? 'analyze_calls_recall' : 'analyze_calls';

  let q = supabase.from('calls')
    .select('id, transcripcion, duracion_seg, fecha')
    .not('transcripcion', 'is', null)
    .order('fecha', { ascending: false })
    .limit(MAX_PER_RUN);

  if (force) {
    // Recall: procesar las que NO tengan tacticas_usadas marcado tras el recall
    // Usamos cursor por fecha guardado en sync_state para avanzar.
    const { data: st } = await supabase.from('hubspot_sync_state').select('cursor').eq('entity', stateEntity).maybeSingle();
    const cursor = st?.cursor;
    if (cursor) q = q.lt('fecha', cursor);
  } else {
    q = q.is('analyzed_at', null);
  }

  const { data: rows, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let processed = 0, ok = 0, fail = 0;
  const dist: Record<string, number> = {};
  const sent: Record<string, number> = {};
  let lastFecha: string | null = null;
  for (const row of (rows || [])) {
    processed++;
    if (row.fecha) lastFecha = row.fecha;
    const r = await analyzeOne(supabase, row);
    if (r.ok) {
      ok++;
      const o = r.result.outcome; dist[o] = (dist[o] || 0) + 1;
      const s = r.result.sentiment; sent[s] = (sent[s] || 0) + 1;
    } else {
      fail++;
    }
  }

  // Pendientes
  let pending = 0;
  if (force) {
    const { count } = await supabase.from('calls').select('id', { count: 'exact', head: true })
      .not('transcripcion', 'is', null)
      .lt('fecha', lastFecha || new Date().toISOString());
    pending = count || 0;
  } else {
    const { count } = await supabase.from('calls').select('id', { count: 'exact', head: true })
      .is('analyzed_at', null).not('transcripcion', 'is', null);
    pending = count || 0;
  }

  await supabase.from('hubspot_sync_state').upsert({
    entity: stateEntity,
    last_run_at: new Date().toISOString(),
    last_run_status: pending > 0 && processed > 0 ? 'continuing' : 'done',
    total_synced: ok,
    cursor: force ? lastFecha : null,
    metadatos: { processed, ok, fail, pending, dist, sent, last_chunk_ms: Date.now() - t0, force },
  }, { onConflict: 'entity' });

  let chained = false;
  if (chain && processed >= MAX_PER_RUN && pending > 0) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze_call`;
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ chain: true, force_reanalyze: force }),
      }).catch(() => {}));
      chained = true;
    } catch (e) { console.error('chain fail', e); }
  }

  return new Response(JSON.stringify({
    ok: true, processed, ok_count: ok, fail_count: fail, pending, dist, sent,
    chained, force, phase: chained ? 'continuing' : 'done', latencia_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
