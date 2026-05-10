// transcribe_call — descarga MP3 de HubSpot y transcribe con Groq Whisper
// Modo single: { call_id, force? }
// Modo batch:  { chain?: bool, force?: bool }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
};

const MAX_PER_RUN = 30;
const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GW = 'https://connector-gateway.lovable.dev/hubspot';

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

async function transcribeWithGroq(bytes: Uint8Array, contentType: string): Promise<any> {
  const GK = Deno.env.get('GROQ_API_KEY');
  if (!GK) throw new Error('GROQ_API_KEY missing');
  const fd = new FormData();
  const ext = contentType.includes('wav') ? 'wav' : contentType.includes('mp4') || contentType.includes('m4a') ? 'm4a' : 'mp3';
  fd.append('file', new Blob([bytes], { type: contentType }), `audio.${ext}`);
  fd.append('model', 'whisper-large-v3-turbo');
  fd.append('language', 'es');
  fd.append('response_format', 'verbose_json');

  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GK}` },
      body: fd,
    });
    if (r.ok) return await r.json();
    const txt = await r.text();
    lastErr = `groq ${r.status}: ${txt.slice(0, 300)}`;
    if (r.status < 500) throw new Error(lastErr);
    await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
  }
  throw new Error(lastErr || 'groq failed');
}

async function transcribeOne(supabase: any, call: any, force: boolean): Promise<{ ok: boolean; error?: string; result?: any }> {
  const t0 = Date.now();
  if (!force && call.transcripcion_source === 'whisper') {
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
      modelo: 'whisper-large-v3-turbo', latencia_ms: Date.now() - t0,
      error: dl.error.slice(0, 500),
    });
    return { ok: false, error: dl.error };
  }

  let resp: any;
  try {
    resp = await transcribeWithGroq(dl.bytes, dl.contentType);
  } catch (e: any) {
    await supabase.from('calls').update({ transcripcion_source: 'error' }).eq('id', call.id);
    await supabase.from('agent_runs').insert({
      agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
      modelo: 'whisper-large-v3-turbo', latencia_ms: Date.now() - t0,
      error: String(e.message || e).slice(0, 500),
    });
    return { ok: false, error: String(e.message || e) };
  }

  const text: string = (resp?.text || '').trim();
  const segments = Array.isArray(resp?.segments) ? resp.segments : [];
  const audioDur: number = Number(resp?.duration) || 0;

  if (audioDur === 0 && text.length === 0) {
    await supabase.from('calls').update({ transcripcion_source: 'error' }).eq('id', call.id);
    await supabase.from('agent_runs').insert({
      agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
      modelo: 'whisper-large-v3-turbo', latencia_ms: Date.now() - t0,
      error: 'empty transcription',
    });
    return { ok: false, error: 'empty transcription' };
  }

  // Persistir: usamos resumen para un marker JSON con whisper_segments si no hay metadatos column
  const update: any = {
    transcripcion: text,
    transcripcion_source: 'whisper',
    analyzed_at: null, // forzar re-analisis posterior
  };
  if (audioDur > 0) update.duracion_seg = Math.round(audioDur);

  const { error: upErr } = await supabase.from('calls').update(update).eq('id', call.id);
  if (upErr) {
    return { ok: false, error: `update: ${upErr.message}` };
  }

  // Guardar segments en agent_runs.resultado (calls no tiene metadatos column)
  await supabase.from('agent_runs').insert({
    agent_name: 'transcribe_call', scope_type: 'call', scope_id: call.id,
    modelo: 'whisper-large-v3-turbo', latencia_ms: Date.now() - t0,
    tokens_in: Math.round(audioDur),
    tokens_out: text.length,
    confianza: 0.95,
    resultado: { duration: audioDur, n_segments: segments.length, segments: segments.slice(0, 200), chars: text.length },
  });

  return { ok: true, result: { id: call.id, duration: audioDur, chars: text.length, n_segments: segments.length, text_preview: text.slice(0, 400) } };
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
      .select('id, resumen, transcripcion_url, transcripcion_source, duracion_seg').eq('id', body.call_id).maybeSingle();
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

  const { data: st } = await supabase.from('hubspot_sync_state').select('cursor').eq('entity', stateEntity).maybeSingle();
  const cursor = st?.cursor;

  let q = supabase.from('calls')
    .select('id, resumen, transcripcion_url, transcripcion_source, duracion_seg, fecha')
    .not('transcripcion_url', 'is', null)
    .order('fecha', { ascending: false })
    .limit(MAX_PER_RUN);
  if (!force) q = q.neq('transcripcion_source', 'whisper').neq('transcripcion_source', 'error');
  if (cursor) q = q.lt('fecha', cursor);

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
  }

  // Pendientes
  let pq = supabase.from('calls').select('id', { count: 'exact', head: true })
    .not('transcripcion_url', 'is', null);
  if (!force) pq = pq.neq('transcripcion_source', 'whisper').neq('transcripcion_source', 'error');
  if (lastFecha) pq = pq.lt('fecha', lastFecha);
  const { count } = await pq;
  const pending = count || 0;

  await supabase.from('hubspot_sync_state').upsert({
    entity: stateEntity,
    last_run_at: new Date().toISOString(),
    last_run_status: pending > 0 && processed > 0 ? 'continuing' : 'done',
    total_synced: ok,
    cursor: pending > 0 ? lastFecha : null,
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