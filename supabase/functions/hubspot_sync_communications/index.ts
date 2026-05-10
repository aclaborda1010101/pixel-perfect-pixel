// hubspot_sync_communications — backfill / pull paginado de Communications
// (WhatsApp / SMS / LinkedIn) desde HubSpot. Persiste en whatsapp_messages.
// Read-only en HubSpot, idempotente por hs_id.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 20; // 20 páginas * 100 = hasta 2000/run; sobra para 348
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

  const { data: logRow } = await supabase
    .from('hubspot_sync_log')
    .insert({ entity: 'communications', status: 'running' })
    .select('id').single();
  const logId = logRow?.id;

  await supabase.from('hubspot_sync_state').update({
    last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null,
  }).eq('entity', 'communications');

  let pages = 0; let upserted = 0; let failed = 0; let skipped_channel = 0;

  try {
    let body: any = {};
    try { body = await req.json(); } catch { /* ignore */ }
    const reset = !!body?.reset || !!body?.force_refresh;
    const onlyChannels: string[] | null = Array.isArray(body?.channels) ? body.channels : ['WHATS_APP'];

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

      for (const c of results) {
        try {
          const props = c.properties || {};
          const channel = (props.hs_communication_channel_type || '').toUpperCase();
          if (onlyChannels && !onlyChannels.includes(channel)) { skipped_channel++; continue; }
          const cuerpo = props.hs_communication_body || '';
          const enviadoAt = props.hs_timestamp || props.hs_createdate || null;
          const hsOwner = props.hubspot_owner_id || null;
          const contactIds = (c.associations?.contacts?.results || []).map((r) => r.id);
          const dealIds = (c.associations?.deals?.results || []).map((r) => r.id);

          // Resolver owner_id (UUID local) desde external_ids del primer contact
          let ownerLocalId: string | null = null;
          if (contactIds.length > 0) {
            const { data: ext } = await supabase
              .from('external_ids').select('entity_id')
              .eq('provider', 'hubspot').eq('provider_object_type', 'contact')
              .in('provider_id', contactIds).limit(1).maybeSingle();
            ownerLocalId = ext?.entity_id || null;
          }
          // Resolver building_id desde primer deal
          let buildingLocalId: string | null = null;
          if (dealIds.length > 0) {
            const { data: ext } = await supabase
              .from('external_ids').select('entity_id')
              .eq('provider', 'hubspot').eq('provider_object_type', 'deal')
              .in('provider_id', dealIds).limit(1).maybeSingle();
            buildingLocalId = ext?.entity_id || null;
          }

          // Dirección: si hay hubspot_owner_id (sales rep interno) → saliente
          const direccion = hsOwner ? 'saliente' : 'entrante';

          const payload: any = {
            hs_id: c.id,
            cuerpo,
            enviado_at: enviadoAt,
            owner_id: ownerLocalId,
            building_id: buildingLocalId,
            hubspot_owner_id: hsOwner,
            direccion,
            status: 'enviado',
            metadatos: {
              channel,
              contact_ids: contactIds,
              deal_ids: dealIds,
              hs_createdate: props.hs_createdate,
              hs_lastmodifieddate: props.hs_lastmodifieddate,
              logged_from: props.hs_communication_logged_from,
            },
          };

          // Upsert por hs_id
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

    return new Response(JSON.stringify({
      ok: true, pages_fetched: pages, upserted, failed, skipped_channel,
      has_more: !!after, total_synced: totalLocal || 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
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
    return new Response(JSON.stringify({ ok: false, error: msg, upserted, failed }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});