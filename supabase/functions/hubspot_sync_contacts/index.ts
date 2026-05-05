// hubspot_sync_contacts — pull paginado de HubSpot Contacts (objectTypeId 0-1)
// Upsert en owners + external_ids. Asociaciones a deals (building_owners) en una segunda pasada.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders, CONTACT_PROPERTIES } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 10;

interface HubspotContact {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    deals?: { results: Array<{ id: string; type: string }> };
  };
}

function pickNombre(p: Record<string, string | null>): string {
  const fn = (p.firstname || '').trim();
  const ln = (p.lastname || '').trim();
  const full = `${fn} ${ln}`.trim();
  if (full) return full;
  if (p.email?.trim()) return p.email.trim();
  return 'Sin nombre';
}

function mapRol(p: Record<string, string | null>): string {
  const t = (p.tipologia_de_propietario || '').toLowerCase();
  if (t.includes('inversor')) return 'inversor';
  if (t.includes('lead')) return 'lead';
  if (t.includes('candidato')) return 'candidato';
  if (t.includes('propietario') || p.dni__nif__cif) return 'propietario';
  return 'desconocido';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: logRow } = await supabase
    .from('hubspot_sync_log')
    .insert({ entity: 'contacts', status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  await supabase.from('hubspot_sync_state').update({
    last_run_status: 'running',
    last_run_at: new Date().toISOString(),
    last_error: null,
  }).eq('entity', 'contacts');

  let pagesFetched = 0;
  let upserted = 0;
  let failed = 0;
  let assocCreated = 0;

  try {
    const { data: state } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'contacts').single();
    let after: string | undefined = state?.cursor || undefined;

    let reset = false;
    try {
      const b = await req.json().catch(() => ({}));
      reset = !!b?.reset;
    } catch { /* ignore */ }
    if (reset) after = undefined;

    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      params.set('archived', 'false');
      CONTACT_PROPERTIES.forEach((p) => params.append('properties', p));
      params.append('associations', 'deals');
      if (after) params.set('after', after);

      const data = await hubspotFetch(`/crm/v3/objects/contacts?${params.toString()}`);
      pagesFetched++;
      const results: HubspotContact[] = data?.results || [];

      for (const contact of results) {
        try {
          const props = contact.properties || {};

          const { data: existing } = await supabase
            .from('external_ids')
            .select('entity_id')
            .eq('provider', 'hubspot')
            .eq('provider_object_type', 'contact')
            .eq('provider_id', contact.id)
            .maybeSingle();

          const ownerPayload: any = {
            nombre: pickNombre(props),
            email: props.email?.trim() || null,
            telefono: props.phone?.trim() || null,
            rol: mapRol(props),
            metadatos: { ...props, _hubspot_contact_id: contact.id },
            last_synced_at: new Date().toISOString(),
          };

          let ownerId: string;
          if (existing?.entity_id) {
            ownerId = existing.entity_id;
            const { error: upErr } = await supabase
              .from('owners').update(ownerPayload).eq('id', ownerId);
            if (upErr) throw upErr;
          } else {
            const { data: ins, error: insErr } = await supabase
              .from('owners').insert(ownerPayload).select('id').single();
            if (insErr) throw insErr;
            ownerId = ins!.id;
            const { error: extErr } = await supabase.from('external_ids').insert({
              entity_type: 'owner',
              entity_id: ownerId,
              provider: 'hubspot',
              provider_object_type: 'contact',
              provider_id: contact.id,
              metadatos: { hs_object_id: contact.id },
            });
            if (extErr) throw extErr;
          }
          upserted++;

          // Asociaciones contact -> deals
          const dealAssocs = contact.associations?.deals?.results || [];
          for (const da of dealAssocs) {
            try {
              const { data: dealExt } = await supabase
                .from('external_ids')
                .select('entity_id')
                .eq('provider', 'hubspot')
                .eq('provider_object_type', 'deal')
                .eq('provider_id', da.id)
                .maybeSingle();
              if (!dealExt?.entity_id) continue; // deal aún no sincronizado
              const buildingId = dealExt.entity_id;

              // Insert si no existe
              const { data: existingBO } = await supabase
                .from('building_owners')
                .select('owner_id')
                .eq('owner_id', ownerId)
                .eq('building_id', buildingId)
                .maybeSingle();
              if (!existingBO) {
                const { error: boErr } = await supabase.from('building_owners').insert({
                  owner_id: ownerId,
                  building_id: buildingId,
                  metadatos: { _hubspot_assoc_type: da.type },
                });
                if (!boErr) assocCreated++;
              }
            } catch (e) {
              console.error(`[contacts] assoc fail contact=${contact.id} deal=${da.id}:`, e);
            }
          }
        } catch (e) {
          failed++;
          console.error(`[contacts] failed contact ${contact.id}:`, e);
        }
      }

      after = data?.paging?.next?.after;
      await supabase.from('hubspot_sync_state').update({
        cursor: after || null,
      }).eq('entity', 'contacts');

      if (!after) break;
    }

    const finishedAt = new Date().toISOString();

    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt,
      status: 'ok',
      pages_fetched: pagesFetched,
      records_upserted: upserted,
      records_failed: failed,
      metadatos: { associations_created: assocCreated },
    }).eq('id', logId);

    const { count: totalContacts } = await supabase
      .from('external_ids')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'hubspot')
      .eq('provider_object_type', 'contact');

    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok',
      last_run_at: finishedAt,
      last_full_sync_at: !state?.cursor ? finishedAt : null,
      total_synced: totalContacts || 0,
    }).eq('entity', 'contacts');

    const { data: stateAfter } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'contacts').single();

    return new Response(JSON.stringify({
      ok: true,
      pages_fetched: pagesFetched,
      upserted,
      failed,
      associations_created: assocCreated,
      has_more: !!stateAfter?.cursor,
      total_synced: totalContacts || 0,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[hubspot_sync_contacts] error:', msg);
    await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      pages_fetched: pagesFetched,
      records_upserted: upserted,
      records_failed: failed,
      error_message: msg,
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'error',
      last_error: msg,
    }).eq('entity', 'contacts');
    return new Response(JSON.stringify({ ok: false, error: msg, upserted, failed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});