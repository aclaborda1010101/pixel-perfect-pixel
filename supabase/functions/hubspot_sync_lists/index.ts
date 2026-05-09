// hubspot_sync_lists — sync de Lists (segmentos) y memberships. Solo lectura.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const LIST_PAGE = 100;
const MEMBERSHIP_PAGE = 250;
const MAX_LIST_PAGES = 5;
const MAX_MEMBERSHIP_PAGES_PER_LIST = 20;

function tsOrNull(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const skipMemberships = !!body.skip_memberships;

  const { data: logRow } = await supabase
    .from('hubspot_sync_log').insert({ entity: 'lists', status: 'running' }).select('id').single();
  const logId = logRow?.id;

  await supabase.from('hubspot_sync_state').update({
    last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null,
  }).eq('entity', 'lists');

  let listsUpserted = 0, membershipsUpserted = 0, failed = 0;

  try {
    // 1) List index via search (POST /crm/v3/lists/search)
    let after = 0;
    const allLists: any[] = [];
    for (let p = 0; p < MAX_LIST_PAGES; p++) {
      const data = await hubspotFetch('/crm/v3/lists/search', {
        method: 'POST',
        body: JSON.stringify({ count: LIST_PAGE, offset: after, additionalProperties: ['hs_list_size'] }),
      });
      const results: any[] = data?.lists || [];
      allLists.push(...results);
      const total = data?.total ?? 0;
      after += results.length;
      if (results.length === 0 || after >= total) break;
    }

    for (const l of allLists) {
      try {
        const row = {
          hs_list_id: String(l.listId ?? l.hs_list_id ?? l.id),
          name: l.name || null,
          list_type: l.listType || l.processingType || null,
          object_type_id: l.objectTypeId || null,
          processing_type: l.processingType || null,
          size: typeof l.size === 'number' ? l.size : (l.additionalProperties?.hs_list_size ? parseInt(l.additionalProperties.hs_list_size, 10) : null),
          created_at_hs: tsOrNull(l.createdAt),
          updated_at_hs: tsOrNull(l.updatedAt),
          raw: l,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('hubspot_lists').upsert(row, { onConflict: 'hs_list_id' });
        if (error) throw error;
        listsUpserted++;
      } catch (err) {
        failed++;
        console.error(`[lists] failed list ${l.listId}:`, err);
      }
    }

    // 2) Memberships per list (capped per run)
    if (!skipMemberships) {
      for (const l of allLists) {
        const listId = String(l.listId ?? l.hs_list_id ?? l.id);
        let mAfter: string | undefined = undefined;
        for (let p = 0; p < MAX_MEMBERSHIP_PAGES_PER_LIST; p++) {
          const params = new URLSearchParams();
          params.set('limit', String(MEMBERSHIP_PAGE));
          if (mAfter) params.set('after', mAfter);
          let data: any;
          try {
            data = await hubspotFetch(`/crm/v3/lists/${listId}/memberships?${params.toString()}`);
          } catch (err) {
            console.error(`[lists] memberships fetch failed ${listId}:`, err);
            break;
          }
          const results: any[] = data?.results || [];
          if (results.length) {
            const rows = results.map((r: any) => ({
              hs_list_id: listId,
              record_id: String(r.recordId ?? r.id),
              object_type: l.objectTypeId || 'unknown',
              added_at: tsOrNull(r.membershipTimestamp ?? r.addedAt),
              observed_at: new Date().toISOString(),
            }));
            const { error } = await supabase.from('hubspot_list_memberships').upsert(rows, { onConflict: 'hs_list_id,record_id' });
            if (error) { failed += rows.length; console.error(`[lists] mship upsert err:`, error); }
            else membershipsUpserted += rows.length;
          }
          mAfter = data?.paging?.next?.after;
          if (!mAfter) break;
        }
      }
    }

    const finishedAt = new Date().toISOString();
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt, status: 'ok',
      pages_fetched: 1, records_upserted: listsUpserted, records_failed: failed,
      metadatos: { memberships_upserted: membershipsUpserted, lists_total: allLists.length },
    }).eq('id', logId);

    const { count: total } = await supabase.from('hubspot_lists').select('id', { count: 'exact', head: true });
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok', last_run_at: finishedAt, last_full_sync_at: finishedAt,
      total_synced: total || 0,
    }).eq('entity', 'lists');

    return new Response(JSON.stringify({
      ok: true, lists_upserted: listsUpserted, memberships_upserted: membershipsUpserted, failed, total_lists: total || 0,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[hubspot_sync_lists] error:', msg);
    await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(), status: 'error',
      records_upserted: listsUpserted, records_failed: failed, error_message: msg,
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'error', last_error: msg,
    }).eq('entity', 'lists');
    return new Response(JSON.stringify({ ok: false, error: msg, lists_upserted: listsUpserted }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});