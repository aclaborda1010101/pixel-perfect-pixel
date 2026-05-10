// backfill_archived_contacts — recoge contact_ids de associations deal->contact
// que NO existen en external_ids, los fetchea via batch/read?archived=true,
// y bulk-inserta owners + external_ids con metadatos.archived=true.
// Idempotente. Self-chains: usa hubspot_sync_state(entity='backfill_contacts')
// con metadatos = { phase, deal_cursor, missing_ids[] }.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders, CONTACT_PROPERTIES } from '../_shared/hubspot.ts';

const ASSOC_BATCH = 100;       // deals per association batch
const MAX_ASSOC_BATCHES = 40;  // 4000 deals per invocation in collect phase
const FETCH_BATCH = 100;       // contacts per batch_read
const MAX_FETCH_BATCHES = 25;  // 2500 contacts per invocation in fetch phase

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const reset = !!body?.reset;

  // Load state
  if (reset) {
    await supabase.from('hubspot_sync_state').upsert({
      entity: 'backfill_contacts',
      metadatos: { phase: 'collect', deal_cursor: null, missing_ids: [] },
      cursor: null,
      total_synced: 0,
      last_run_status: 'running',
      last_run_at: new Date().toISOString(),
      last_error: null,
    }, { onConflict: 'entity' });
  } else {
    await supabase.from('hubspot_sync_state').upsert({
      entity: 'backfill_contacts',
      last_run_status: 'running',
      last_run_at: new Date().toISOString(),
    }, { onConflict: 'entity' });
  }

  const { data: stateRow } = await supabase
    .from('hubspot_sync_state').select('metadatos, total_synced')
    .eq('entity', 'backfill_contacts').maybeSingle();
  const meta = (stateRow?.metadatos || {}) as any;
  let phase: 'collect' | 'fetch' | 'done' = meta.phase || 'collect';
  let dealCursor: string | null = meta.deal_cursor || null;
  let missingIds: string[] = Array.isArray(meta.missing_ids) ? meta.missing_ids : [];
  let totalSynced: number = stateRow?.total_synced || 0;

  let assocBatchesRun = 0;
  let pairsSeen = 0;
  let inserted = 0;
  let failed = 0;
  let fetchedFromHs = 0;

  try {
    if (phase === 'collect') {
      // Iterate deals from external_ids, collect missing contact ids
      while (assocBatchesRun < MAX_ASSOC_BATCHES) {
        let q = supabase
          .from('external_ids')
          .select('provider_id')
          .eq('provider', 'hubspot')
          .eq('provider_object_type', 'deal')
          .order('provider_id', { ascending: true })
          .limit(ASSOC_BATCH);
        if (dealCursor) q = q.gt('provider_id', dealCursor);
        const { data: deals, error: dErr } = await q;
        if (dErr) throw dErr;
        if (!deals || deals.length === 0) {
          phase = 'fetch';
          break;
        }
        const dealIds = deals.map((d) => d.provider_id);
        let assocResp: any;
        try {
          assocResp = await hubspotFetch('/crm/v4/associations/deals/contacts/batch/read', {
            method: 'POST',
            body: JSON.stringify({ inputs: dealIds.map((id) => ({ id })) }),
          });
        } catch (e) {
          console.error('[backfill] assoc batch fail:', e);
          failed++;
          dealCursor = dealIds[dealIds.length - 1];
          assocBatchesRun++;
          continue;
        }
        const results = assocResp?.results || [];
        const contactIds = new Set<string>();
        for (const r of results) {
          for (const t of (r.to || [])) {
            pairsSeen++;
            contactIds.add(String(t.toObjectId));
          }
        }
        if (contactIds.size > 0) {
          const ids = Array.from(contactIds);
          // Lookup which already exist in external_ids
          const existing = new Set<string>();
          for (let k = 0; k < ids.length; k += 500) {
            const chunk = ids.slice(k, k + 500);
            const { data: cs } = await supabase
              .from('external_ids')
              .select('provider_id')
              .eq('provider', 'hubspot')
              .eq('provider_object_type', 'contact')
              .in('provider_id', chunk);
            (cs || []).forEach((c) => existing.add(c.provider_id));
          }
          for (const id of ids) {
            if (!existing.has(id)) missingIds.push(id);
          }
        }
        dealCursor = dealIds[dealIds.length - 1];
        assocBatchesRun++;

        // persist progress
        // dedupe missing
        if (assocBatchesRun % 5 === 0) {
          missingIds = Array.from(new Set(missingIds));
          await supabase.from('hubspot_sync_state').update({
            metadatos: { phase, deal_cursor: dealCursor, missing_ids: missingIds },
          }).eq('entity', 'backfill_contacts');
        }
        if (deals.length < ASSOC_BATCH) {
          phase = 'fetch';
          break;
        }
      }
      // dedupe + persist
      missingIds = Array.from(new Set(missingIds));
      await supabase.from('hubspot_sync_state').update({
        metadatos: { phase, deal_cursor: dealCursor, missing_ids: missingIds },
      }).eq('entity', 'backfill_contacts');
    }

    if (phase === 'fetch') {
      let fetchBatches = 0;
      while (missingIds.length > 0 && fetchBatches < MAX_FETCH_BATCHES) {
        const chunk = missingIds.slice(0, FETCH_BATCH);
        let resp: any;
        try {
          resp = await hubspotFetch('/crm/v3/objects/contacts/batch/read?archived=true', {
            method: 'POST',
            body: JSON.stringify({
              inputs: chunk.map((id) => ({ id })),
              properties: CONTACT_PROPERTIES,
              propertiesWithHistory: [],
            }),
          });
        } catch (e) {
          // 207 multi-status: HubSpot still returns 200 with partial results normally.
          // If fetch errors entirely, log and skip this chunk (drop ids to avoid stall).
          console.error('[backfill] fetch chunk fail:', e);
          failed++;
          missingIds = missingIds.slice(chunk.length);
          fetchBatches++;
          continue;
        }
        const results: any[] = resp?.results || [];
        const errors: any[] = resp?.errors || resp?.numErrors ? (resp?.errors || []) : [];
        fetchedFromHs += results.length;

        // Build owner rows and external_ids rows
        const ownerRows = results.map((c: any) => {
          const props = c.properties || {};
          const fn = String(props.firstname || '').trim();
          const ln = String(props.lastname || '').trim();
          const nombre = (`${fn} ${ln}`).trim() || (props.email || `Sin nombre (${c.id})`);
          // Map to valid owner_role enum: particular|heredero|inversor_pasivo|operador_profesional|institucional|desconocido
          const tipo = String(props.tipologia_de_propietario || '').toLowerCase();
          const rol = tipo.includes('inversor') ? 'inversor_pasivo'
            : tipo.includes('institucional') ? 'institucional'
            : tipo.includes('heredero') ? 'heredero'
            : tipo.includes('operador') ? 'operador_profesional'
            : (tipo.includes('propietario') || props.dni__nif__cif) ? 'particular'
            : 'desconocido';
          return {
            nombre,
            email: props.email || null,
            telefono: props.phone || null,
            rol,
            metadatos: { ...props, _hubspot_contact_id: c.id, archived: true, source: 'backfill' },
            last_synced_at: new Date().toISOString(),
            _hs_id: String(c.id),
          };
        });

        if (ownerRows.length > 0) {
          // Insert owners one-by-one (need IDs back). Use insert + select.
          for (const r of ownerRows) {
            const hsId = r._hs_id;
            delete (r as any)._hs_id;
            // Re-check existence (race / duplicate from previous run)
            const { data: existing } = await supabase
              .from('external_ids').select('entity_id')
              .eq('provider', 'hubspot').eq('provider_object_type', 'contact')
              .eq('provider_id', hsId).maybeSingle();
            if (existing?.entity_id) continue;

            const { data: ins, error: insErr } = await supabase
              .from('owners').insert(r).select('id').single();
            if (insErr || !ins) {
              console.error('[backfill] owner insert fail', hsId, insErr?.message);
              failed++;
              continue;
            }
            const { error: extErr } = await supabase.from('external_ids').insert({
              entity_type: 'owner',
              entity_id: ins.id,
              provider: 'hubspot',
              provider_object_type: 'contact',
              provider_id: hsId,
              metadatos: { hs_object_id: hsId, source: 'backfill', archived: true },
            });
            if (extErr) {
              console.error('[backfill] external_ids insert fail', hsId, extErr.message);
              // delete orphan owner to keep idempotent
              await supabase.from('owners').delete().eq('id', ins.id);
              failed++;
              continue;
            }
            inserted++;
            totalSynced++;
          }
        }

        // Drop processed chunk from missingIds (whether fetched or not — errors-as-not-found
        // means HubSpot doesn't have them either)
        missingIds = missingIds.slice(chunk.length);
        fetchBatches++;

        // persist every 5 batches
        if (fetchBatches % 5 === 0) {
          await supabase.from('hubspot_sync_state').update({
            metadatos: { phase, deal_cursor: dealCursor, missing_ids: missingIds },
            total_synced: totalSynced,
          }).eq('entity', 'backfill_contacts');
        }
      }

      if (missingIds.length === 0) phase = 'done';
    }

    const finalStatus = phase === 'done' ? 'ok' : 'running';
    await supabase.from('hubspot_sync_state').update({
      metadatos: { phase, deal_cursor: dealCursor, missing_ids: missingIds },
      total_synced: totalSynced,
      last_run_status: finalStatus,
      last_run_at: new Date().toISOString(),
    }).eq('entity', 'backfill_contacts');

    return new Response(JSON.stringify({
      ok: true,
      phase,
      done: phase === 'done',
      assoc_batches_run: assocBatchesRun,
      pairs_seen: pairsSeen,
      missing_remaining: missingIds.length,
      fetched_from_hs: fetchedFromHs,
      inserted_owners: inserted,
      failed,
      total_synced: totalSynced,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[backfill_archived_contacts] error:', msg);
    await supabase.from('hubspot_sync_state').update({
      metadatos: { phase, deal_cursor: dealCursor, missing_ids: missingIds },
      total_synced: totalSynced,
      last_run_status: 'error',
      last_error: msg,
      last_run_at: new Date().toISOString(),
    }).eq('entity', 'backfill_contacts');
    return new Response(JSON.stringify({ ok: false, error: msg, phase, inserted, total_synced: totalSynced }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});