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

function normPhone(p: string | null | undefined): string | null {
  if (!p) return null;
  const d = String(p).replace(/\D+/g, '');
  if (d.length < 9) return null;
  return d.slice(-9);
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
  const viaCounts = { contact: 0, deal: 0, tel: 0 };

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
        .select('hs_id, hs_call_body, hs_call_title, hs_call_direction, hs_call_duration, hs_call_recording_url, hs_timestamp, associated_contact_ids, associated_deal_ids, hs_call_to_number, hs_call_from_number')
        .order('hs_id', { ascending: true })
        .limit(BATCH);
      if (cursor) q = q.gt('hs_id', cursor);
      const { data: rows, error } = await q;
      if (error) throw error;
      if (!rows || rows.length === 0) break;

      // collect contact ids needed
      const cIds = new Set<string>();
      const dIds = new Set<string>();
      for (const r of rows) {
        for (const id of (r.associated_contact_ids || [])) cIds.add(String(id));
        for (const id of (r.associated_deal_ids || [])) dIds.add(String(id));
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

      // deal_id (HS) -> building_id (local)
      const dealBuilding = new Map<string, string>();
      if (dIds.size) {
        const arr = Array.from(dIds);
        for (let k = 0; k < arr.length; k += 500) {
          const chunk = arr.slice(k, k + 500);
          const { data: ds } = await supabase
            .from('external_ids').select('entity_id, provider_id')
            .eq('provider', 'hubspot').eq('entity_type', 'building')
            .eq('provider_object_type', 'deal')
            .in('provider_id', chunk);
          (ds || []).forEach((d) => dealBuilding.set(d.provider_id, d.entity_id));
        }
      }
      // building_id -> owner principal
      const buildingOwner = new Map<string, string>();
      const buildingIds = Array.from(new Set(Array.from(dealBuilding.values())));
      if (buildingIds.length) {
        const { data: bos } = await supabase
          .from('building_owners')
          .select('building_id, owner_id, influencer_score, cuota')
          .in('building_id', buildingIds);
        const grp = new Map<string, any[]>();
        for (const r of (bos || [])) {
          const arr = grp.get(r.building_id) || [];
          arr.push(r); grp.set(r.building_id, arr);
        }
        for (const [bid, list] of grp) {
          list.sort((a, b) =>
            (Number(b.influencer_score ?? -1) - Number(a.influencer_score ?? -1)) ||
            (Number(b.cuota ?? -1) - Number(a.cuota ?? -1))
          );
          buildingOwner.set(bid, list[0].owner_id);
        }
      }
      // phone lookup: build only for rows that need it
      const phones = new Set<string>();
      for (const r of rows) {
        if (existing.has(r.hs_id)) continue;
        const firstContact = (r.associated_contact_ids || [])[0];
        if (firstContact && cmap.get(String(firstContact))) continue;
        const p1 = normPhone(r.hs_call_to_number);
        const p2 = normPhone(r.hs_call_from_number);
        if (p1) phones.add(p1);
        if (p2) phones.add(p2);
      }
      const phoneOwner = new Map<string, string>();
      if (phones.size) {
        // Cargar todos los owners con telefono en una sola pasada paginada, normalizar y mapear.
        const PAGE = 1000;
        const all = new Map<string, string[]>(); // last9 -> owner_ids[]
        let from = 0;
        while (true) {
          const { data: os, error } = await supabase
            .from('owners').select('id, telefono')
            .not('telefono', 'is', null)
            .range(from, from + PAGE - 1);
          if (error) break;
          if (!os || os.length === 0) break;
          for (const o of os) {
            const n = normPhone(o.telefono);
            if (!n) continue;
            const arr = all.get(n) || [];
            arr.push(o.id); all.set(n, arr);
          }
          if (os.length < PAGE) break;
          from += PAGE;
        }
        for (const p of phones) {
          const ids = all.get(p);
          if (ids && ids.length === 1) phoneOwner.set(p, ids[0]);
        }
      }

      const inserts: any[] = [];
      for (const r of rows) {
        if (existing.has(r.hs_id)) { skippedExisting++; continue; }
        let ownerId: string | undefined;
        let via: 'contact' | 'deal' | 'tel' | undefined;
        // (1) contact direct
        for (const cid of (r.associated_contact_ids || [])) {
          const oid = cmap.get(String(cid));
          if (oid) { ownerId = oid; via = 'contact'; break; }
        }
        // (2) deal → building → owner principal
        if (!ownerId) {
          for (const did of (r.associated_deal_ids || [])) {
            const bid = dealBuilding.get(String(did));
            const oid = bid ? buildingOwner.get(bid) : undefined;
            if (oid) { ownerId = oid; via = 'deal'; break; }
          }
        }
        // (3) phone
        if (!ownerId) {
          const p1 = normPhone(r.hs_call_to_number);
          const p2 = normPhone(r.hs_call_from_number);
          const oid = (p1 && phoneOwner.get(p1)) || (p2 && phoneOwner.get(p2));
          if (oid) { ownerId = oid; via = 'tel'; }
        }
        if (!ownerId || !via) { skippedNoOwner++; continue; }
        viaCounts[via]++;
        // Distinguir 0 (no contestada / buzón) de NULL (sin sincronizar): si HubSpot ya devolvió valor, lo reflejamos.
        const durSec = r.hs_call_duration == null ? null : Math.round((r.hs_call_duration || 0) / 1000);
        const titulo = (r.hs_call_title || '').trim();
        const body = (r.hs_call_body || '').trim();
        const viaTag = via === 'contact' ? '' : `[via:${via}]`;
        const resumen = `[hs:${r.hs_id}]${viaTag}${titulo ? ' ' + titulo : ''}`.slice(0, 4000);
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
      ok: true, promoted, skipped_no_owner: skippedNoOwner, skipped_existing: skippedExisting, failed, via: viaCounts,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ ok: false, error: msg, promoted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});