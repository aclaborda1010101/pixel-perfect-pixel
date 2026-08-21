import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, CONTACT_PROPERTIES, hubspotFetch } from '../_shared/hubspot.ts';
import { materializeHubspotConsent } from '../_shared/ownerKnowledge.ts';

const PAGE_LIMIT = 100;
const DEFAULT_PAGES = 20;

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
    { auth: { persistSession: false } },
  );
  const entity = 'contact_diagnostics_inc';
  let logId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const pages = Math.max(1, Math.min(Number(body.pages) || DEFAULT_PAGES, 100));
    const fallbackDays = Math.max(1, Math.min(Number(body.fallback_days) || 7, 3650));
    await supabase.from('hubspot_sync_state').upsert({ entity }, { onConflict: 'entity' });
    const { data: state, error: stateError } = await supabase.from('hubspot_sync_state')
      .select('metadatos').eq('entity', entity).single();
    if (stateError) throw stateError;
    const previous = state?.metadatos || {};
    const sinceIso = typeof body.since_iso === 'string'
      ? body.since_iso
      : previous.since_ts || new Date(Date.now() - fallbackDays * 86_400_000).toISOString();
    const sinceMs = new Date(sinceIso).getTime();
    if (!Number.isFinite(sinceMs)) return json(400, { ok: false, error: 'since_iso inválido' });

    const { data: log, error: logError } = await supabase.from('hubspot_sync_log').insert({
      entity, status: 'running', metadatos: { since: sinceIso },
    }).select('id').single();
    if (logError) throw logError;
    logId = log.id;
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null,
    }).eq('entity', entity);

    let after: string | undefined;
    let maxSeen = sinceIso;
    let pagesFetched = 0;
    let contactsUpdated = 0;
    let consentsMaterialized = 0;
    let unmatched = 0;
    let failures = 0;

    for (let page = 0; page < pages; page++) {
      const searchBody: Record<string, unknown> = {
        filterGroups: [{ filters: [{ propertyName: 'lastmodifieddate', operator: 'GT', value: String(sinceMs) }] }],
        sorts: [{ propertyName: 'lastmodifieddate', direction: 'ASCENDING' }],
        properties: CONTACT_PROPERTIES,
        limit: PAGE_LIMIT,
      };
      if (after) searchBody.after = after;
      const response = await hubspotFetch('/crm/v3/objects/contacts/search', {
        method: 'POST', body: JSON.stringify(searchBody),
      });
      pagesFetched++;
      const contacts = Array.isArray(response?.results) ? response.results : [];
      if (contacts.length === 0) break;

      const ids = contacts.map((c: any) => String(c.id));
      const { data: links, error: linksError } = await supabase.from('external_ids')
        .select('entity_id,provider_id').eq('provider', 'hubspot')
        .eq('provider_object_type', 'contact').in('provider_id', ids);
      if (linksError) throw linksError;
      const ownerByContact = new Map((links || []).map((l: any) => [String(l.provider_id), String(l.entity_id)]));

      for (const contact of contacts) {
        try {
          const contactId = String(contact.id);
          const ownerId = ownerByContact.get(contactId);
          if (!ownerId) { unmatched++; continue; }
          const props = contact.properties || {};
          const { data: owner, error: ownerReadError } = await supabase.from('owners')
            .select('metadatos').eq('id', ownerId).single();
          if (ownerReadError) throw ownerReadError;
          const merged = { ...(owner?.metadatos || {}), ...props, _hubspot_contact_id: contactId };
          const { error: updateError } = await supabase.from('owners').update({
            metadatos: merged,
            email: props.email || null,
            telefono: props.phone || props.mobilephone || null,
            last_synced_at: new Date().toISOString(),
          }).eq('id', ownerId);
          if (updateError) throw updateError;
          if (await materializeHubspotConsent(supabase, ownerId, contactId, props)) consentsMaterialized++;
          contactsUpdated++;
          const modified = props.lastmodifieddate || contact.updatedAt;
          if (modified && String(modified) > maxSeen) maxSeen = String(modified);
        } catch (error) {
          failures++;
          console.error('[contact_diagnostics] contact failed', contact?.id, error);
        }
      }
      after = response?.paging?.next?.after;
      if (!after) break;
    }

    if (failures > 0) throw new Error(`${failures} contactos no pudieron actualizarse`);
    const finishedAt = new Date().toISOString();
    const metrics = { pages_fetched: pagesFetched, contacts_updated: contactsUpdated, consents_materialized: consentsMaterialized, unmatched, failures };
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt, status: 'ok', pages_fetched: pagesFetched,
      records_upserted: contactsUpdated, records_failed: 0, metadatos: { ...metrics, since: sinceIso, since_after: maxSeen },
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok', last_run_at: finishedAt, cursor: maxSeen, last_error: null,
      metadatos: { ...previous, since_ts: maxSeen, ...metrics },
    }).eq('entity', entity);
    return json(200, { ok: true, since: sinceIso, since_after: maxSeen, ...metrics });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (logId) await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(), status: 'error', error_message: message,
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({ last_run_status: 'error', last_error: message }).eq('entity', entity);
    console.error('[contact_diagnostics] failed', message);
    return json(500, { ok: false, error: message });
  }
});