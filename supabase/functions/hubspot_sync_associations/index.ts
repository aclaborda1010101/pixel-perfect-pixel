// hubspot_sync_associations — para cada deal sincronizado, lee asociaciones a contacts
// vía /crm/v4/associations/deals/contacts/batch/read y rellena building_owners.
// Idempotente: skip si (building_id, owner_id) ya existe.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const BATCH_SIZE = 100;
const MAX_BATCHES_PER_RUN = 30; // hasta 3000 deals por invocación

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: logRow } = await supabase
    .from('hubspot_sync_log')
    .insert({ entity: 'associations', status: 'running' })
    .select('id').single();
  const logId = logRow?.id;

  await supabase.from('hubspot_sync_state').upsert({
    entity: 'associations',
    last_run_status: 'running',
    last_run_at: new Date().toISOString(),
    last_error: null,
  }, { onConflict: 'entity' });

  let batches = 0;
  let inserted = 0;
  let pairsSeen = 0;
  let failed = 0;

  try {
    let reset = false;
    let onlyOrphans = false;
    try {
      const b = await req.json().catch(() => ({}));
      reset = !!b?.reset;
      onlyOrphans = !!b?.only_orphans;
    } catch { /* ignore */ }

    const { data: state } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'associations').single();
    const startAfter = reset ? null : (state?.cursor || null);

    // Cargar deals desde external_ids paginando por chunks de 1000 (límite Supabase)
    const TARGET = BATCH_SIZE * MAX_BATCHES_PER_RUN;
    const deals: { entity_id: string; provider_id: string }[] = [];
    let pageAfter: string | null = startAfter;
    while (deals.length < TARGET) {
      const remaining = TARGET - deals.length;
      const limit = Math.min(1000, remaining);
      let q = supabase
        .from('external_ids')
        .select('entity_id, provider_id')
        .eq('provider', 'hubspot')
        .eq('provider_object_type', 'deal')
        .order('provider_id', { ascending: true })
        .limit(limit);
      if (pageAfter) q = q.gt('provider_id', pageAfter);
      const { data: chunk, error: cErr } = await q;
      if (cErr) throw cErr;
      if (!chunk || chunk.length === 0) break;
      deals.push(...chunk);
      pageAfter = chunk[chunk.length - 1].provider_id;
      if (chunk.length < limit) break;
    }
    const dealsErr = null as any;
    if (dealsErr) throw dealsErr;
    if (!deals || deals.length === 0) {
      // wrap-up
      await supabase.from('hubspot_sync_state').update({
        cursor: null,
        last_run_status: 'ok',
        last_run_at: new Date().toISOString(),
      }).eq('entity', 'associations');
      await supabase.from('hubspot_sync_log').update({
        finished_at: new Date().toISOString(),
        status: 'ok',
        records_upserted: 0,
      }).eq('id', logId);
      return new Response(JSON.stringify({ ok: true, done: true, inserted: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const dealHsToBuildingId = new Map<string, string>();
    deals.forEach((d) => dealHsToBuildingId.set(d.provider_id, d.entity_id));

    let lastProviderId: string | null = null;

    for (let i = 0; i < deals.length; i += BATCH_SIZE) {
      const slice = deals.slice(i, i + BATCH_SIZE);
      batches++;
      const inputs = slice.map((d) => ({ id: d.provider_id }));
      const body = JSON.stringify({ inputs });
      let assocResp: any;
      try {
        assocResp = await hubspotFetch('/crm/v4/associations/deals/contacts/batch/read', {
          method: 'POST', body,
        });
      } catch (e) {
        failed++;
        console.error('[assoc] batch fail:', e);
        continue;
      }
      const results = assocResp?.results || [];
      // results: [{from:{id}, to:[{toObjectId,...}]}]
      // collect contact ids
      const allContactIds = new Set<string>();
      for (const r of results) {
        for (const t of (r.to || [])) allContactIds.add(String(t.toObjectId));
      }
      let contactMap = new Map<string, string>();
      if (allContactIds.size > 0) {
        const ids = Array.from(allContactIds);
        // chunked lookup
        for (let k = 0; k < ids.length; k += 500) {
          const chunk = ids.slice(k, k + 500);
          const { data: cs } = await supabase
            .from('external_ids')
            .select('entity_id, provider_id')
            .eq('provider', 'hubspot')
            .eq('provider_object_type', 'contact')
            .in('provider_id', chunk);
          (cs || []).forEach((c) => contactMap.set(c.provider_id, c.entity_id));
        }
      }

      const rows: any[] = [];
      for (const r of results) {
        const dealHs = String(r.from?.id || '');
        const buildingId = dealHsToBuildingId.get(dealHs);
        if (!buildingId) continue;
        for (const t of (r.to || [])) {
          pairsSeen++;
          const ownerId = contactMap.get(String(t.toObjectId));
          if (!ownerId) continue;
          rows.push({
            building_id: buildingId,
            owner_id: ownerId,
            cuota: null,
            metadatos: { source: 'hubspot_assoc', hs_deal_id: dealHs, hs_contact_id: String(t.toObjectId) },
          });
        }
      }

      if (rows.length > 0) {
        // Use upsert with ignoreDuplicates to skip existing pairs
        const { error: upErr, count } = await supabase
          .from('building_owners')
          .upsert(rows, { onConflict: 'building_id,owner_id', ignoreDuplicates: true, count: 'exact' });
        if (upErr) {
          failed++;
          console.error('[assoc] upsert fail:', upErr);
        } else {
          inserted += count || 0;
        }
      }

      lastProviderId = slice[slice.length - 1].provider_id;
      // persist cursor each batch
      await supabase.from('hubspot_sync_state').update({
        cursor: lastProviderId,
      }).eq('entity', 'associations');
    }

    const hasMore = deals.length >= TARGET;
    const finishedAt = new Date().toISOString();

    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt,
      status: 'ok',
      pages_fetched: batches,
      records_upserted: inserted,
      records_failed: failed,
      metadatos: { pairs_seen: pairsSeen, has_more: hasMore },
    }).eq('id', logId);

    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok',
      last_run_at: finishedAt,
      total_synced: inserted,
      cursor: hasMore ? lastProviderId : null,
    }).eq('entity', 'associations');

    return new Response(JSON.stringify({
      ok: true,
      batches,
      pairs_seen: pairsSeen,
      inserted,
      failed,
      has_more: hasMore,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[hubspot_sync_associations] error:', msg);
    await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      records_upserted: inserted,
      records_failed: failed,
      error_message: msg,
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'error',
      last_error: msg,
    }).eq('entity', 'associations');
    return new Response(JSON.stringify({ ok: false, error: msg, inserted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});