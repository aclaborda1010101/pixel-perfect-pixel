// hubspot_backfill_call_summaries — rellena hubspot_calls.hs_call_summary con el
// resumen IA que HubSpot ya genera. Idempotente: solo procesa calls con
// hs_call_summary NULL/''. Batch read (hasta 100 IDs por request).
// Body: { limit?: number (default 300), chain?: boolean }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const DEFAULT_LIMIT = 300;
const HS_BATCH = 100; // límite HubSpot batch read

async function readBatch(ids: string[]): Promise<any[]> {
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += HS_BATCH) {
    const slice = ids.slice(i, i + HS_BATCH);
    const resp = await hubspotFetch('/crm/v3/objects/calls/batch/read', {
      method: 'POST',
      body: JSON.stringify({
        properties: ['hs_call_summary'],
        inputs: slice.map((id) => ({ id })),
      }),
    });
    rows.push(...(resp?.results || []));
  }
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const t0 = Date.now();
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = Math.min(Math.max(Number(body.limit ?? DEFAULT_LIMIT), 1), 1000);
  const chain: boolean = body.chain !== false;

  // Cola: llamadas NO comprobadas todavía (hs_call_summary IS NULL).
  // Las llamadas ya comprobadas sin resumen se marcan con '' para no reintentar.
  const { data: rows, error } = await supabase
    .from('hubspot_calls')
    .select('hs_id')
    .is('hs_call_summary', null)
    .order('hs_timestamp', { ascending: false })
    .limit(limit);
  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const ids = (rows || []).map((r: any) => String(r.hs_id)).filter(Boolean);
  if (!ids.length) {
    return new Response(JSON.stringify({ ok: true, accepted: 0, pending: 0, done: true }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  let fetched = 0, updated = 0, empty = 0;
  let errorMsg: string | null = null;
  try {
    const results = await readBatch(ids);
    fetched = results.length;
    // Update en lotes por hs_id
    // Recogemos ids devueltos para marcar los vacíos en bulk
    const emptyIds: string[] = [];
    for (const r of results) {
      const hsId = String(r.id);
      const summary = String(r?.properties?.hs_call_summary ?? '').trim();
      if (!summary) { empty++; emptyIds.push(hsId); continue; }
      const { error: upErr } = await supabase.from('hubspot_calls')
        .update({ hs_call_summary: summary })
        .eq('hs_id', hsId);
      if (!upErr) updated++;
    }
    // Marcar como "comprobados sin resumen" para no volver a pedirlos
    if (emptyIds.length) {
      // Chunkear el UPDATE .in() para no exceder tamaño de query
      for (let i = 0; i < emptyIds.length; i += 200) {
        const slice = emptyIds.slice(i, i + 200);
        await supabase.from('hubspot_calls').update({ hs_call_summary: '' }).in('hs_id', slice);
      }
    }
    // Cubre también los IDs pedidos que HubSpot no devolvió (borrados, sin permiso, etc.)
    const returned = new Set(results.map((r: any) => String(r.id)));
    const missing = ids.filter((id) => !returned.has(id));
    for (let i = 0; i < missing.length; i += 200) {
      const slice = missing.slice(i, i + 200);
      await supabase.from('hubspot_calls').update({ hs_call_summary: '' }).in('hs_id', slice);
    }
  } catch (e: any) {
    errorMsg = String(e?.message || e).slice(0, 500);
  }

  // Pendientes: nunca comprobados (NULL). Los '' ya se comprobaron y no se reintenta.
  const { count } = await supabase.from('hubspot_calls')
    .select('hs_id', { count: 'exact', head: true })
    .is('hs_call_summary', null);
  const pending = count || 0;
  const elapsed = Date.now() - t0;
  console.log(`[hubspot_backfill_call_summaries] fetched=${fetched} updated=${updated} empty=${empty} pending=${pending} elapsed_ms=${elapsed} err=${errorMsg ?? '-'}`);

  await supabase.from('hubspot_sync_state').upsert({
    entity: 'call_summary_backfill',
    last_run_at: new Date().toISOString(),
    last_run_status: pending > 0 && !errorMsg ? 'continuing' : (errorMsg ? 'error' : 'done'),
    total_synced: updated,
    cursor: null,
    metadatos: { fetched, updated, empty, pending, elapsed_ms: elapsed, error: errorMsg },
  }, { onConflict: 'entity' });

  if (chain && !errorMsg && pending > 0 && ids.length >= limit) {
    const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/hubspot_backfill_call_summaries`;
    const chainFetch = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` },
      body: JSON.stringify({ limit, chain: true }),
    }).catch((e) => console.error('chain fail', e));
    // Mantener vivo el worker hasta despachar la llamada encadenada
    // @ts-ignore EdgeRuntime
    try { EdgeRuntime.waitUntil(chainFetch); } catch { /* ok */ }
  }

  return new Response(JSON.stringify({
    ok: !errorMsg, accepted: ids.length, fetched, updated, empty, pending, elapsed_ms: elapsed, error: errorMsg,
  }, null, 2), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});