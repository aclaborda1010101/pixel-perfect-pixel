// hubspot_sync_whatsapp — backfill on-demand de WhatsApp desde HubSpot
// (objeto communications con canal WHATS_APP) hacia la tabla mirror
// cruda public.hubspot_whatsapp. Read-only en HubSpot, idempotente por hs_id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 100; // hasta 10k mensajes/run
const PROPS = [
  'hs_communication_channel_type',
  'hs_communication_body',
  'hs_communication_logged_from',
  'hs_timestamp',
  'hubspot_owner_id',
  'hs_object_id',
  'hs_createdate',
  'hs_lastmodifieddate',
];

interface HsComm {
  id: string;
  properties: Record<string, string | null>;
  associations?: Record<string, { results?: Array<{ id: string; type: string }> }>;
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
  const maxPages = Number.isFinite(body?.max_pages) ? Math.min(Number(body.max_pages), 500) : MAX_PAGES_PER_RUN;

  const run = async () => {
    const { data: logRow } = await supabase
      .from('hubspot_sync_log')
      .insert({ entity: 'whatsapp', status: 'running' })
      .select('id').single();
    const logId = logRow?.id;

    await supabase.from('hubspot_sync_state')
      .upsert(
        { entity: 'whatsapp', last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null },
        { onConflict: 'entity' },
      );

    let pages = 0, upserted = 0, failed = 0, skipped_channel = 0;
    try {
      const { data: state } = await supabase
        .from('hubspot_sync_state').select('cursor').eq('entity', 'whatsapp').maybeSingle();
      let after: string | undefined = reset ? undefined : (state?.cursor || undefined);

      for (let p = 0; p < maxPages; p++) {
        const params = new URLSearchParams();
        params.set('limit', String(PAGE_LIMIT));
        params.set('archived', 'false');
        params.set('associations', 'contacts,deals');
        PROPS.forEach((pp) => params.append('properties', pp));
        if (after) params.set('after', after);

        const data = await hubspotFetch(`/crm/v3/objects/communications?${params.toString()}`);
        pages++;
        const results: HsComm[] = data?.results || [];

        const rows: any[] = [];
        for (const c of results) {
          const props = c.properties || {};
          const channel = (props.hs_communication_channel_type || '').toUpperCase();
          if (channel !== 'WHATS_APP') { skipped_channel++; continue; }
          const contactIds = (c.associations?.contacts?.results || []).map((r) => r.id);
          const dealIds = (c.associations?.deals?.results || []).map((r) => r.id);
          rows.push({
            hs_id: c.id,
            hs_communication_channel_type: channel,
            hs_communication_body: props.hs_communication_body || null,
            hs_communication_logged_from: props.hs_communication_logged_from || null,
            hs_timestamp: props.hs_timestamp || null,
            hs_owner_id: props.hubspot_owner_id || null,
            hs_createdate: props.hs_createdate || null,
            hs_lastmodifieddate: props.hs_lastmodifieddate || null,
            associated_contact_ids: contactIds,
            associated_deal_ids: dealIds,
            raw: c as any,
          });
        }

        if (rows.length > 0) {
          const { error } = await supabase
            .from('hubspot_whatsapp')
            .upsert(rows, { onConflict: 'hs_id' });
          if (error) {
            failed += rows.length;
            console.error('[whatsapp] upsert batch error', error);
          } else {
            upserted += rows.length;
          }
        }

        after = data?.paging?.next?.after;
        await supabase.from('hubspot_sync_state')
          .update({ cursor: after || null })
          .eq('entity', 'whatsapp');
        if (!after) break;
      }

      const finishedAt = new Date().toISOString();
      await supabase.from('hubspot_sync_log').update({
        finished_at: finishedAt, status: 'ok', pages_fetched: pages,
        records_upserted: upserted, records_failed: failed,
        metadatos: { skipped_channel },
      }).eq('id', logId);

      const { count: totalLocal } = await supabase
        .from('hubspot_whatsapp').select('id', { count: 'exact', head: true });

      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'ok', last_run_at: finishedAt,
        total_synced: totalLocal || 0,
      }).eq('entity', 'whatsapp');

      console.log('[whatsapp] done', { pages, upserted, failed, skipped_channel, total: totalLocal });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[hubspot_sync_whatsapp] error', msg);
      await supabase.from('hubspot_sync_log').update({
        finished_at: new Date().toISOString(), status: 'error',
        pages_fetched: pages, records_upserted: upserted, records_failed: failed,
        error_message: msg,
      }).eq('id', logId);
      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'error', last_error: msg,
      }).eq('entity', 'whatsapp');
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