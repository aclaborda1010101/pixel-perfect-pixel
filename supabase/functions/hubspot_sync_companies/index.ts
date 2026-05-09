// hubspot_sync_companies — pull paginado de HubSpot Companies (objectTypeId 0-2)
// Upsert en companies + external_ids. Read-only contra HubSpot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 10;

const COMPANY_PROPERTIES = [
  'name', 'domain', 'phone', 'address', 'city', 'zip', 'country',
  'createdate', 'hs_lastmodifieddate',
  // Afflux custom — best effort; no afecta si no existen
  'cif', 'dni__nif__cif', 'tipologia_de_propietario',
  'distrito_zona', 'barrios_completos',
];

interface HubspotCompany {
  id: string;
  properties: Record<string, string | null>;
}

function pickNombre(p: Record<string, string | null>): string {
  return (p.name?.trim() || p.domain?.trim() || 'Sin nombre');
}

function pickCif(p: Record<string, string | null>): string | null {
  return (p.cif?.trim() || p.dni__nif__cif?.trim() || null);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: logRow } = await supabase
    .from('hubspot_sync_log')
    .insert({ entity: 'companies', status: 'running' })
    .select('id').single();
  const logId = logRow?.id;

  // ensure state row
  await supabase.from('hubspot_sync_state').upsert(
    { entity: 'companies', last_run_status: 'running', last_run_at: new Date().toISOString(), last_error: null },
    { onConflict: 'entity' },
  );

  let pagesFetched = 0, upserted = 0, failed = 0;

  try {
    const { data: state } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'companies').maybeSingle();
    let after: string | undefined = state?.cursor || undefined;

    let reset = false;
    try { const b = await req.json().catch(() => ({})); reset = !!b?.reset; } catch { /* */ }
    if (reset) after = undefined;

    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const params = new URLSearchParams();
      params.set('limit', String(PAGE_LIMIT));
      params.set('archived', 'false');
      COMPANY_PROPERTIES.forEach((p) => params.append('properties', p));
      if (after) params.set('after', after);

      const data = await hubspotFetch(`/crm/v3/objects/companies?${params.toString()}`);
      pagesFetched++;
      const results: HubspotCompany[] = data?.results || [];

      for (const co of results) {
        try {
          const props = co.properties || {};
          const { data: existing } = await supabase
            .from('external_ids').select('entity_id')
            .eq('provider', 'hubspot').eq('provider_object_type', 'company')
            .eq('provider_id', co.id).maybeSingle();

          const payload: any = {
            nombre: pickNombre(props),
            cif: pickCif(props),
            telefono: props.phone?.trim() || null,
            metadatos: { ...props, _hubspot_company_id: co.id },
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          if (existing?.entity_id) {
            const { error } = await supabase.from('companies').update(payload).eq('id', existing.entity_id);
            if (error) throw error;
          } else {
            const { data: ins, error } = await supabase.from('companies').insert(payload).select('id').single();
            if (error) throw error;
            const { error: extErr } = await supabase.from('external_ids').insert({
              entity_type: 'company', entity_id: ins!.id,
              provider: 'hubspot', provider_object_type: 'company',
              provider_id: co.id, metadatos: { hs_object_id: co.id },
            });
            if (extErr && (extErr as any).code !== '23505') throw extErr;
          }
          upserted++;
        } catch (e) {
          failed++;
          console.error(`[companies] failed ${co.id}:`, e);
        }
      }

      after = data?.paging?.next?.after;
      await supabase.from('hubspot_sync_state').update({ cursor: after || null })
        .eq('entity', 'companies');

      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt, status: 'ok',
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed,
    }).eq('id', logId);

    const { count: totalCompanies } = await supabase
      .from('external_ids').select('id', { count: 'exact', head: true })
      .eq('provider', 'hubspot').eq('provider_object_type', 'company');

    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok', last_run_at: finishedAt,
      last_full_sync_at: !state?.cursor ? finishedAt : null,
      total_synced: totalCompanies || 0,
    }).eq('entity', 'companies');

    const { data: stateAfter } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'companies').maybeSingle();

    return new Response(JSON.stringify({
      ok: true, pages_fetched: pagesFetched, upserted, failed,
      has_more: !!stateAfter?.cursor, total_synced: totalCompanies || 0,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[hubspot_sync_companies] error:', msg);
    await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(), status: 'error',
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed,
      error_message: msg,
    }).eq('id', logId);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'error', last_error: msg,
    }).eq('entity', 'companies');
    return new Response(JSON.stringify({ ok: false, error: msg, upserted, failed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});