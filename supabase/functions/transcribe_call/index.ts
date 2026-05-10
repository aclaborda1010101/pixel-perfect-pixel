// transcribe_call — descarga MP3 de HubSpot y transcribe con Deepgram Nova-3 (con diarización)
// Modo single: { call_id, force? }
// Modo batch:  { chain?: bool, force?: bool }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const MAX_PER_RUN = 25;
const SLEEP_BETWEEN_MS = 250; // Deepgram ~100 conc, no audio-seconds cap
const DG_URL = 'https://api.deepgram.com/v1/listen?model=nova-3&language=es&smart_format=true&diarize=true&utterances=true&punctuate=true&filler_words=false';
const GW = 'https://connector-gateway.lovable.dev/hubspot';
const COMERCIAL_HINTS = ['aflux', 'fasano', 'soy ', 'le llamo', 'te llamo', 'le llamo de', 'le llamamos', 'inmobiliaria'];

function extractHsId(call: any): string | null {
  const r = call?.resumen || '';
  const m = r.match(/\[hs:(\d+)\]/);
  if (m) return m[1];
  const u = call?.transcripcion_url || '';
  const m2 = u.match(/engagement\/(\d+)/);
  return m2 ? m2[1] : null;
}

async function refreshRecordingUrl(hsId: string): Promise<string | null> {
  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const HK = Deno.env.get('HUBSPOT_API_KEY')!;
  const r = await fetch(`${GW}/crm/v3/objects/calls/${hsId}?properties=hs_call_recording_url`, {
    headers: { Authorization: `Bearer ${LK}`, 'X-Connection-Api-Key': HK },
  });
  if (!r.ok) { await r.text(); return null; }
  const j = await r.json();
  return j?.properties?.hs_call_recording_url || null;
}

async function downloadAudio(url: string): Promise<{ bytes: Uint8Array; contentType: string } | { error: string; status?: number }> {
  const LK = Deno.env.get('LOVABLE_API_KEY')!;
  const HK = Deno.env.get('HUBSPOT_API_KEY')!;
  // El URL "auth" de HubSpot redirige a un signed URL de S3. Hacemos GET con auth gateway.
  // Si la URL apunta a api-*.hubspot.com la pasamos por el gateway reescribiendo el host.
  let targetUrl = url;
  let headers: Record<string, string> = {};
  if (/api-[a-z0-9]+\.hubspot\.com\//i.test(url)) {
    targetUrl = url.replace(/https?:\/\/api-[a-z0-9]+\.hubspot\.com/i, GW);
    headers = { Authorization: `Bearer ${LK}`, 'X-Connection-Api-Key': HK };
  }
  const r = await fetch(targetUrl, { headers, redirect: 'follow' });
  if (!r.ok) {
    await r.text().catch(() => '');
    return { error: `download ${r.status}`, status: r.status };
  }
  const ct = r.headers.get('content-type') || 'audio/mpeg';
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength < 1024) return { error: `audio too small (${buf.byteLength} bytes)` };
  return { bytes: buf, contentType: ct };
}

async function transcribeWithDeepgram(bytes: Uint8Array, contentType: string): Promise<any> {
  const DK = Deno.env.get('DEEPGRAM_API_KEY');
  if (!DK) throw new Error('DEEPGRAM_API_KEY missing');
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(DG_URL, {
      method: 'POST',
      headers: { Authorization: `Token ${DK}`, 'Content-Type': contentType || 'audio/mpeg' },
      body: bytes,
    });
    if (r.ok) return await r.json();
    const txt = await r.text();
    lastErr = `deepgram ${r.status}: ${txt.slice(0, 300)}`;
    if (r.status === 429 || r.status >= 500) {
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || 'deepgram failed');
}

function classifySpeakers(utterances: any[]): { comercialId: number; clienteId: number } {
  // Heurística: en los primeros 30s, el speaker que dice "Aflux/Fasano/soy/le llamo..." = Comercial.
  // Fallback: el speaker con más palabras en los primeros 30s.
  const earlyByWords: Record<number, number> = {};
  let comercialId = -1;
  for (const u of utterances) {
    if ((u.start ?? 0) > 30) break;
    const sp = Number(u.speaker ?? 0);
    const t = String(u.transcript || '').toLowerCase();
    earlyByWords[sp] = (earlyByWords[sp] || 0) + t.split(/\s+/).filter(Boolean).length;
    if (comercialId < 0 && COMERCIAL_HINTS.some((h) => t.includes(h))) comercialId = sp;
  }
  if (comercialId < 0) {
    const ids = Object.keys(earlyByWords).map(Number);
    if (ids.length === 0) return { comercialId: 0, clienteId: 1 };
    comercialId = ids.sort((a, b) => (earlyByWords[b] || 0) - (earlyByWords[a] || 0))[0];
  }
  // Cliente = el otro speaker más activo (cualquier speaker distinto al comercial)
  const allIds = new Set<number>();
  for (const u of utterances) allIds.add(Number(u.speaker ?? 0));
  allIds.delete(comercialId);
  const clienteId = allIds.size > 0 ? Array.from(allIds)[0] : (comercialId === 0 ? 1 : 0);
  return { comercialId, clienteId };
}

