// hubspot_sync_contact_companies — batch read contact->company associations
// Persist into owners.metadatos.associated_company_ids (array) and external_ids
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const BATCH = 100;
const MAX_BATCHES_PER_RUN = 30; // ~3000 contacts per invocation

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch {}
  const reset = !!body?.reset;

  // Cursor: numeric offset over external_ids contacts ordered by id
  await supabase.from('hubspot_sync_state').upsert(
    { entity: 'contact_companies', last_run_status: 'running', last_run_at: new Date().toISOString() },
    { onConflict: 'entity' },
  );

  const { data: state } = await supabase
    .from('hubspot_sync_state').select('cursor').eq('entity', 'contact_companies').single();
  let offset = reset ? 0 : parseInt(state?.cursor || '0', 10);

  let processed = 0;
  let withCompany = 0;
  let updated = 0;
  let extInserted = 0;
  let batches = 0;

  try {
    for (let b = 0; b < MAX_BATCHES_PER_RUN; b++) {
      const { data: rows, error } = await supabase
        .from('external_ids')
        .select('entity_id, provider_id')
        .eq('provider', 'hubspot')
        .eq('provider_object_type', 'contact')
        .order('id')
        .range(offset, offset + BATCH - 1);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      batches++;

      const inputs = rows.map((r) => ({ id: r.provider_id }));
      let res: any;
      try {
        res = await hubspotFetch('/crm/v4/associations/contact/company/batch/read', {
          method: 'POST',
          body: JSON.stringify({ inputs }),
        });
      } catch (e) {
        console.error(`[contact_companies] batch fail offset=${offset}:`, e);
        offset += rows.length;
        continue;
      }

      const results = res?.results || [];
      const byContact: Record<string, string[]> = {};
      for (const r of results) {
        const cid = r?.from?.id;
        const tos: string[] = (r?.to || []).map((t: any) => t.toObjectId?.toString() || t.id).filter(Boolean);
        if (cid && tos.length) byContact[cid] = tos;
      }

      for (const row of rows) {
        processed++;
        const companyIds = byContact[row.provider_id];
        if (!companyIds || companyIds.length === 0) continue;
        withCompany++;

        // fetch current metadatos
        const { data: ownerRow } = await supabase
          .from('owners').select('metadatos').eq('id', row.entity_id).maybeSingle();
        const meta = (ownerRow?.metadatos as any) || {};
        meta.associated_company_ids = companyIds;
        if (!meta.associatedcompanyid) meta.associatedcompanyid = companyIds[0];
        const { error: upErr } = await supabase
          .from('owners').update({ metadatos: meta }).eq('id', row.entity_id);
        if (!upErr) updated++;

        // external_ids: contact->company link rows
        for (const cid of companyIds) {
          const { data: ext } = await supabase.from('external_ids').select('id')
            .eq('provider', 'hubspot').eq('provider_object_type', 'contact_company')
            .eq('provider_id', `${row.provider_id}:${cid}`).maybeSingle();
          if (!ext) {
            const { error: insErr } = await supabase.from('external_ids').insert({
              entity_type: 'owner', entity_id: row.entity_id,
              provider: 'hubspot', provider_object_type: 'contact_company',
              provider_id: `${row.provider_id}:${cid}`,
              metadatos: { contact_id: row.provider_id, company_id: cid },
            });
            if (!insErr) extInserted++;
          }
        }
      }

      offset += rows.length;
      await supabase.from('hubspot_sync_state').update({ cursor: String(offset) })
        .eq('entity', 'contact_companies');
      if (rows.length < BATCH) { offset = -1; break; }
    }

    const done = offset === -1;
    if (done) {
      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'ok', last_run_at: new Date().toISOString(),
        last_full_sync_at: new Date().toISOString(), cursor: null,
      }).eq('entity', 'contact_companies');
    } else {
      await supabase.from('hubspot_sync_state').update({
        last_run_status: 'ok', last_run_at: new Date().toISOString(),
      }).eq('entity', 'contact_companies');
    }

    return new Response(JSON.stringify({
      ok: true, batches, processed, with_company: withCompany,
      owners_updated: updated, external_ids_inserted: extInserted,
      done, next_offset: done ? null : offset,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[contact_companies] error:', msg);
    await supabase.from('hubspot_sync_state').update({
      last_run_status: 'error', last_error: msg,
    }).eq('entity', 'contact_companies');
    return new Response(JSON.stringify({ ok: false, error: msg, processed }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});