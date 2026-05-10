// hubspot_sync_whatsapp_bodies — segundo pase que rellena
// hubspot_whatsapp.hs_communication_body desde la Conversations API.
//
// Estrategia:
//  1. Cargar hubspot_whatsapp con body NULL (filtra por cursor si !reset).
//  2. Batch-read /crm/v3/objects/communications/batch/read con property
//     hs_communication_conversations_thread_id para descubrir el thread de cada uno.
//  3. Para cada thread único, paginar /conversations/v3/conversations/threads/{tid}/messages
//     filtrando type=MESSAGE.
//  4. Match por (thread_id, |msg.createdAt - hs_timestamp| <= 3s).
//  5. UPDATE body + persistir mensaje crudo en raw.conversation_message + direction
//     en raw.conversation_message.direction.
//
// Read-only en HubSpot. Idempotente. No inserta filas nuevas.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const BATCH_READ_SIZE = 100;
const MSG_PAGE = 100;
const MATCH_WINDOW_MS = 3_000;
const ENTITY = 'whatsapp_bodies';
const COMM_PROPS = [
  'hs_communication_channel_type',
  'hs_communication_conversations_thread_id',
  'hs_communication_body',
  'hs_timestamp',
];

function extractText(msg: any): string | null {
  if (!msg) return null;
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text;
  if (typeof msg.richText === 'string' && msg.richText.trim()) return msg.richText;
  if (Array.isArray(msg.attachments)) {
    for (const a of msg.attachments) {
      if (typeof a?.text === 'string' && a.text.trim()) return a.text;
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const reset = !!body?.reset || !!body?.force_refresh;
  const isBackground = body?.background !== false;
  const maxRows = Number.isFinite(body?.max_rows) ? Math.min(Number(body.max_rows), 5000) : 5000;

  const run = async () => {
    const { data: logRow } = await supabase
      .from('hubspot_sync_log')
      .insert({ entity: ENTITY, status: 'running' })
      .select('id').single();
    const logId = logRow?.id;

    await supabase.from('hubspot_sync_state').upsert(
      { entity: ENTITY, last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null },
      { onConflict: 'entity' },
    );

    let threadsProcessed = 0, messagesSeen = 0, matched = 0, updated = 0, failed = 0;
    const stats = { rowsTargeted: 0, withThread: 0, threadsUnique: 0 };

    try {
      // 1) Filas a rellenar
      const { data: rows, error: rowsErr } = await supabase
        .from('hubspot_whatsapp')
        .select('id, hs_id, hs_timestamp')
        .is('hs_communication_body', null)
        .limit(maxRows);
      if (rowsErr) throw rowsErr;
      stats.rowsTargeted = rows?.length || 0;

      const byHsId = new Map<string, { id: string; ts: number }>();
      for (const r of rows || []) {
        if (!r.hs_timestamp) continue;
        byHsId.set(r.hs_id, { id: r.id, ts: new Date(r.hs_timestamp).getTime() });
      }

      // 2) Batch read communications con properties para sacar thread_id
      const hsIds = Array.from(byHsId.keys());
      const commToThread = new Map<string, string>(); // hs_id -> thread_id
      const threadToHsIds = new Map<string, string[]>();

      for (let i = 0; i < hsIds.length; i += BATCH_READ_SIZE) {
        const chunk = hsIds.slice(i, i + BATCH_READ_SIZE);
        const resp = await hubspotFetch(
          `/crm/v3/objects/communications/batch/read`,
          {
            method: 'POST',
            body: JSON.stringify({
              properties: COMM_PROPS,
              inputs: chunk.map((id) => ({ id })),
            }),
          },
        );
        const results: any[] = resp?.results || [];
        for (const c of results) {
          const tid = c?.properties?.hs_communication_conversations_thread_id;
          if (!tid) continue;
          commToThread.set(c.id, String(tid));
          const arr = threadToHsIds.get(String(tid)) || [];
          arr.push(c.id);
          threadToHsIds.set(String(tid), arr);
        }
      }
      stats.withThread = commToThread.size;
      stats.threadsUnique = threadToHsIds.size;

      // 3) Para cada thread único, fetch messages, hacer match contra los hs_ids del thread
      for (const [threadId, threadHsIds] of threadToHsIds.entries()) {
        // candidatos {hs_id, ts}
        const candidates = threadHsIds
          .map((hsId) => ({ hsId, ...byHsId.get(hsId)! }))
          .filter((c) => c && c.ts);
        const used = new Set<string>(); // hsIds ya asignados

        let after: string | undefined = undefined;
        while (true) {
          const params = new URLSearchParams();
          params.set('limit', String(MSG_PAGE));
          if (after) params.set('after', after);
          let mdata: any;
          try {
            mdata = await hubspotFetch(
              `/conversations/v3/conversations/threads/${threadId}/messages?${params.toString()}`,
            );
          } catch (e: any) {
            console.warn(`[whatsapp_bodies] thread ${threadId} fetch error: ${e?.message || e}`);
            break;
          }
          const msgs: any[] = mdata?.results || [];
          messagesSeen += msgs.length;
          for (const m of msgs) {
            if ((m?.type || '') !== 'MESSAGE') continue;
            const text = extractText(m);
            if (!text) continue;
            const createdAt = m?.createdAt ? new Date(m.createdAt).getTime() : null;
            if (!createdAt) continue;

            // best match: minimum |delta| no usado
            let best: typeof candidates[number] | null = null;
            let bestDelta = Infinity;
            for (const c of candidates) {
              if (used.has(c.hsId)) continue;
              const d = Math.abs(c.ts - createdAt);
              if (d < bestDelta) { bestDelta = d; best = c; }
            }
            if (!best || bestDelta > MATCH_WINDOW_MS) continue;
            used.add(best.hsId);
            matched++;

            // Merge raw + update body
            const { data: existing } = await supabase
              .from('hubspot_whatsapp').select('raw').eq('hs_id', best.hsId).maybeSingle();
            const mergedRaw = { ...(existing?.raw || {}), conversation_message: m };
            const { error } = await supabase
              .from('hubspot_whatsapp')
              .update({ hs_communication_body: text, raw: mergedRaw })
              .eq('hs_id', best.hsId);
            if (error) { failed++; console.error('update fail', best.hsId, error.message); }
            else updated++;
          }
          after = mdata?.paging?.next?.after;
          if (!after) break;
        }
        threadsProcessed++;
      }

      const finishedAt = new Date().toISOString();
      await supabase.from('hubspot_sync_log').update({
        finished_at: finishedAt, status: 'ok', pages_fetched: threadsProcessed,
        records_upserted: updated, records_failed: failed,
        metadatos: { ...stats, threadsProcessed, messagesSeen, matched },
      }).eq('id', logId);

      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'ok', last_run_at: finishedAt, total_synced: updated,
        cursor: null,
        metadatos: { ...stats, messagesSeen, matched } as any,
      }).eq('entity', ENTITY);

      console.log('[whatsapp_bodies] done', { ...stats, threadsProcessed, messagesSeen, matched, updated, failed });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[hubspot_sync_whatsapp_bodies] error', msg);
      await supabase.from('hubspot_sync_log').update({
        finished_at: new Date().toISOString(), status: 'error',
        pages_fetched: threadsProcessed, records_upserted: updated, records_failed: failed,
        error_message: msg, metadatos: { ...stats, messagesSeen, matched },
      }).eq('id', logId);
      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'error', last_error: msg,
      }).eq('entity', ENTITY);
    }
  };

  if (isBackground && (globalThis as any).EdgeRuntime?.waitUntil) {
    (globalThis as any).EdgeRuntime.waitUntil(run());
    return new Response(JSON.stringify({ ok: true, accepted: true, mode: 'background' }), {
      status: 202, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  await run();
  return new Response(JSON.stringify({ ok: true, mode: 'sync' }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});