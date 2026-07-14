// transcribe_calls — Pipeline OpenRouter STT sobre hubspot_calls.
// Fuente: hubspot_calls con hs_call_recording_url no vacía, hs_call_duration >= 45s,
// y hs_call_transcription vacío/null. Guarda el texto en hs_call_transcription.
// Idempotente. Params:
//   { call_id: "<hs_id>" }  → transcribe UNA sola llamada (para probar).
//   { limit?: number, chain?: boolean } → batch (default 15).
// Sin secretos nuevos: usa OPENROUTER_API_KEY + HUBSPOT_API_KEY (gateway) ya configurados.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const DEFAULT_LIMIT = 15;
const CONCURRENCY = 3; // conservador: OpenRouter STT tiene rate limits
const MIN_DURATION_MS = 45_000;
const GW = "https://connector-gateway.lovable.dev/hubspot";
const OR_URL = "https://openrouter.ai/api/v1/audio/transcriptions";
const PRIMARY_MODEL = "openai/gpt-4o-mini-transcribe";
const FALLBACK_MODEL = "openai/whisper-1";
// Reintento diferido: si una llamada falló hace <6h, no la reintentamos en este ciclo.
const RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function extForContentType(ct: string): string {
  const t = (ct || "").toLowerCase();
  if (t.includes("mpeg") || t.includes("mp3")) return "mp3";
  if (t.includes("wav")) return "wav";
  if (t.includes("mp4")) return "mp4";
  if (t.includes("m4a")) return "m4a";
  if (t.includes("ogg") || t.includes("opus")) return "ogg";
  if (t.includes("webm")) return "webm";
  return "mp3";
}

async function refreshRecordingUrl(hsId: string): Promise<string | null> {
  const LK = Deno.env.get("LOVABLE_API_KEY")!;
  const HK = Deno.env.get("HUBSPOT_API_KEY")!;
  const r = await fetch(`${GW}/crm/v3/objects/calls/${hsId}?properties=hs_call_recording_url`, {
    headers: { Authorization: `Bearer ${LK}`, "X-Connection-Api-Key": HK },
  });
  if (!r.ok) { await r.text().catch(() => ""); return null; }
  const j = await r.json();
  return j?.properties?.hs_call_recording_url || null;
}

async function downloadAudio(url: string): Promise<{ bytes: Uint8Array; contentType: string } | { error: string; status?: number }> {
  const LK = Deno.env.get("LOVABLE_API_KEY")!;
  const HK = Deno.env.get("HUBSPOT_API_KEY")!;
  // URLs de api-na1.hubspot.com requieren auth. Las pasamos por el gateway del conector.
  let targetUrl = url;
  let headers: Record<string, string> = {};
  if (/api-[a-z0-9]+\.hubspot\.com\//i.test(url)) {
    targetUrl = url.replace(/https?:\/\/api-[a-z0-9]+\.hubspot\.com/i, GW);
    headers = { Authorization: `Bearer ${LK}`, "X-Connection-Api-Key": HK };
  }
  const r = await fetch(targetUrl, { headers, redirect: "follow" });
  if (!r.ok) {
    await r.text().catch(() => "");
    return { error: `download ${r.status}`, status: r.status };
  }
  const ct = r.headers.get("content-type") || "audio/mpeg";
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.byteLength < 1024) return { error: `audio too small (${buf.byteLength} bytes)` };
  return { bytes: buf, contentType: ct };
}

