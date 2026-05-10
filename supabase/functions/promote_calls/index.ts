// promote_calls — promueve filas de hubspot_calls a la tabla operativa public.calls.
// Mapea owner_id desde el primer associated_contact_ids con external_id presente.
// Idempotente: usa metadatos.hs_call_id para detectar ya promovidas
// (calls no tiene columna metadatos, por lo que se marca el hs_id en resumen prefix).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { corsHeaders } from '../_shared/hubspot.ts';

const BATCH = 1000;
const MAX_BATCHES = 10;

function dirOf(d: string | null): 'entrante' | 'saliente' {
  if (!d) return 'saliente';
  const s = d.toLowerCase();
  if (s.includes('inbound') || s.includes('incoming') || s.includes('entr')) return 'entrante';
  return 'saliente';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let promoted = 0;
  let skippedNoOwner = 0;
  let skippedExisting = 0;
  let failed = 0;

  try {
    // existing promoted hs_ids: stored in calls.transcripcion_url? We use a dedicated marker:
    // we store hs_call_id at the start of resumen as `[hs:<id>]` to allow idempotency without a column.
    const existing = new Set<string>();
    {
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data: rows, error } = await supabase
          .from('calls')
          .select('resumen')
          .ilike('resumen', '[hs:%')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!rows || rows.length === 0) break;
        for (const r of rows) {
          const m = (r.resumen || '').match(/^\[hs:([^\]]+)\]/);
          if (m) existing.add(m[1]);
        }
        if (rows.length < PAGE) break;
        from += PAGE;
      }
    }

    let cursor: string | null = null;
    for (let b = 0; b < MAX_BATCHES; b++) {
      let q = supabase
        .from('hubspot_calls')
        .select('hs_id, hs_call_body, hs_call_title, hs_call_direction, hs_call_duration, hs_call_recording_url, hs_timestamp, associated_contact_ids')
        .order('hs_id', { ascending: true })
        .limit(BATCH);
      if (cursor) q = q.gt('hs_id', cursor);
      const { data: rows, error } = await q;
      if (error) throw error;
      if (!rows || rows.length === 0) break;

      // collect contact ids needed
      const cIds = new Set<string>();
      for (const r of rows) {
        const arr = r.associated_contact_ids || [];
        if (arr.length > 0) cIds.add(String(arr[0]));
      }
      const cmap = new Map<string, string>();
      if (cIds.size) {
        const arr = Array.from(cIds);
        for (let k = 0; k < arr.length; k += 500) {
          const chunk = arr.slice(k, k + 500);
          const { data: cs } = await supabase
            .from('external_ids').select('entity_id, provider_id')
            .eq('provider', 'hubspot').eq('provider_object_type', 'contact')
            .in('provider_id', chunk);
          (cs || []).forEach((c) => cmap.set(c.provider_id, c.entity_id));
        }
      }

      const inserts: any[] = [];
      for (const r of rows) {
        if (existing.has(r.hs_id)) { skippedExisting++; continue; }
        const firstContact = (r.associated_contact_ids || [])[0];
        const ownerId = firstContact ? cmap.get(String(firstContact)) : null;
        if (!ownerId) { skippedNoOwner++; continue; }
        const durSec = r.hs_call_duration ? Math.round(r.hs_call_duration / 1000) : null;
        const titulo = (r.hs_call_title || '').trim();
        const body = (r.hs_call_body || '').trim();
        const resumen = `[hs:${r.hs_id}]${titulo ? ' ' + titulo : ''}`.slice(0, 4000);
        inserts.push({
          owner_id: ownerId,
          direccion: dirOf(r.hs_call_direction),
          duracion_seg: durSec,
          transcripcion: body || null,
          transcripcion_url: r.hs_call_recording_url || null,
          fecha: r.hs_timestamp || new Date().toISOString(),
          resumen,
        });
      }

      if (inserts.length) {
        const { error: insErr } = await supabase.from('calls').insert(inserts);
        if (insErr) { failed += inserts.length; console.error('[promote_calls] insert', insErr); }
        else promoted += inserts.length;
      }

      cursor = rows[rows.length - 1].hs_id;
      if (rows.length < BATCH) break;
    }

    return new Response(JSON.stringify({
      ok: true, promoted, skipped_no_owner: skippedNoOwner, skipped_existing: skippedExisting, failed,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ ok: false, error: msg, promoted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});