// hubspot_sync_whatsapp_bodies — segundo pase para rellenar
// hubspot_whatsapp.hs_communication_body desde la Conversations API
// (los mensajes provenientes de CONVERSATIONS no traen body en /crm/v3/objects/communications).
//
// Estrategia:
//  1. Cargar en memoria todos los hubspot_whatsapp con body NULL (id, hs_id, hs_timestamp).
//  2. Paginar /conversations/v3/conversations/threads (cursor en hubspot_sync_state).
//  3. Para cada thread, paginar sus messages.
//  4. Para cada mensaje con texto, hacer match al row más cercano por timestamp (±5 s).
//  5. Upsert (update) el body, direction y guardar mensaje crudo en raw->'conversation_message'.
//
// Read-only en HubSpot. Idempotente. No inserta filas nuevas.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const THREAD_PAGE = 50;
const MSG_PAGE = 100;
const MAX_THREADS_PER_RUN = 1000;
const MATCH_WINDOW_MS = 5_000;
const ENTITY = 'whatsapp_bodies';

interface RowIdx {
  id: string;
  hs_id: string;
  ts: number; // epoch ms
}

function extractText(msg: any): string | null {
  if (!msg) return null;
  if (typeof msg.text === 'string' && msg.text.trim()) return msg.text;
  if (typeof msg.richText === 'string' && msg.richText.trim()) return msg.richText;
  // some payloads put text inside attachments[].text
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
  const maxThreads = Number.isFinite(body?.max_threads) ? Math.min(Number(body.max_threads), 5000) : MAX_THREADS_PER_RUN;

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

    let threadPages = 0, threadsSeen = 0, messagesSeen = 0, matched = 0, updated = 0, failed = 0;
    try {
      // 1) Index de filas a rellenar
      const { data: rows, error: rowsErr } = await supabase
        .from('hubspot_whatsapp')
        .select('id, hs_id, hs_timestamp')
        .is('hs_communication_body', null);
      if (rowsErr) throw rowsErr;
      const index: RowIdx[] = (rows || [])
        .filter((r: any) => r.hs_timestamp)
        .map((r: any) => ({ id: r.id, hs_id: r.hs_id, ts: new Date(r.hs_timestamp).getTime() }))
        .sort((a, b) => a.ts - b.ts);
      const usedRowIds = new Set<string>();

      // Binary search por timestamp más cercano
      const findClosest = (ts: number): RowIdx | null => {
        if (index.length === 0) return null;
        let lo = 0, hi = index.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (index[mid].ts < ts) lo = mid + 1; else hi = mid;
        }
        const candidates = [index[lo - 1], index[lo], index[lo + 1]].filter(Boolean);
        let best: RowIdx | null = null;
        let bestDelta = Infinity;
        for (const c of candidates) {
          if (usedRowIds.has(c.id)) continue;
          const d = Math.abs(c.ts - ts);
          if (d < bestDelta) { bestDelta = d; best = c; }
        }
        return bestDelta <= MATCH_WINDOW_MS ? best : null;
      };

      // 2) Paginar threads
      const { data: state } = await supabase
        .from('hubspot_sync_state').select('cursor').eq('entity', ENTITY).maybeSingle();
      let after: string | undefined = reset ? undefined : (state?.cursor || undefined);

      const updates: Array<{ hs_id: string; body: string; direction: string | null; msg: any }> = [];

      for (let p = 0; p < Math.ceil(maxThreads / THREAD_PAGE); p++) {
        const params = new URLSearchParams();
        params.set('limit', String(THREAD_PAGE));
        if (after) params.set('after', after);
        const tdata = await hubspotFetch(`/conversations/v3/conversations/threads?${params.toString()}`);
        threadPages++;
        const threads: any[] = tdata?.results || [];
        threadsSeen += threads.length;

        for (const t of threads) {
          // 3) Mensajes del thread (paginar)
          let mAfter: string | undefined = undefined;
          while (true) {
            const mp = new URLSearchParams();
            mp.set('limit', String(MSG_PAGE));
            if (mAfter) mp.set('after', mAfter);
            const mdata = await hubspotFetch(
              `/conversations/v3/conversations/threads/${t.id}/messages?${mp.toString()}`,
            );
            const msgs: any[] = mdata?.results || [];
            messagesSeen += msgs.length;
            for (const m of msgs) {
              const type = m?.type || '';
              if (type !== 'MESSAGE') continue;
              const text = extractText(m);
              if (!text) continue;
              const createdAt = m?.createdAt ? new Date(m.createdAt).getTime() : null;
              if (!createdAt) continue;
              const match = findClosest(createdAt);
              if (!match) continue;
              usedRowIds.add(match.id);
              matched++;
              updates.push({
                hs_id: match.hs_id,
                body: text,
                direction: (m?.direction || null) as string | null,
                msg: m,
              });
            }
            mAfter = mdata?.paging?.next?.after;
            if (!mAfter) break;
          }
        }

        // Flush updates en bloques de 50
        while (updates.length >= 50) {
          const batch = updates.splice(0, 50);
          for (const u of batch) {
            const { error } = await supabase
              .from('hubspot_whatsapp')
              .update({
                hs_communication_body: u.body,
                raw: { conversation_message: u.msg } as any,
              })
              .eq('hs_id', u.hs_id);
            if (error) { failed++; console.error('update fail', u.hs_id, error); }
            else updated++;
          }
        }

        after = tdata?.paging?.next?.after;
        await supabase.from('hubspot_sync_state')
          .update({ cursor: after || null })
          .eq('entity', ENTITY);
        if (!after) break;
      }

      // Flush resto
      for (const u of updates) {
        // Hacemos merge en raw preservando lo existente
        const { data: existing } = await supabase
          .from('hubspot_whatsapp').select('raw').eq('hs_id', u.hs_id).maybeSingle();
        const mergedRaw = { ...(existing?.raw || {}), conversation_message: u.msg };
        const { error } = await supabase
          .from('hubspot_whatsapp')
          .update({
            hs_communication_body: u.body,
            raw: mergedRaw,
          })
          .eq('hs_id', u.hs_id);
        if (error) { failed++; console.error('update fail', u.hs_id, error); }
        else updated++;
      }

      const finishedAt = new Date().toISOString();
      await supabase.from('hubspot_sync_log').update({
        finished_at: finishedAt, status: 'ok', pages_fetched: threadPages,
        records_upserted: updated, records_failed: failed,
        metadatos: { threadsSeen, messagesSeen, matched, candidates: index.length },
      }).eq('id', logId);

      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'ok', last_run_at: finishedAt, total_synced: updated,
      }).eq('entity', ENTITY);

      console.log('[whatsapp_bodies] done', { threadPages, threadsSeen, messagesSeen, matched, updated, failed });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[hubspot_sync_whatsapp_bodies] error', msg);
      await supabase.from('hubspot_sync_log').update({
        finished_at: new Date().toISOString(), status: 'error',
        pages_fetched: threadPages, records_upserted: updated, records_failed: failed,
        error_message: msg, metadatos: { threadsSeen, messagesSeen, matched },
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