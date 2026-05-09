// hubspot_sync_engagements — sync paginado de Tasks (0-27) / Calls (0-48) / Notes (0-46).
// Solo lectura sobre HubSpot (GET). Upsert en hubspot_tasks / hubspot_calls / hubspot_notes.
// Versionado básico en hubspot_changes_log si cambia hs_lastmodifieddate.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 15;

type EngType = 'tasks' | 'calls' | 'notes';

const PROPS: Record<EngType, string[]> = {
  tasks: ['hs_task_subject','hs_task_body','hs_task_status','hs_task_priority','hs_task_type','hs_timestamp','hs_task_completion_date','hs_createdate','hs_lastmodifieddate'],
  calls: ['hs_call_title','hs_call_body','hs_call_status','hs_call_direction','hs_call_disposition','hs_call_duration','hs_call_recording_url','hs_call_to_number','hs_call_from_number','hs_timestamp','hs_createdate','hs_lastmodifieddate'],
  notes: ['hs_note_body','hs_timestamp','hs_createdate','hs_lastmodifieddate'],
};

const TABLE: Record<EngType, string> = {
  tasks: 'hubspot_tasks',
  calls: 'hubspot_calls',
  notes: 'hubspot_notes',
};

function tsOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intOrNull(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function toRow(type: EngType, e: any): Record<string, unknown> {
  const p = e.properties || {};
  const assoc = e.associations || {};
  const contactIds: string[] = (assoc.contacts?.results || []).map((r: any) => String(r.id));
  const dealIds: string[] = (assoc.deals?.results || []).map((r: any) => String(r.id));
  const base = {
    hs_id: String(e.id),
    hs_timestamp: tsOrNull(p.hs_timestamp),
    hs_createdate: tsOrNull(p.hs_createdate ?? e.createdAt),
    hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
    associated_contact_ids: contactIds,
    associated_deal_ids: dealIds,
    raw: e,
    updated_at: new Date().toISOString(),
  };
  if (type === 'tasks') {
    return {
      ...base,
      hs_task_subject: p.hs_task_subject || null,
      hs_task_body: p.hs_task_body || null,
      hs_task_status: p.hs_task_status || null,
      hs_task_priority: p.hs_task_priority || null,
      hs_task_type: p.hs_task_type || null,
      hs_task_completion_date: tsOrNull(p.hs_task_completion_date),
    };
  }
  if (type === 'calls') {
    return {
      ...base,
      hs_call_title: p.hs_call_title || null,
      hs_call_body: p.hs_call_body || null,
      hs_call_status: p.hs_call_status || null,
      hs_call_direction: p.hs_call_direction || null,
      hs_call_disposition: p.hs_call_disposition || null,
      hs_call_duration: intOrNull(p.hs_call_duration),
      hs_call_recording_url: p.hs_call_recording_url || null,
      hs_call_to_number: p.hs_call_to_number || null,
      hs_call_from_number: p.hs_call_from_number || null,
    };
  }
  return {
    ...base,
    hs_note_body: p.hs_note_body || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const type: EngType = (body.type || 'tasks') as EngType;
  if (!['tasks','calls','notes'].includes(type)) {
    return new Response(JSON.stringify({ ok: false, error: `invalid type ${type}` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
  const reset = !!body.reset;

  const { data: logRow } = await supabase
    .from('hubspot_sync_log').insert({ entity: type, status: 'running' }).select('id').single();
  const logId = logRow?.id;

  await supabase.from('hubspot_sync_state').update({
    last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null,
  }).eq('entity', type);

  let pagesFetched = 0, upserted = 0, failed = 0, changesLogged = 0;

  try {
    const { data: state } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', type).single();
    let after: string | undefined = reset ? undefined : (state?.cursor || undefined);

    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      params.set('archived', 'false');
      PROPS[type].forEach((p) => params.append('properties', p));
      params.append('associations', 'contacts');
      params.append('associations', 'deals');
      if (after) params.set('after', after);

      const data = await hubspotFetch(`/crm/v3/objects/${type}?${params.toString()}`);
      pagesFetched++;
      const results: any[] = data?.results || [];

      for (const e of results) {
        try {
          const row = toRow(type, e);
          // Detect change for versioning: compare hs_lastmodifieddate
          const { data: prev } = await supabase
            .from(TABLE[type]).select('hs_lastmodifieddate').eq('hs_id', row.hs_id as string).maybeSingle();
          const prevLM = prev?.hs_lastmodifieddate || null;
          const newLM = row.hs_lastmodifieddate as string | null;
          if (prev && prevLM !== newLM) {
            await supabase.from('hubspot_changes_log').insert({
              entity_type: type, hs_id: row.hs_id as string,
              field: 'hs_lastmodifieddate',
              old_value: prevLM, new_value: newLM,
            });
            changesLogged++;
          }
          const { error } = await supabase.from(TABLE[type]).upsert(row, { onConflict: 'hs_id' });
          if (error) throw error;
          upserted++;
        } catch (err) {
          failed++;
          console.error(`[${type}] failed ${e.id}:`, err);
        }
      }

      after = data?.paging?.next?.after;
      await supabase.from('hubspot_sync_state').update({ cursor: after || null }).eq('entity', type);
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt, status: 'ok',
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed,
      metadatos: { changes_logged: changesLogged },
    }).eq('id', logId);

    const { count: total } = await supabase.from(TABLE[type]).select('id', { count: 'exact', head: true });
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok', last_run_at: finishedAt,
      last_full_sync_at: !state?.cursor ? finishedAt : null,
      total_synced: total || 0,
    }).eq('entity', type);

    const { data: after2 } = await supabase.from('hubspot_sync_state').select('cursor').eq('entity', type).single();

    return new Response(JSON.stringify({
      ok: true, type, pages_fetched: pagesFetched, upserted, failed,
      changes_logged: changesLogged, has_more: !!after2?.cursor, total_synced: total || 0,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[hubspot_sync_engagements ${type}] error:`, msg);
    await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(), status: 'error',
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed,
      error_message: msg,
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'error', last_error: msg,
    }).eq('entity', type);
    return new Response(JSON.stringify({ ok: false, error: msg, upserted, failed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});