function computeSpeakerStats(utterances: any[], comercialId: number, clienteId: number) {
  let comSec = 0, cliSec = 0, comTurns = 0, cliTurns = 0, interrupciones = 0;
  let prevEnd = 0, prevSpeaker = -1;
  for (const u of utterances) {
    const sp = Number(u.speaker ?? 0);
    const dur = Math.max(0, (u.end ?? 0) - (u.start ?? 0));
    if (sp === comercialId) { comSec += dur; comTurns++; }
    else if (sp === clienteId) { cliSec += dur; cliTurns++; }
    if (prevSpeaker !== -1 && sp !== prevSpeaker && (u.start ?? 0) < prevEnd - 0.3) interrupciones++;
    prevEnd = Math.max(prevEnd, u.end ?? 0);
    prevSpeaker = sp;
  }
  const total = comSec + cliSec;
  return {
    comercial_seconds: Math.round(comSec * 10) / 10,
    cliente_seconds: Math.round(cliSec * 10) / 10,
    ratio_comercial: total > 0 ? Math.round((comSec / total) * 1000) / 1000 : null,
    num_turnos_comercial: comTurns,
    num_turnos_cliente: cliTurns,
    interrupciones,
    comercial_speaker_id: comercialId,
    cliente_speaker_id: clienteId,
  };
}

function formatDiarizedText(utterances: any[], comercialId: number, clienteId: number): string {
  const lines: string[] = [];
  for (const u of utterances) {
    const sp = Number(u.speaker ?? 0);
    const label = sp === comercialId ? 'Comercial' : sp === clienteId ? 'Cliente' : `Speaker${sp}`;
    const t = String(u.transcript || '').trim();
    if (t) lines.push(`[${label}] ${t}`);
  }
  return lines.join('\n');
}

