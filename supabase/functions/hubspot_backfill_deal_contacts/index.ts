// hubspot_backfill_deal_contacts — recorre TODOS los edificios del universo con negocio en
// HubSpot, relee las asociaciones deal→contacts, refresca las propiedades del contacto
// (incluido porcentaje_de_participacion) y garantiza la fila en building_owners.
// Al final intenta enlazar los titulares de la nota con los contactos ya existentes.
// Idempotente: puede ejecutarse tantas veces como haga falta.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders, CONTACT_PROPERTIES } from '../_shared/hubspot.ts';

const BATCH = 100;

function rolFromTipologia(tipo: string): string {
  const t = (tipo || '').toLowerCase();
  if (t.includes('inversor')) return 'inversor_pasivo';
  if (t.includes('operador') || t.includes('profesional')) return 'operador_profesional';
  if (t.includes('institucional')) return 'institucional';
  if (t.includes('heredero')) return 'heredero';
  if (t.includes('propietario')) return 'particular';
  return 'desconocido';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* sin cuerpo */ }
  const maxBuildings = Math.min(Number(body.max_buildings ?? 400), 2000);
  const after = typeof body.after === 'string' ? body.after : null;
  const buildingId = typeof body.building_id === 'string' ? body.building_id : null;

  const stats = {
    edificios: 0, pares: 0, owners_creados: 0, owners_actualizados: 0,
    vinculos_creados: 0, fallos: 0, cursor: null as string | null,
    enlazados_nota: 0, dudosos_nota: 0,
  };

  try {
    let q = supabase
      .from('buildings')
      .select('id, hs_deal_id')
      .not('hs_deal_id', 'is', null)
      .order('hs_deal_id', { ascending: true })
      .limit(maxBuildings);
    if (buildingId) q = q.eq('id', buildingId);
    else if (after) q = q.gt('hs_deal_id', after);
    const { data: buildings, error: bErr } = await q;
    if (bErr) throw bErr;
    if (!buildings || buildings.length === 0) {
      return new Response(JSON.stringify({ ok: true, done: true, ...stats }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    stats.edificios = buildings.length;
    stats.cursor = buildings[buildings.length - 1].hs_deal_id as string;

    const dealToBuilding = new Map<string, string>();
    buildings.forEach((b) => dealToBuilding.set(String(b.hs_deal_id), b.id as string));

    const dealIds = Array.from(dealToBuilding.keys());
    for (let i = 0; i < dealIds.length; i += BATCH) {
      const slice = dealIds.slice(i, i + BATCH);
      let assoc: Record<string, unknown> | null = null;
      try {
        assoc = await hubspotFetch('/crm/v4/associations/deals/contacts/batch/read', {
          method: 'POST',
          body: JSON.stringify({ inputs: slice.map((id) => ({ id })) }),
        });
      } catch (e) {
        stats.fallos++;
        console.error('[backfill] asociaciones:', e);
        continue;
      }
      const results = (assoc?.results as any[]) || [];

      // 1) refrescar hubspot_deals.associated_contact_ids
      const dealContacts = new Map<string, string[]>();
      const contactIds = new Set<string>();
      for (const r of results) {
        const did = String(r?.from?.id || '');
        const cs = (r?.to || []).map((t: any) => String(t.toObjectId)).filter(Boolean);
        if (!did) continue;
        dealContacts.set(did, cs);
        cs.forEach((c: string) => contactIds.add(c));
      }
      for (const [did, cs] of dealContacts) {
        await supabase.from('hubspot_deals')
          .update({ associated_contact_ids: cs, updated_at: new Date().toISOString() })
          .eq('hs_id', did);
      }

      if (contactIds.size === 0) continue;

      // 2) resolver contactos existentes
      const ids = Array.from(contactIds);
      const contactToOwner = new Map<string, string>();
      for (let k = 0; k < ids.length; k += 500) {
        const chunk = ids.slice(k, k + 500);
        const { data: ex } = await supabase
          .from('external_ids')
          .select('entity_id, provider_id')
          .eq('provider', 'hubspot')
          .eq('provider_object_type', 'contact')
          .in('provider_id', chunk);
        (ex || []).forEach((e) => contactToOwner.set(e.provider_id, e.entity_id));
      }

      // 3) leer propiedades de TODOS los contactos (crea los que falten, refresca los demás)
      for (let k = 0; k < ids.length; k += 100) {
        const chunk = ids.slice(k, k + 100);
        let resp: Record<string, unknown> | null = null;
        try {
          resp = await hubspotFetch('/crm/v3/objects/contacts/batch/read?archived=false', {
            method: 'POST',
            body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: CONTACT_PROPERTIES }),
          });
        } catch (e) {
          stats.fallos++;
          console.error('[backfill] contactos:', e);
          continue;
        }
        for (const c of ((resp?.results as any[]) || [])) {
          const props = c.properties || {};
          const nombre = `${(props.firstname || '').trim()} ${(props.lastname || '').trim()}`.trim()
            || props.email || 'Sin nombre';
          const existing = contactToOwner.get(String(c.id));
          if (existing) {
            const { data: prev } = await supabase.from('owners')
              .select('metadatos').eq('id', existing).maybeSingle();
            const meta = { ...((prev?.metadatos as Record<string, unknown>) || {}), ...props, _hubspot_contact_id: c.id };
            const { error } = await supabase.from('owners').update({
              metadatos: meta,
              email: props.email || null,
              telefono: props.phone || props.mobilephone || null,
              last_synced_at: new Date().toISOString(),
            }).eq('id', existing);
            if (error) stats.fallos++; else stats.owners_actualizados++;
            continue;
          }
          const { data: ins, error: insErr } = await supabase.from('owners').insert({
            nombre,
            email: props.email || null,
            telefono: props.phone || props.mobilephone || null,
            rol: rolFromTipologia(props.tipologia_de_propietario || ''),
            metadatos: { ...props, _hubspot_contact_id: c.id, source: 'deal_contacts_backfill' },
            last_synced_at: new Date().toISOString(),
          }).select('id').single();
          if (insErr || !ins) { stats.fallos++; continue; }
          const { error: extErr } = await supabase.from('external_ids').insert({
            entity_type: 'owner', entity_id: ins.id,
            provider: 'hubspot', provider_object_type: 'contact', provider_id: String(c.id),
            metadatos: { hs_object_id: c.id, source: 'deal_contacts_backfill' },
          });
          if (extErr) {
            const { data: w } = await supabase.from('external_ids')
              .select('entity_id').eq('provider', 'hubspot')
              .eq('provider_object_type', 'contact').eq('provider_id', String(c.id)).maybeSingle();
            await supabase.from('owners').delete().eq('id', ins.id);
            if (w?.entity_id) contactToOwner.set(String(c.id), w.entity_id);
            continue;
          }
          contactToOwner.set(String(c.id), ins.id);
          stats.owners_creados++;
        }
      }

      // 4) garantizar building_owners
      const rows: Record<string, unknown>[] = [];
      for (const [did, cs] of dealContacts) {
        const bId = dealToBuilding.get(did);
        if (!bId) continue;
        for (const cid of cs) {
          stats.pares++;
          const ownerId = contactToOwner.get(cid);
          if (!ownerId) continue;
          rows.push({
            building_id: bId,
            owner_id: ownerId,
            metadatos: { source: 'deal_contacts_backfill', hs_deal_id: did, hs_contact_id: cid },
          });
        }
      }
      if (rows.length > 0) {
        const seen = new Set<string>();
        const dedup = rows.filter((r) => {
          const k = `${r.building_id}|${r.owner_id}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        const { error: upErr } = await supabase.from('building_owners')
          .upsert(dedup, { onConflict: 'building_id,owner_id', ignoreDuplicates: true });
        if (!upErr) {
          stats.vinculos_creados += dedup.length;
        } else {
          // Puede fallar el lote entero por un duplicado de nombre normalizado:
          // reintentar fila a fila e ignorar solo los duplicados.
          for (const row of dedup) {
            const { error: rowErr } = await supabase.from('building_owners')
              .upsert(row, { onConflict: 'building_id,owner_id', ignoreDuplicates: true });
            if (!rowErr) stats.vinculos_creados++;
            else if (rowErr.code !== '23505') {
              stats.fallos++;
              console.error('[backfill] building_owners:', rowErr);
            }
          }
        }
      }
    }

    // 5) cerrar el circuito: enlazar titulares de la nota con contactos ya existentes
    const { data: enlace, error: rpcErr } = await supabase.rpc('enlazar_titulares_con_contactos', {
      p_building_id: buildingId,
      p_limit: 5000,
      p_dry_run: false,
    });
    if (rpcErr) console.error('[backfill] enlace titulares:', rpcErr);
    else if (enlace) {
      stats.enlazados_nota = Number((enlace as Record<string, unknown>).enlazados ?? 0);
      stats.dudosos_nota = Number((enlace as Record<string, unknown>).dudosos ?? 0);
    }

    return new Response(JSON.stringify({ ok: true, done: buildings.length < maxBuildings, ...stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('[backfill] error:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e), ...stats }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
