// hubspot_sync_deals — pull paginado de HubSpot Deals (objectTypeId 0-3)
// Upsert en buildings + external_ids. Mantiene cursor en hubspot_sync_state.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders, DEAL_PROPERTIES } from '../_shared/hubspot.ts';

const PAGE_LIMIT = 100;
const MAX_PAGES_PER_RUN = 10; // ~1000 deals por pulsación; 7300 totales caben en 8 pulsaciones

interface HubspotDeal {
  id: string;
  properties: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
}

function pickAddress(p: Record<string, string | null>): string {
  // Prioriza address; si no, dealname; si no, cadastral_reference; si no, "Sin dirección"
  return (p.address?.trim() || p.dealname?.trim() || p.cadastral_reference?.trim() || 'Sin dirección');
}

function pickCiudad(p: Record<string, string | null>): string {
  return p.city?.trim() || p.distrito_zona?.trim() || 'Madrid';
}

function parseInt0(v: string | null | undefined): number | null {
  if (!v) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Crear log
  const { data: logRow } = await supabase
    .from('hubspot_sync_log')
    .insert({ entity: 'deals', status: 'running' })
    .select('id')
    .single();
  const logId = logRow?.id;

  await supabase.from('hubspot_sync_state').update({
    last_run_status: 'running',
    last_run_at: new Date().toISOString(),
    last_error: null,
  }).eq('entity', 'deals');

  let pagesFetched = 0;
  let upserted = 0;
  let failed = 0;

  try {
    // Leer cursor
    const { data: state } = await supabase
      .from('hubspot_sync_state')
      .select('cursor')
      .eq('entity', 'deals')
      .single();
    let after: string | undefined = state?.cursor || undefined;

    // Reset si se pasó "reset=true" en body
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
      DEAL_PROPERTIES.forEach((p) => params.append('properties', p));
      if (after) params.set('after', after);

      const data = await hubspotFetch(`/crm/v3/objects/deals?${params.toString()}`);
      pagesFetched++;
      const results: HubspotDeal[] = data?.results || [];

      for (const deal of results) {
        try {
          const props = deal.properties || {};
          // Upsert por external_id
          const { data: existing } = await supabase
            .from('external_ids')
            .select('entity_id')
            .eq('provider', 'hubspot')
            .eq('provider_object_type', 'deal')
            .eq('provider_id', deal.id)
            .maybeSingle();

          const buildingPayload = {
            direccion: pickAddress(props),
            ciudad: pickCiudad(props),
            codigo_postal: props.zip?.trim() || null,
            catastro_ref: props.cadastral_reference?.trim() || null,
            metadatos: { ...props, _hubspot_deal_id: deal.id },
            last_synced_at: new Date().toISOString(),
          };

          let buildingId: string;
          if (existing?.entity_id) {
            buildingId = existing.entity_id;
            const { error: upErr } = await supabase
              .from('buildings')
              .update(buildingPayload)
              .eq('id', buildingId);
            if (upErr) throw upErr;
          } else {
            // Insert building primero
            const { data: ins, error: insErr } = await supabase
              .from('buildings')
              .insert(buildingPayload)
              .select('id')
              .single();
            if (insErr) throw insErr;
            buildingId = ins!.id;
            // Intentar insertar mapping external_ids. Si colisiona (23505), otro
            // run ya creó el mapping: limpiamos el building huérfano y reusamos el ganador.
            const { error: extErr } = await supabase.from('external_ids').insert({
              entity_type: 'building',
              entity_id: buildingId,
              provider: 'hubspot',
              provider_object_type: 'deal',
              provider_id: deal.id,
              metadatos: { hs_object_id: deal.id },
            });
            if (extErr) {
              if ((extErr as any).code === '23505') {
                // Conflict: borrar building huérfano y usar el existente
                await supabase.from('buildings').delete().eq('id', buildingId);
                const { data: winner, error: winErr } = await supabase
                  .from('external_ids')
                  .select('entity_id')
                  .eq('provider', 'hubspot')
                  .eq('provider_object_type', 'deal')
                  .eq('provider_id', deal.id)
                  .single();
                if (winErr || !winner) throw winErr ?? new Error('winner not found');
                buildingId = winner.entity_id;
                await supabase.from('buildings').update(buildingPayload).eq('id', buildingId);
              } else {
                throw extErr;
              }
            }
          }
          upserted++;
        } catch (e) {
          failed++;
          console.error(`[deals] failed deal ${deal.id}:`, e);
        }
      }

      after = data?.paging?.next?.after;
      // Persistir cursor en cada página por si se corta
      await supabase.from('hubspot_sync_state').update({
        cursor: after || null,
      }).eq('entity', 'deals');

      if (!after) break;
    }

    const finishedAt = new Date().toISOString();

    // Cerrar log
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt,
      status: 'ok',
      pages_fetched: pagesFetched,
      records_upserted: upserted,
      records_failed: failed,
    }).eq('id', logId);

    // Calcular total_synced acumulado real desde external_ids
    const { count: totalDeals } = await supabase
      .from('external_ids')
      .select('id', { count: 'exact', head: true })
      .eq('provider', 'hubspot')
      .eq('provider_object_type', 'deal');

    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'ok',
      last_run_at: finishedAt,
      last_full_sync_at: !state?.cursor ? finishedAt : null,
      total_synced: totalDeals || 0,
    }).eq('entity', 'deals');

    const { data: stateAfter } = await supabase
      .from('hubspot_sync_state').select('cursor').eq('entity', 'deals').single();

    return new Response(JSON.stringify({
      ok: true,
      pages_fetched: pagesFetched,
      upserted,
      failed,
      has_more: !!stateAfter?.cursor,
      total_synced: totalDeals || 0,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[hubspot_sync_deals] error:', msg);
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
    }).eq('entity', 'deals');
    return new Response(JSON.stringify({ ok: false, error: msg, upserted, failed }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});