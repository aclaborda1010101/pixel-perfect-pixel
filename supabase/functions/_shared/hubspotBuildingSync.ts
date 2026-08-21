// Sincronización de UN edificio desde HubSpot hacia nuestra base.
// SOLO LECTURA sobre HubSpot: todas las llamadas al gateway son GET o
// batch/read. Nunca escribe en HubSpot.
// Reutiliza la misma lógica que el volcado masivo hubspot_backfill_deal_contacts.
import { hubspotFetch, CONTACT_PROPERTIES } from './hubspot.ts';
import { materializeHubspotConsent } from './ownerKnowledge.ts';

export const CALL_PROPERTIES = [
  'hs_call_title', 'hs_call_body', 'hs_call_summary', 'hs_call_status',
  'hs_call_direction', 'hs_call_disposition', 'hs_call_duration',
  'hs_call_recording_url', 'hs_call_to_number', 'hs_call_from_number',
  'hs_timestamp', 'hs_createdate', 'hs_lastmodifieddate', 'hubspot_owner_id',
];

export function rolFromTipologia(tipo: string): string {
  const t = (tipo || '').toLowerCase();
  if (t.includes('inversor')) return 'inversor_pasivo';
  if (t.includes('operador') || t.includes('profesional')) return 'operador_profesional';
  if (t.includes('institucional')) return 'institucional';
  if (t.includes('heredero')) return 'heredero';
  if (t.includes('propietario')) return 'particular';
  return 'desconocido';
}

function tsOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intOrNull(v: unknown): number | null {
  const n = parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

export interface SyncStats {
  contactos_hubspot: number;
  owners_creados: number;
  owners_actualizados: number;
  vinculos_creados: number;
  llamadas_sincronizadas: number;
  enlazados_nota: number;
  dudosos_nota: number;
  fallos: number;
}

/** Foto del estado del edificio ANTES/DESPUÉS, para poder contar lo que cambió. */
export interface Foto {
  propietarios: number;
  telefonos: number;
  llamadas: number;
  fuente_pct: string;
  suma_pct: number;
  reparto_completo: boolean;
}

/** IDs de contacto de HubSpot de los propietarios ligados al edificio. */
export async function contactosDelEdificio(supabase: any, buildingId: string): Promise<string[]> {
  const { data: bo } = await supabase
    .from('building_owners').select('owner_id').eq('building_id', buildingId);
  const ownerIds = ((bo ?? []) as any[]).map((r) => r.owner_id);
  if (ownerIds.length === 0) return [];
  const { data: ex } = await supabase
    .from('external_ids').select('provider_id')
    .eq('provider', 'hubspot').eq('provider_object_type', 'contact')
    .in('entity_id', ownerIds);
  return ((ex ?? []) as any[]).map((r) => String(r.provider_id));
}

export async function tomarFoto(supabase: any, buildingId: string): Promise<Foto> {
  const { data: filas } = await supabase
    .from('v_owner_score')
    .select('owner_id, telefono, pct_propiedad, pct_invalido, pct_fuente_edificio')
    .eq('building_id', buildingId);
  const rows = (filas ?? []) as any[];
  const suma = rows.reduce(
    (t, r) => t + (r.pct_propiedad != null && !r.pct_invalido ? Number(r.pct_propiedad) : 0),
    0,
  );
  const ids = await contactosDelEdificio(supabase, buildingId);
  let llamadas = 0;
  if (ids.length > 0) {
    const { count } = await supabase
      .from('hubspot_calls')
      .select('id', { count: 'exact', head: true })
      .overlaps('associated_contact_ids', ids);
    llamadas = Number(count ?? 0);
  }
  return {
    propietarios: rows.length,
    telefonos: rows.filter((r) => !!r.telefono).length,
    llamadas,
    fuente_pct: String(rows[0]?.pct_fuente_edificio ?? 'nota'),
    suma_pct: Math.round(suma * 100) / 100,
    reparto_completo: suma >= 99.25 && suma <= 100.75,
  };
}

export async function sincronizarEdificioDesdeHubspot(
  supabase: any,
  buildingId: string,
  dealId: string,
): Promise<SyncStats> {
  const stats: SyncStats = {
    contactos_hubspot: 0, owners_creados: 0, owners_actualizados: 0,
    vinculos_creados: 0, llamadas_sincronizadas: 0,
    enlazados_nota: 0, dudosos_nota: 0, fallos: 0,
  };

  // 1) Contactos asociados al negocio (lectura)
  const assoc = await hubspotFetch('/crm/v4/associations/deals/contacts/batch/read', {
    method: 'POST',
    body: JSON.stringify({ inputs: [{ id: dealId }] }),
  });
  const contactIds: string[] = ((assoc?.results as any[]) || [])
    .flatMap((r: any) => (r?.to || []).map((t: any) => String(t.toObjectId)))
    .filter(Boolean);
  stats.contactos_hubspot = contactIds.length;

  await supabase.from('hubspot_deals')
    .update({ associated_contact_ids: contactIds, updated_at: new Date().toISOString() })
    .eq('hs_id', dealId);

  if (contactIds.length === 0) return stats;

  // 2) Qué contactos ya tienen ficha
  const contactToOwner = new Map<string, string>();
  const { data: ex } = await supabase
    .from('external_ids')
    .select('entity_id, provider_id')
    .eq('provider', 'hubspot')
    .eq('provider_object_type', 'contact')
    .in('provider_id', contactIds);
  (ex ?? []).forEach((e: any) => contactToOwner.set(String(e.provider_id), e.entity_id));

  // 3) Propiedades de los contactos (porcentaje, derechos, teléfonos, ciclo de vida)
  for (let k = 0; k < contactIds.length; k += 100) {
    const chunk = contactIds.slice(k, k + 100);
    const resp = await hubspotFetch('/crm/v3/objects/contacts/batch/read?archived=false', {
      method: 'POST',
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: CONTACT_PROPERTIES }),
    });
    for (const c of ((resp?.results as any[]) || [])) {
      const props = c.properties || {};
      const nombre = `${(props.firstname || '').trim()} ${(props.lastname || '').trim()}`.trim()
        || props.email || 'Sin nombre';
      const existing = contactToOwner.get(String(c.id));
      if (existing) {
        const { data: prev } = await supabase.from('owners').select('metadatos').eq('id', existing).maybeSingle();
        const meta = { ...((prev?.metadatos as Record<string, unknown>) || {}), ...props, _hubspot_contact_id: c.id };
        const { error } = await supabase.from('owners').update({
          metadatos: meta,
          email: props.email || null,
          telefono: props.phone || props.mobilephone || null,
          last_synced_at: new Date().toISOString(),
        }).eq('id', existing);
        if (error) stats.fallos++; else {
          await materializeHubspotConsent(supabase, existing, String(c.id), props);
          stats.owners_actualizados++;
        }
        continue;
      }
      const { data: ins, error: insErr } = await supabase.from('owners').insert({
        nombre,
        email: props.email || null,
        telefono: props.phone || props.mobilephone || null,
        rol: rolFromTipologia(props.tipologia_de_propietario || ''),
        metadatos: { ...props, _hubspot_contact_id: c.id, source: 'sync_building_hubspot' },
        last_synced_at: new Date().toISOString(),
      }).select('id').single();
      if (insErr || !ins) { stats.fallos++; continue; }
      const { error: extErr } = await supabase.from('external_ids').insert({
        entity_type: 'owner', entity_id: ins.id,
        provider: 'hubspot', provider_object_type: 'contact', provider_id: String(c.id),
        metadatos: { hs_object_id: c.id, source: 'sync_building_hubspot' },
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
      await materializeHubspotConsent(supabase, ins.id, String(c.id), props);
      stats.owners_creados++;
    }
  }

  // 4) Garantizar el vínculo edificio ↔ propietario
  for (const cid of contactIds) {
    const ownerId = contactToOwner.get(cid);
    if (!ownerId) continue;
    const { error } = await supabase.from('building_owners').upsert({
      building_id: buildingId,
      owner_id: ownerId,
      metadatos: { source: 'sync_building_hubspot', hs_deal_id: dealId, hs_contact_id: cid },
    }, { onConflict: 'building_id,owner_id', ignoreDuplicates: true });
    if (!error) stats.vinculos_creados++;
    else if (error.code !== '23505') { stats.fallos++; console.error('[sync] building_owners:', error); }
  }

  // 5) Llamadas de esos contactos (lectura)
  const callIds = new Set<string>();
  for (let k = 0; k < contactIds.length; k += 100) {
    const chunk = contactIds.slice(k, k + 100);
    try {
      const a = await hubspotFetch('/crm/v4/associations/contacts/calls/batch/read', {
        method: 'POST',
        body: JSON.stringify({ inputs: chunk.map((id) => ({ id })) }),
      });
      for (const r of ((a?.results as any[]) || [])) {
        for (const t of (r?.to || [])) callIds.add(String(t.toObjectId));
      }
    } catch (e) { stats.fallos++; console.error('[sync] asociaciones llamadas:', e); }
  }
  const todas = Array.from(callIds).slice(0, 300);
  for (let k = 0; k < todas.length; k += 100) {
    const chunk = todas.slice(k, k + 100);
    try {
      const resp = await hubspotFetch('/crm/v3/objects/calls/batch/read?archived=false', {
        method: 'POST',
        body: JSON.stringify({ inputs: chunk.map((id) => ({ id })), properties: CALL_PROPERTIES }),
      });
      const rows = ((resp?.results as any[]) || []).map((e: any) => {
        const p = e.properties || {};
        return {
          hs_id: String(e.id),
          hs_call_title: p.hs_call_title || null,
          hs_call_body: p.hs_call_body || null,
          hs_call_summary: p.hs_call_summary || null,
          hs_call_status: p.hs_call_status || null,
          hs_call_direction: p.hs_call_direction || null,
          hs_call_disposition: p.hs_call_disposition || null,
          hs_call_duration: intOrNull(p.hs_call_duration),
          hs_call_recording_url: p.hs_call_recording_url || null,
          hs_call_to_number: p.hs_call_to_number || null,
          hs_call_from_number: p.hs_call_from_number || null,
          hs_owner_id: p.hubspot_owner_id || null,
          hs_timestamp: tsOrNull(p.hs_timestamp),
          hs_createdate: tsOrNull(p.hs_createdate ?? e.createdAt),
          hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
          raw: e,
          updated_at: new Date().toISOString(),
        };
      });
      if (rows.length > 0) {
        const { error } = await supabase.from('hubspot_calls').upsert(rows, { onConflict: 'hs_id' });
        if (error) { stats.fallos++; console.error('[sync] hubspot_calls:', error); }
        else stats.llamadas_sincronizadas += rows.length;
      }
    } catch (e) { stats.fallos++; console.error('[sync] llamadas:', e); }
  }

  // 6) Cerrar el circuito con los titulares de la nota
  const { data: enlace, error: rpcErr } = await supabase.rpc('enlazar_titulares_con_contactos', {
    p_building_id: buildingId, p_limit: 2000, p_dry_run: false,
  });
  if (rpcErr) console.error('[sync] enlace titulares:', rpcErr);
  else if (enlace) {
    stats.enlazados_nota = Number((enlace as any).enlazados ?? 0);
    stats.dudosos_nota = Number((enlace as any).dudosos ?? 0);
  }

  // 7) Recalcular etiquetas de influenciador y estado de porcentajes del edificio.
  //    Sólo lectura desde HubSpot: esto ordena nuestros propios datos.
  const { error: infErr } = await supabase.rpc('recalcular_influenciadores', { p_building_id: buildingId });
  if (infErr) console.error('[sync] influenciadores:', infErr);
  const { error: verErr } = await supabase.rpc('recalcular_porcentajes_estado_crm', { p_building_id: buildingId });
  if (verErr) console.error('[sync] estado porcentajes:', verErr);

  return stats;
}