async function transcribeWithOpenRouter(bytes: Uint8Array, contentType: string, model: string): Promise<{ ok: true; text: string } | { ok: false; error: string; status?: number }> {
  const OK = Deno.env.get("OPENROUTER_API_KEY");
  if (!OK) return { ok: false, error: "OPENROUTER_API_KEY missing" };
  const ext = extForContentType(contentType);
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type: contentType || "audio/mpeg" }), `recording.${ext}`);
  fd.append("model", model);
  fd.append("language", "es");
  fd.append("response_format", "json");
  const r = await fetch(OR_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OK}`,
      "HTTP-Referer": "https://affluxosv2.world",
      "X-Title": "Afflux OS · Transcribe Calls",
    },
    body: fd,
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    return { ok: false, error: `openrouter ${r.status}: ${txt.slice(0, 300)}`, status: r.status };
  }
  const j: any = await r.json().catch(() => ({}));
  const text = String(j?.text ?? "").trim();
  if (!text) return { ok: false, error: "empty transcription" };
  return { ok: true, text };
}

async function transcribeOne(supabase: any, row: any): Promise<{ ok: boolean; error?: string; text_preview?: string; chars?: number }> {
  const t0 = Date.now();
  const raw = (row.raw && typeof row.raw === "object") ? row.raw : {};
  const hsId: string = row.hs_id;
  let recUrl: string | null = row.hs_call_recording_url || null;
  if (!recUrl) return { ok: false, error: "no recording url" };

  // Descarga con refresh de URL si 401/403/404/410 (signed URLs caducan)
  let dl = await downloadAudio(recUrl);
  if ("error" in dl && (dl.status === 401 || dl.status === 403 || dl.status === 404 || dl.status === 410)) {
    const fresh = await refreshRecordingUrl(hsId);
    if (fresh && fresh !== recUrl) {
      await supabase.from("hubspot_calls").update({ hs_call_recording_url: fresh }).eq("id", row.id);
      recUrl = fresh;
      dl = await downloadAudio(fresh);
    }
  }
  if ("error" in dl) {
    await supabase.from("hubspot_calls").update({
      raw: { ...raw, _transcribe_error: dl.error, _transcribe_error_at: new Date().toISOString() },
    }).eq("id", row.id);
    return { ok: false, error: dl.error };
  }

  // STT primario, con fallback a whisper-1 si el primario falla (no en 429)
  let out = await transcribeWithOpenRouter(dl.bytes, dl.contentType, PRIMARY_MODEL);
  if (!out.ok && out.status !== 429) {
    const fb = await transcribeWithOpenRouter(dl.bytes, dl.contentType, FALLBACK_MODEL);
    if (fb.ok) out = fb;
    else out = { ok: false, error: `${out.error} | fallback: ${fb.error}`, status: fb.status };
  }

  if (!out.ok) {
    // Rate-limit: no marcar error definitivo, reintentar en el próximo ciclo
    const isRate = out.status === 429;
    const patch: any = { raw: { ...raw, _transcribe_error: out.error, _transcribe_error_at: new Date().toISOString() } };
    if (isRate) delete patch.raw._transcribe_error_at; // permite reintento inmediato
    await supabase.from("hubspot_calls").update(patch).eq("id", row.id);
    return { ok: false, error: out.error };
  }

  const text = out.text;
  const update: any = {
    hs_call_transcription: text,
    raw: { ...raw, _transcribed_at: new Date().toISOString(), _transcribe_model: PRIMARY_MODEL, _transcribe_error: null, _transcribe_error_at: null },
  };
  const { error: upErr } = await supabase.from("hubspot_calls").update(update).eq("id", row.id);
  if (upErr) return { ok: false, error: `update: ${upErr.message}` };

  console.log(`[transcribe_calls] ${hsId} ok chars=${text.length} ms=${Date.now() - t0}`);
  return { ok: true, text_preview: text.slice(0, 500), chars: text.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const t0 = Date.now();

  // SINGLE — probar UNA llamada por hs_id o id
  if (body.call_id) {
    let q = supabase.from("hubspot_calls").select("id, hs_id, hs_call_recording_url, hs_call_duration, hs_call_transcription, raw");
    q = String(body.call_id).match(/^[0-9a-f-]{36}$/i)
      ? q.eq("id", body.call_id)
      : q.eq("hs_id", String(body.call_id));
    const { data: c, error } = await q.maybeSingle();
    if (error || !c) {
      return new Response(JSON.stringify({ ok: false, error: error?.message || "not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!body.force && c.hs_call_transcription && String(c.hs_call_transcription).trim()) {
      return new Response(JSON.stringify({ ok: true, skipped: true, hs_id: c.hs_id, chars: String(c.hs_call_transcription).length, text_preview: String(c.hs_call_transcription).slice(0, 500) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const r = await transcribeOne(supabase, c);
    return new Response(JSON.stringify({ ...r, hs_id: c.hs_id, elapsed_ms: Date.now() - t0 }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // BATCH
  const limit = Math.min(Math.max(Number(body.limit ?? DEFAULT_LIMIT), 1), 50);
  const chain: boolean = body.chain !== false;

  // Filtrar: recording no vacía + duración ≥ 45s + sin transcripción + sin error reciente
  const cutoff = new Date(Date.now() - RETRY_COOLDOWN_MS).toISOString();
  const { data: rows, error } = await supabase.from("hubspot_calls")
    .select("id, hs_id, hs_call_recording_url, hs_call_duration, hs_call_transcription, raw")
    .not("hs_call_recording_url", "is", null)
    .neq("hs_call_recording_url", "")
    .gte("hs_call_duration", MIN_DURATION_MS)
    .or("hs_call_transcription.is.null,hs_call_transcription.eq.")
    .or(`raw->>_transcribe_error_at.is.null,raw->>_transcribe_error_at.lt.${cutoff}`)
    .order("hs_timestamp", { ascending: false })
    .limit(limit);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const batch = rows || [];
  const accepted = batch.length;

  const work = (async () => {
    let ok = 0, fail = 0, processed = 0;
    const errors: string[] = [];
    let idx = 0;
    const worker = async () => {
      while (true) {
        const i = idx++;
        if (i >= batch.length) return;
        const row = batch[i];
        try {
          const r = await transcribeOne(supabase, row);
          processed++;
          if (r.ok) ok++;
          else { fail++; if (errors.length < 5) errors.push(`${row.hs_id}: ${r.error}`); }
        } catch (e: any) {
          processed++;
          fail++;
          if (errors.length < 5) errors.push(`${row.hs_id}: ${String(e?.message || e).slice(0, 200)}`);
        }
      }
    };
    const workers = Array.from({ length: Math.min(CONCURRENCY, batch.length) }, () => worker());
    await Promise.all(workers);

    // Pending real (mismo criterio que la query)
    const { count } = await supabase.from("hubspot_calls")
      .select("id", { count: "exact", head: true })
      .not("hs_call_recording_url", "is", null)
      .neq("hs_call_recording_url", "")
      .gte("hs_call_duration", MIN_DURATION_MS)
      .or("hs_call_transcription.is.null,hs_call_transcription.eq.");
    const pending = count || 0;
    const elapsed = Date.now() - t0;
    console.log(`[transcribe_calls batch] processed=${processed} ok=${ok} fail=${fail} pending=${pending} elapsed_ms=${elapsed}`);

    await supabase.from("hubspot_sync_state").upsert({
      entity: "transcribe_calls_backfill",
      last_run_at: new Date().toISOString(),
      last_run_status: pending > 0 && processed > 0 ? "continuing" : "done",
      total_synced: ok,
      cursor: null,
      metadatos: { processed, ok, fail, pending, last_chunk_ms: elapsed, errors_sample: errors, concurrency: CONCURRENCY, model: PRIMARY_MODEL },
    }, { onConflict: "entity" });

    if (chain && processed >= limit && pending > 0) {
      const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/transcribe_calls`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ chain: true, limit }),
      }).catch((e) => console.error("chain fail", e));
    }
  })();

  // @ts-ignore EdgeRuntime
  EdgeRuntime.waitUntil(work);

  return new Response(JSON.stringify({
    ok: true, accepted, concurrency: CONCURRENCY, model: PRIMARY_MODEL, status: "processing_in_background",
  }, null, 2), { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});