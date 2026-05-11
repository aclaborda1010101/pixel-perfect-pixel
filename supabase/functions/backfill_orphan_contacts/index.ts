// backfill_orphan_contacts — recupera contacts huérfanos (referenciados desde
// calls/notes/whatsapp pero sin external_ids) con ≥ min_refs referencias.
// Lee de HubSpot con archived=false (los archived ya están cubiertos por backfill_archived_contacts).
// Idempotente: si ya existe external_ids, skip. Auto-chain hasta drenar.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders, CONTACT_PROPERTIES } from '../_shared/hubspot.ts';

const BATCH_READ_SIZE = 100;
const MAX_BATCHES_PER_RUN = 8; // 800 contacts por invocación

function mapRol(p: Record<string, any>): string {
  const t = String(p.tipologia_de_propietario || '').toLowerCase();
  if (t.includes('inversor')) return 'inversor_pasivo';
  if (t.includes('operador') || t.includes('profesional')) return 'operador_profesional';
  if (t.includes('institucional')) return 'institucional';
  if (t.includes('heredero')) return 'heredero';
  if (t.includes('propietario') || p.dni__nif__cif) return 'particular';
  return 'desconocido';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.clone().json(); } catch { /* ignore */ }
  const minRefs: number = Number(body?.min_refs ?? 5);
  const autoChain = !!body?.chain;

  const { data: logRow } = await supabase
    .from('hubspot_sync_log')
    .insert({ entity: 'backfill_orphan_contacts', status: 'running' })
    .select('id').single();
  const logId = logRow?.id;

  let fetched = 0;
  let created = 0;
  let skipped = 0;
  let failed = 0;
  let orphanTotal = 0;
  let pending = 0;

  try {
    // 1) Construir lista de hs_contact_id huérfanos con refs >= minRefs
    //    Fuentes: hubspot_calls, hubspot_notes, hubspot_whatsapp, hubspot_communications, hubspot_tasks
    //    contra external_ids(provider=hubspot, provider_object_type=contact)
    const sql = `
      WITH refs AS (
        SELECT cid FROM (
          SELECT unnest(associated_contact_ids) cid FROM public.hubspot_calls
          UNION ALL SELECT unnest(associated_contact_ids) FROM public.hubspot_notes
          UNION ALL SELECT unnest(associated_contact_ids) FROM public.hubspot_whatsapp
          UNION ALL SELECT unnest(associated_contact_ids) FROM public.hubspot_communications
          UNION ALL SELECT unnest(associated_contact_ids) FROM public.hubspot_tasks
        ) x WHERE cid IS NOT NULL AND cid <> ''
      ),
      grouped AS (
        SELECT cid, COUNT(*)::int AS n FROM refs GROUP BY cid
      )
      SELECT g.cid, g.n
      FROM grouped g
      LEFT JOIN public.external_ids ei
        ON ei.provider='hubspot' AND ei.provider_object_type='contact' AND ei.provider_id = g.cid
      WHERE ei.id IS NULL AND g.n >= ${minRefs}
      ORDER BY g.n DESC
      LIMIT ${BATCH_READ_SIZE * MAX_BATCHES_PER_RUN}
    `;
    // No hay execute_sql disponible: emulamos con queries combinadas en JS
    // En su lugar, hacemos el cálculo en pasos client-side usando RPC simple:
    // Como no podemos ejecutar SQL raw, hacemos la búsqueda con varios fetches y construimos counts.

    // Estrategia: agregar arrays de cada tabla limitando filas no nulas.
    const refMap = new Map<string, number>();
    const tables = [
      { t: 'hubspot_calls', col: 'associated_contact_ids' },
      { t: 'hubspot_notes', col: 'associated_contact_ids' },
      { t: 'hubspot_whatsapp', col: 'associated_contact_ids' },
      { t: 'hubspot_communications', col: 'associated_contact_ids' },
      { t: 'hubspot_tasks', col: 'associated_contact_ids' },
    ];
    for (const { t, col } of tables) {
      let from = 0;
      const pageSize = 1000;
      while (true) {
        const { data, error } = await supabase
          .from(t).select(col).range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        for (const row of data) {
          const arr: string[] = (row as any)[col] || [];
          for (const id of arr) {
            if (!id) continue;
            refMap.set(id, (refMap.get(id) || 0) + 1);
          }
        }
        if (data.length < pageSize) break;
        from += pageSize;
      }
    }

    // Filtrar los que ya están en external_ids (en chunks)
    const allIds = Array.from(refMap.entries())
      .filter(([_, n]) => n >= minRefs)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    orphanTotal = allIds.length;

    const existingSet = new Set<string>();
    for (let i = 0; i < allIds.length; i += 1000) {
      const chunk = allIds.slice(i, i + 1000);
      const { data } = await supabase.from('external_ids')
        .select('provider_id')
        .eq('provider', 'hubspot')
        .eq('provider_object_type', 'contact')
        .in('provider_id', chunk);
      (data || []).forEach((r: any) => existingSet.add(r.provider_id));
    }
    const orphans = allIds.filter((id) => !existingSet.has(id));
    pending = orphans.length;

    const slice = orphans.slice(0, BATCH_READ_SIZE * MAX_BATCHES_PER_RUN);

    for (let i = 0; i < slice.length; i += BATCH_READ_SIZE) {
      const chunk = slice.slice(i, i + BATCH_READ_SIZE);
      try {
        const resp = await hubspotFetch('/crm/v3/objects/contacts/batch/read?archived=false', {
          method: 'POST',
          body: JSON.stringify({
            inputs: chunk.map((id) => ({ id })),
            properties: CONTACT_PROPERTIES,
            propertiesWithHistory: [],
          }),
        });
        const results = resp?.results || [];
        fetched += results.length;
        for (const c of results) {
          const props = c.properties || {};
          const fn = String(props.firstname || '').trim();
          const ln = String(props.lastname || '').trim();
          const nombre = `${fn} ${ln}`.trim() || props.email || 'Sin nombre';
          const rol = mapRol(props);
          try {
            const { data: ins, error: insErr } = await supabase.from('owners').insert({
              nombre,
              email: props.email || null,
              telefono: props.phone || null,
              rol,
              metadatos: { ...props, _hubspot_contact_id: c.id, source: 'backfill_orphan' },
              last_synced_at: new Date().toISOString(),
            }).select('id').single();
            if (insErr || !ins) { failed++; continue; }
            const ownerId = ins.id;
            const { error: extErr } = await supabase.from('external_ids').insert({
              entity_type: 'owner', entity_id: ownerId,
              provider: 'hubspot', provider_object_type: 'contact', provider_id: String(c.id),
              metadatos: { hs_object_id: c.id, source: 'backfill_orphan' },
            });
            if (extErr) {
              // race condition
              await supabase.from('owners').delete().eq('id', ownerId);
              skipped++;
            } else {
              created++;
            }
          } catch (e) {
            console.error('[backfill_orphan] insert fail:', e);
            failed++;
          }
        }
      } catch (e) {
        console.error('[backfill_orphan] batch_read fail:', e);
        failed++;
      }
    }

    const finishedAt = new Date().toISOString();
    await supabase.from('hubspot_sync_log').update({
      finished_at: finishedAt,
      status: 'ok',
      pages_fetched: Math.ceil(slice.length / BATCH_READ_SIZE),
      records_upserted: created,
      records_failed: failed,
      metadatos: { fetched, skipped, orphan_total: orphanTotal, pending_after: pending - slice.length },
    }).eq('id', logId);

    const remaining = pending - slice.length;
    if (autoChain && remaining > 0) {
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/backfill_orphan_contacts`;
      const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
      // @ts-ignore
      (globalThis as any).EdgeRuntime?.waitUntil(
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anon}` },
          body: JSON.stringify({ chain: true, min_refs: minRefs }),
        }).catch((e) => console.error('[backfill_orphan] chain fail:', e)),
      );
    }

    return new Response(JSON.stringify({
      ok: true,
      orphan_total: orphanTotal,
      pending_before: pending,
      processed: slice.length,
      fetched, created, skipped, failed,
      remaining,
      chained: autoChain && remaining > 0,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    const msg = String(e?.message || e);
    console.error('[backfill_orphan_contacts] error:', msg);
    await supabase.from('hubspot_sync_log').update({
      finished_at: new Date().toISOString(),
      status: 'error',
      records_upserted: created,
      records_failed: failed,
      error_message: msg,
    }).eq('id', logId);
    return new Response(JSON.stringify({ ok: false, error: msg, created, failed }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});