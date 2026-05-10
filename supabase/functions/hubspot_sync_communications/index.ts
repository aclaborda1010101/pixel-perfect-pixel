// hubspot_sync_communications — backfill / pull paginado de Communications
// (WhatsApp / SMS / LinkedIn) desde HubSpot. Persiste en whatsapp_messages.
// Read-only en HubSpot, idempotente por hs_id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 20; // 20 páginas * 100 = hasta 2000/run; sobra para 348
const CONCURRENCY = 10;
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
  const onlyChannels: string[] | null = Array.isArray(body?.channels) ? body.channels : ['WHATS_APP'];
  const isBackground = body?.background !== false; // default true

  const run = async () => {
    const { data: logRow } = await supabase
      .from('hubspot_sync_log')
      .insert({ entity: 'communications', status: 'running' })
      .select('id').single();
    const logId = logRow?.id;
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null,
    }).eq('entity', 'communications');

    let pages = 0, upserted = 0, failed = 0, skipped_channel = 0;
    try {
    const { data: state } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'communications').single();
    let after: string | undefined = reset ? undefined : (state?.cursor || undefined);

    for (let p = 0; p < MAX_PAGES_PER_RUN; p++) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      params.set('archived', 'false');
      params.set('associations', 'contacts,deals');
      PROPS.forEach((pp) => params.append('properties', pp));
      if (after) params.set('after', after);
      const data = await hubspotFetch(`/crm/v3/objects/communications?${params.toString()}`);
      pages++;
      const results: HsComm[] = data?.results || [];

      // Pre-batch: collect all contact + deal ids on the page for ONE bulk lookup
      const allContactIds = new Set<string>();
      const allDealIds = new Set<string>();
      const filtered: HsComm[] = [];
      for (const c of results) {
        const ch = (c.properties?.hs_communication_channel_type || '').toUpperCase();
        if (onlyChannels && !onlyChannels.includes(ch)) { skipped_channel++; continue; }
        filtered.push(c);
        (c.associations?.contacts?.results || []).forEach((r) => allContactIds.add(r.id));
        (c.associations?.deals?.results || []).forEach((r) => allDealIds.add(r.id));
      }
      const contactMap = new Map<string, string>();
      const dealMap = new Map<string, string>();
      if (allContactIds.size > 0) {
        const { data: rows } = await supabase
          .from('external_ids').select('provider_id, entity_id')
          .eq('provider', 'hubspot').eq('provider_object_type', 'contact')
          .in('provider_id', Array.from(allContactIds));
        (rows || []).forEach((r: any) => contactMap.set(r.provider_id, r.entity_id));
      }
      if (allDealIds.size > 0) {
        const { data: rows } = await supabase
          .from('external_ids').select('provider_id, entity_id')
          .eq('provider', 'hubspot').eq('provider_object_type', 'deal')
          .in('provider_id', Array.from(allDealIds));
        (rows || []).forEach((r: any) => dealMap.set(r.provider_id, r.entity_id));
      }

      // Procesar en paralelo con concurrencia controlada
      let i = 0;
      const worker = async () => {
        while (i < filtered.length) {
          const idx = i++;
          const c = filtered[idx];
          try {
            const props = c.properties || {};
            const channel = (props.hs_communication_channel_type || '').toUpperCase();
            const contactIds = (c.associations?.contacts?.results || []).map((r) => r.id);
            const dealIds = (c.associations?.deals?.results || []).map((r) => r.id);
            const ownerLocalId = contactIds.map((id) => contactMap.get(id)).find(Boolean) || null;
            const buildingLocalId = dealIds.map((id) => dealMap.get(id)).find(Boolean) || null;
            const hsOwner = props.hubspot_owner_id || null;
            const payload: any = {
              hs_id: c.id,
              cuerpo: props.hs_communication_body || '',
              enviado_at: props.hs_timestamp || props.hs_createdate || null,
              owner_id: ownerLocalId,
              building_id: buildingLocalId,
              hubspot_owner_id: hsOwner,
              direccion: hsOwner ? 'saliente' : 'entrante',
              status: 'mock_enviado',
              metadatos: {
                channel, contact_ids: contactIds, deal_ids: dealIds,
                hs_createdate: props.hs_createdate,
                hs_lastmodifieddate: props.hs_lastmodifieddate,
                logged_from: props.hs_communication_logged_from,
              },
            };
            const { data: existing } = await supabase
              .from('whatsapp_messages').select('id').eq('hs_id', c.id).maybeSingle();
            if (existing?.id) {
              const { error } = await supabase.from('whatsapp_messages').update(payload).eq('id', existing.id);
              if (error) throw error;
            } else {
              const { error } = await supabase.from('whatsapp_messages').insert(payload);
              if (error) throw error;
            }
            upserted++;
          } catch (e) {
            failed++;
            console.error('[communications] failed', c.id, e);
          }
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

      after = data?.paging?.next?.after;
      await supabase.from('hubspot_sync_state').update({ cursor: after || null }).eq('entity', 'communications');
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt, status: 'ok', pages_fetched: pages,
      records_upserted: upserted, records_failed: failed,
      metadatos: { skipped_channel },
    }).eq('id', logId);

    const { count: totalLocal } = await supabase
      .from('whatsapp_messages').select('id', { count: 'exact', head: true }).not('hs_id', 'is', null);

    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok', last_run_at: finishedAt,
      total_synced: totalLocal || 0,
    }).eq('entity', 'communications');
    console.log('[communications] done', { pages, upserted, failed, skipped_channel, total: totalLocal });
    } catch (error: any) {
      const msg = error?.message || String(error);
      console.error('[hubspot_sync_communications] error', msg);
      await supabase.from('hubspot_sync_log').update({
        finished_at: new Date().toISOString(), status: 'error',
        pages_fetched: pages, records_upserted: upserted, records_failed: failed,
        error_message: msg,
      }).eq('id', logId);
      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'error', last_error: msg,
      }).eq('entity', 'communications');
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