async function transcribeOne(supabase: any, call: any, force: boolean): Promise<{ ok: boolean; error?: string; result?: any }> {
  const t0 = Date.now();
  if (!force && call.transcripcion_source === 'deepgram') {
    return { ok: true, result: { id: call.id, skipped: true } };
  }
  const recUrl: string | null = call.transcripcion_url;
  if (!recUrl) return { ok: false, error: 'no recording url' };

  // Descargar audio (con refresh si 401/403)
  let dl = await downloadAudio(recUrl);
  if ('error' in dl && (dl.status === 401 || dl.status === 403 || dl.status === 410 || dl.status === 404)) {
    const hsId = extractHsId(call);
    if (hsId) {
      const fresh = await refreshRecordingUrl(hsId);
      if (fresh) {
        await supabase.from('calls').update({ transcripcion_url: fresh }).eq('id', call.id);
        dl = await downloadAudio(fresh);
      }
    }
  }
  if ('error' in dl) {
    await supabase.from('calls').update({ transcripcion_source: 'error' }).eq('id', call.id);
    await supabase.from('agent_runs').insert({
      agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
      modelo: 'deepgram-nova-3', latencia_ms: Date.now() - t0,
      error: dl.error.slice(0, 500),
    });
    return { ok: false, error: dl.error };
  }

  let resp: any;
  try {
    resp = await transcribeWithDeepgram(dl.bytes, dl.contentType);
  } catch (e: any) {
    const msg = String(e.message || e);
    if (!/429|rate limit/i.test(msg)) {
      await supabase.from('calls').update({ transcripcion_source: 'error' }).eq('id', call.id);
    }
    await supabase.from('agent_runs').insert({
      agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
      modelo: 'deepgram-nova-3', latencia_ms: Date.now() - t0,
      error: msg.slice(0, 500),
    });
    return { ok: false, error: msg };
  }

  const utterances: any[] = Array.isArray(resp?.results?.utterances) ? resp.results.utterances : [];
  const altText: string = String(resp?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '').trim();
  const audioDur: number = Number(resp?.metadata?.duration) || 0;

  if (utterances.length === 0 && altText.length === 0) {
    await supabase.from('calls').update({ transcripcion_source: 'error' }).eq('id', call.id);
    await supabase.from('agent_runs').insert({
      agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
      modelo: 'deepgram-nova-3', latencia_ms: Date.now() - t0,
      error: 'empty transcription',
    });
    return { ok: false, error: 'empty transcription' };
  }

  let formatted = '';
  let stats: any = null;
  if (utterances.length > 0) {
    const { comercialId, clienteId } = classifySpeakers(utterances);
    formatted = formatDiarizedText(utterances, comercialId, clienteId);
    stats = computeSpeakerStats(utterances, comercialId, clienteId);
  } else {
    formatted = altText;
  }

  const update: any = {
    transcripcion: formatted,
    transcripcion_source: 'deepgram',
    analyzed_at: null,
    metadatos: {
      ...(call.metadatos || {}),
      deepgram_utterances: utterances.slice(0, 400).map((u) => ({
        speaker: u.speaker, start: u.start, end: u.end,
        transcript: String(u.transcript || '').slice(0, 1200),
        confidence: u.confidence,
      })),
      speaker_stats: stats,
      transcribed_at: new Date().toISOString(),
    },
  };
  if (stats?.ratio_comercial != null) update.ratio_comercial_cliente = stats.ratio_comercial;
  if (audioDur > 0) update.duracion_seg = Math.round(audioDur);

  const { error: upErr } = await supabase.from('calls').update(update).eq('id', call.id);
  if (upErr) {
    return { ok: false, error: `update: ${upErr.message}` };
  }

  await supabase.from('agent_runs').insert({
    agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
    modelo: 'deepgram-nova-3', latencia_ms: Date.now() - t0,
    tokens_in: Math.round(audioDur),
    tokens_out: formatted.length,
    confianza: 0.95,
    resultado: { duration: audioDur, n_utterances: utterances.length, chars: formatted.length, speaker_stats: stats },
  });

  return { ok: true, result: { id: call.id, duration: audioDur, chars: formatted.length, n_utterances: utterances.length, speaker_stats: stats, text_preview: formatted.slice(0, 400) } };
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
      .select('id, resumen, transcripcion_url, transcripcion_source, duracion_seg, metadatos').eq('id', body.call_id).maybeSingle();
    if (error || !c) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || 'not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const r = await transcribeOne(supabase, c, !!body.force);
    return new Response(JSON.stringify(r, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // BATCH
  const chain: boolean = body.chain !== false;
  const force: boolean = !!body.force;
  const stateEntity = 'whisper_backfill';

  let q = supabase.from('calls')
    .select('id, resumen, transcripcion_url, transcripcion_source, duracion_seg, fecha, metadatos')
    .not('transcripcion_url', 'is', null)
    .order('fecha', { ascending: false })
    .limit(MAX_PER_RUN);
  if (!force) q = q.neq('transcripcion_source', 'deepgram').neq('transcripcion_source', 'error');

  const { data: rows, error } = await q;
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let processed = 0, ok = 0, fail = 0;
  let lastFecha: string | null = null;
  const errors: string[] = [];
  for (const row of (rows || [])) {
    processed++;
    if (row.fecha) lastFecha = row.fecha;
    const r = await transcribeOne(supabase, row, force);
    if (r.ok) ok++;
    else { fail++; if (errors.length < 5) errors.push(`${row.id}: ${r.error}`); }
    // Throttle para no superar 20 RPM de Groq
    if (processed < (rows?.length || 0)) {
      await new Promise((res) => setTimeout(res, SLEEP_BETWEEN_MS));
    }
  }

  let pq = supabase.from('calls').select('id', { count: 'exact', head: true })
    .not('transcripcion_url', 'is', null);
  if (!force) pq = pq.neq('transcripcion_source', 'deepgram').neq('transcripcion_source', 'error');
  const { count } = await pq;
  const pending = count || 0;

  await supabase.from('hubspot_sync_state').upsert({
    entity: 'transcribe_backfill',
    last_run_at: new Date().toISOString(),
    last_run_status: pending > 0 && processed > 0 ? 'continuing' : 'done',
    total_synced: ok,
    cursor: null,
    metadatos: { processed, ok, fail, pending, last_chunk_ms: Date.now() - t0, errors_sample: errors },
  }, { onConflict: 'entity' });

  let chained = false;
  if (chain && processed >= MAX_PER_RUN && pending > 0) {
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/transcribe_call`;
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ chain: true, force }),
      }).catch(() => {}));
      chained = true;
    } catch (e) { console.error('chain fail', e); }
  } else if (chain && pending === 0 && processed > 0) {
    // Fase 6: backfill terminado → disparar analyze_call sobre las recién transcritas (analyzed_at=null)
    try {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/analyze_call`;
      // @ts-ignore EdgeRuntime
      EdgeRuntime.waitUntil(fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
        body: JSON.stringify({ chain: true }),
      }).catch(() => {}));
    } catch (e) { console.error('analyze chain fail', e); }
  }

  return new Response(JSON.stringify({
    ok: true, processed, ok_count: ok, fail_count: fail, pending, errors_sample: errors,
    chained, phase: chained ? 'continuing' : 'done', latencia_ms: Date.now() - t0,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});