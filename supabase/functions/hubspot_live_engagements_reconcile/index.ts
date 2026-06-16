// hubspot_live_engagements_reconcile
// Diagnóstico y reconciliación idempotente de engagements HubSpot (fuente viva)
// para la cohorte de 77 edificios: calls + notes hacia espejo y tablas visibles.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';
import { hubspotFetch, corsHeaders } from '../_shared/hubspot.ts';

const ASSOC_BATCH = 100;
const READ_BATCH = 100;
const DB_BATCH = 500;

type EngType = 'calls' | 'notes' | 'tasks' | 'meetings' | 'emails';

const ENG_TYPES: EngType[] = ['calls', 'notes', 'tasks', 'meetings', 'emails'];

const CALL_PROPS = [
  'hs_call_title', 'hs_call_body', 'hs_call_status', 'hs_call_direction',
  'hs_call_disposition', 'hs_call_duration', 'hs_call_recording_url',
  'hs_call_to_number', 'hs_call_from_number', 'hs_timestamp', 'hs_createdate',
  'hs_lastmodifieddate', 'hubspot_owner_id',
];
const NOTE_PROPS = ['hs_note_body', 'hs_timestamp', 'hs_createdate', 'hs_lastmodifieddate'];
const TASK_PROPS = [
  'hs_task_subject', 'hs_task_body', 'hs_task_status', 'hs_task_priority',
  'hs_task_type', 'hs_timestamp', 'hs_task_completion_date', 'hs_createdate',
  'hs_lastmodifieddate',
];
const CONTACT_PROPS = ['firstname', 'lastname', 'email', 'phone'];

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr.filter(Boolean).map(String)));
}

function tsOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function intOrNull(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function dirOf(d: string | null | undefined): 'entrante' | 'saliente' {
  const s = String(d || '').toLowerCase();
  return s.includes('inbound') || s.includes('incoming') || s.includes('entr') ? 'entrante' : 'saliente';
}

function cleanHtml(s: string | null | undefined): string {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function contactName(c: any): string {
  const p = c?.properties || {};
  const n = `${p.firstname || ''} ${p.lastname || ''}`.trim();
  return n || p.email || p.phone || `HubSpot ${c?.id}`;
}

function parseAssocIds(row: any): string[] {
  const to = row?.to || row?.associations || row?.results || [];
  if (!Array.isArray(to)) return [];
  return uniq(to.map((x: any) => String(x?.toObjectId ?? x?.id ?? x?.to?.id ?? '')).filter(Boolean));
}

async function fetchAssociationsBatch(fromType: string, toType: string, ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  ids.forEach((id) => out.set(String(id), []));

  for (const idsChunk of chunk(ids, ASSOC_BATCH)) {
    try {
      const resp = await hubspotFetch(`/crm/v4/associations/${fromType}/${toType}/batch/read`, {
        method: 'POST',
        body: JSON.stringify({ inputs: idsChunk.map((id) => ({ id })) }),
      });
      for (const r of resp?.results || []) {
        const fromId = String(r?.from?.id ?? r?.fromObjectId ?? r?.id ?? '');
        if (!fromId) continue;
        out.set(fromId, parseAssocIds(r));
      }
    } catch (_batchErr) {
      for (const id of idsChunk) {
        const found: string[] = [];
        let after: string | undefined;
        do {
          const qs = new URLSearchParams({ limit: '500' });
          if (after) qs.set('after', after);
          const resp = await hubspotFetch(`/crm/v4/objects/${fromType}/${id}/associations/${toType}?${qs.toString()}`);
          found.push(...(resp?.results || []).map((x: any) => String(x.toObjectId ?? x.id)).filter(Boolean));
          after = resp?.paging?.next?.after;
        } while (after);
        out.set(String(id), uniq(found));
      }
    }
  }

  return out;
}

async function batchReadObjects(type: string, ids: string[], properties: string[]): Promise<any[]> {
  const rows: any[] = [];
  for (const idsChunk of chunk(uniq(ids), READ_BATCH)) {
    const resp = await hubspotFetch(`/crm/v3/objects/${type}/batch/read?archived=false`, {
      method: 'POST',
      body: JSON.stringify({ properties, inputs: idsChunk.map((id) => ({ id })) }),
    });
    rows.push(...(resp?.results || []));
  }
  return rows;
}

function callMirrorRow(e: any, associatedContactIds: string[], existing?: any): Record<string, unknown> {
  const p = e.properties || {};
  return {
    hs_id: String(e.id),
    hs_call_title: p.hs_call_title || null,
    hs_call_body: p.hs_call_body || null,
    hs_call_status: p.hs_call_status || null,
    hs_call_direction: p.hs_call_direction || null,
    hs_call_disposition: p.hs_call_disposition || null,
    hs_call_duration: intOrNull(p.hs_call_duration),
    hs_call_recording_url: p.hs_call_recording_url || null,
    hs_call_to_number: p.hs_call_to_number || null,
    hs_call_from_number: p.hs_call_from_number || null,
    hs_timestamp: tsOrNull(p.hs_timestamp),
    hs_createdate: tsOrNull(p.hs_createdate ?? e.createdAt),
    hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
    hs_owner_id: p.hubspot_owner_id || null,
    associated_contact_ids: uniq([...(existing?.associated_contact_ids || []), ...associatedContactIds]),
    associated_deal_ids: existing?.associated_deal_ids || [],
    raw: { ...(existing?.raw || {}), live_batch: e },
    updated_at: new Date().toISOString(),
  };
}

function noteMirrorRow(e: any, associatedContactIds: string[], existing?: any): Record<string, unknown> {
  const p = e.properties || {};
  return {
    hs_id: String(e.id),
    hs_note_body: p.hs_note_body || null,
    hs_timestamp: tsOrNull(p.hs_timestamp),
    hs_createdate: tsOrNull(p.hs_createdate ?? e.createdAt),
    hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
    associated_contact_ids: uniq([...(existing?.associated_contact_ids || []), ...associatedContactIds]),
    associated_deal_ids: existing?.associated_deal_ids || [],
    raw: { ...(existing?.raw || {}), live_batch: e },
    updated_at: new Date().toISOString(),
  };
}

function taskMirrorRow(e: any, associatedContactIds: string[], existing?: any): Record<string, unknown> {
  const p = e.properties || {};
  return {
    hs_id: String(e.id),
    hs_task_subject: p.hs_task_subject || null,
    hs_task_body: p.hs_task_body || null,
    hs_task_status: p.hs_task_status || null,
    hs_task_priority: p.hs_task_priority || null,
    hs_task_type: p.hs_task_type || null,
    hs_timestamp: tsOrNull(p.hs_timestamp),
    hs_task_completion_date: tsOrNull(p.hs_task_completion_date),
    hs_createdate: tsOrNull(p.hs_createdate ?? e.createdAt),
    hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
    associated_contact_ids: uniq([...(existing?.associated_contact_ids || []), ...associatedContactIds]),
    associated_deal_ids: existing?.associated_deal_ids || [],
    raw: { ...(existing?.raw || {}), live_batch: e },
    updated_at: new Date().toISOString(),
  };
}

async function fetchExistingByHsId(supabase: any, table: string, ids: string[], select: string): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  for (const idsChunk of chunk(uniq(ids), DB_BATCH)) {
    const { data, error } = await supabase.from(table).select(select).in('hs_id', idsChunk);
    if (error) throw error;
    for (const r of data || []) out.set(String(r.hs_id), r);
  }
  return out;
}

async function upsertRows(supabase: any, table: string, rows: any[]): Promise<number> {
  let n = 0;
  for (const rowsChunk of chunk(rows, DB_BATCH)) {
    if (!rowsChunk.length) continue;
    const { error } = await supabase.from(table).upsert(rowsChunk, { onConflict: 'hs_id' });
    if (error) throw error;
    n += rowsChunk.length;
  }
  return n;
}

async function fetchAppCallsForOwners(supabase: any, ownerIds: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const idsChunk of chunk(ownerIds, DB_BATCH)) {
    const { data, error } = await supabase
      .from('calls')
      .select('id, owner_id, fecha, resumen, metadatos')
      .in('owner_id', idsChunk)
      .limit(10000);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

async function fetchAppNotesForOwners(supabase: any, ownerIds: string[]): Promise<any[]> {
  const out: any[] = [];
  for (const idsChunk of chunk(ownerIds, DB_BATCH)) {
    const { data, error } = await supabase
      .from('notes')
      .select('id, owner_id, texto, etiquetas, created_at')
      .in('owner_id', idsChunk)
      .limit(10000);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

function hsIdFromCall(c: any): string | null {
  const m = String(c?.resumen || '').match(/^\[hs:([^\]]+)\]/);
  return c?.metadatos?.hs_id || c?.metadatos?.hubspot_call_id || (m ? m[1] : null);
}

function hsIdFromNote(n: any): string | null {
  const tags: string[] = n?.etiquetas || [];
  const tag = tags.find((t) => String(t).startsWith('hubspot:'));
  if (tag) return String(tag).slice('hubspot:'.length);
  const m = String(n?.texto || '').match(/^\[hs_note:([^\]]+)\]/);
  return m ? m[1] : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ignore */ }
  const action = String(body?.action || 'diagnose');
  const doSync = action === 'sync' || action === 'reconcile';
  const cohortSource = String(body?.cohort || 'building_processing_status');
  const includeGlobalTasks = body?.include_tasks !== false;

  try {
    const startedAt = new Date().toISOString();

    let cohortQuery = supabase.from('buildings').select('id, direccion, metadatos').order('direccion');
    if (Array.isArray(body?.building_ids) && body.building_ids.length > 0) {
      cohortQuery = cohortQuery.in('id', body.building_ids);
    } else if (cohortSource === 'cartera_demo_seed') {
      cohortQuery = cohortQuery.eq('cartera_demo_seed', true);
    } else {
      const { data: bps, error: bpsErr } = await supabase.from('building_processing_status').select('building_id');
      if (bpsErr) throw bpsErr;
      cohortQuery = cohortQuery.in('id', uniq((bps || []).map((r: any) => r.building_id)));
    }
    const { data: buildings, error: bErr } = await cohortQuery;
    if (bErr) throw bErr;

    const buildingIds = (buildings || []).map((b: any) => b.id);
    const buildingById = new Map((buildings || []).map((b: any) => [b.id, b]));

    const { data: dealExt, error: dealErr } = await supabase
      .from('external_ids')
      .select('entity_id, provider_id')
      .eq('entity_type', 'building')
      .eq('provider', 'hubspot')
      .eq('provider_object_type', 'deal')
      .in('entity_id', buildingIds);
    if (dealErr) throw dealErr;
    const dealIdByBuilding = new Map<string, string>();
    for (const b of buildings || []) {
      const metaDeal = b?.metadatos?._hubspot_deal_id || b?.metadatos?.hs_object_id;
      if (metaDeal) dealIdByBuilding.set(b.id, String(metaDeal));
    }
    for (const r of dealExt || []) dealIdByBuilding.set(r.entity_id, String(r.provider_id));

    const dealIds = uniq(Array.from(dealIdByBuilding.values()));
    const dealContacts = dealIds.length ? await fetchAssociationsBatch('deals', 'contacts', dealIds) : new Map<string, string[]>();
    const buildingContacts = new Map<string, Set<string>>();
    for (const [buildingId, dealId] of dealIdByBuilding.entries()) {
      buildingContacts.set(buildingId, new Set(dealContacts.get(dealId) || []));
    }

    const { data: localBos, error: boErr } = await supabase
      .from('building_owners')
      .select('building_id, owner_id, owners:owner_id(id, nombre)')
      .in('building_id', buildingIds);
    if (boErr) throw boErr;
    const ownerIds = uniq((localBos || []).map((r: any) => r.owner_id));

    const { data: ownerExt, error: extErr } = await supabase
      .from('external_ids')
      .select('entity_id, provider_id')
      .eq('entity_type', 'owner')
      .eq('provider', 'hubspot')
      .eq('provider_object_type', 'contact')
      .in('entity_id', ownerIds.length ? ownerIds : ['00000000-0000-0000-0000-000000000000']);
    if (extErr) throw extErr;

    const contactToOwner = new Map<string, string>();
    const ownerToContacts = new Map<string, string[]>();
    for (const e of ownerExt || []) {
      contactToOwner.set(String(e.provider_id), e.entity_id);
      ownerToContacts.set(e.entity_id, [...(ownerToContacts.get(e.entity_id) || []), String(e.provider_id)]);
    }
    for (const bo of localBos || []) {
      for (const cid of ownerToContacts.get(bo.owner_id) || []) {
        if (!buildingContacts.has(bo.building_id)) buildingContacts.set(bo.building_id, new Set());
        buildingContacts.get(bo.building_id)!.add(cid);
      }
    }

    const allContactIds = uniq(Array.from(buildingContacts.values()).flatMap((s) => Array.from(s)));

    const allOwnerExtForLiveContacts = allContactIds.length
      ? await (async () => {
        const out: any[] = [];
        for (const idsChunk of chunk(allContactIds, DB_BATCH)) {
          const { data, error } = await supabase
            .from('external_ids')
            .select('entity_id, provider_id')
            .eq('entity_type', 'owner')
            .eq('provider', 'hubspot')
            .eq('provider_object_type', 'contact')
            .in('provider_id', idsChunk);
          if (error) throw error;
          out.push(...(data || []));
        }
        return out;
      })()
      : [];
    for (const e of allOwnerExtForLiveContacts) contactToOwner.set(String(e.provider_id), e.entity_id);

    const contactsRaw = allContactIds.length ? await batchReadObjects('contacts', allContactIds, CONTACT_PROPS) : [];
    const contactInfo = new Map<string, any>();
    contactsRaw.forEach((c) => contactInfo.set(String(c.id), c));

    const assocByType: Record<string, Map<string, string[]>> = {};
    for (const t of ENG_TYPES) {
      assocByType[t] = allContactIds.length ? await fetchAssociationsBatch('contacts', t, allContactIds) : new Map();
    }

    const idsByType: Record<string, string[]> = {};
    const engagementToContacts: Record<string, Map<string, string[]>> = {};
    for (const t of ENG_TYPES) {
      const rev = new Map<string, string[]>();
      for (const [cid, ids] of assocByType[t].entries()) {
        for (const eid of ids) rev.set(eid, [...(rev.get(eid) || []), cid]);
      }
      engagementToContacts[t] = rev;
      idsByType[t] = uniq(Array.from(rev.keys()));
    }

    const existingCalls = await fetchExistingByHsId(
      supabase,
      'hubspot_calls',
      idsByType.calls,
      'hs_id, associated_contact_ids, associated_deal_ids, raw, hs_call_title, hs_call_body, hs_call_direction, hs_call_duration, hs_call_recording_url, hs_timestamp, hs_createdate, hs_lastmodifieddate, hs_call_to_number, hs_call_from_number, hs_owner_id',
    );
    const existingNotes = await fetchExistingByHsId(
      supabase,
      'hubspot_notes',
      idsByType.notes,
      'hs_id, associated_contact_ids, associated_deal_ids, raw, hs_note_body, hs_timestamp, hs_createdate, hs_lastmodifieddate',
    );
    const existingTasks = includeGlobalTasks
      ? await fetchExistingByHsId(supabase, 'hubspot_tasks', idsByType.tasks, 'hs_id, associated_contact_ids, associated_deal_ids, raw')
      : new Map<string, any>();

    const appCallsBefore = await fetchAppCallsForOwners(supabase, uniq(Array.from(contactToOwner.values())));
    const appNotesBefore = await fetchAppNotesForOwners(supabase, uniq(Array.from(contactToOwner.values())));
    const appCallHsIdsBefore = new Set(appCallsBefore.map(hsIdFromCall).filter(Boolean));
    const appNoteHsIdsBefore = new Set(appNotesBefore.map(hsIdFromNote).filter(Boolean));

    const failures = {
      calls: { missing_mirror: 0, mirror_without_contact_assoc: 0, contact_not_mapped_owner: 0, mapped_but_not_app_visible: 0 },
      notes: { missing_mirror: 0, mirror_without_contact_assoc: 0, contact_not_mapped_owner: 0, mapped_but_not_app_visible: 0 },
    };
    for (const t of ['calls', 'notes'] as const) {
      const mirror = t === 'calls' ? existingCalls : existingNotes;
      const appIds = t === 'calls' ? appCallHsIdsBefore : appNoteHsIdsBefore;
      for (const [eid, cids] of engagementToContacts[t].entries()) {
        const m = mirror.get(eid);
        if (!m) failures[t].missing_mirror++;
        for (const cid of cids) {
          if (m && !(m.associated_contact_ids || []).map(String).includes(String(cid))) failures[t].mirror_without_contact_assoc++;
          if (!contactToOwner.has(cid)) failures[t].contact_not_mapped_owner++;
        }
        if (!appIds.has(eid)) failures[t].mapped_but_not_app_visible++;
      }
    }

    const countsBeforeByBuilding = new Map<string, any>();
    for (const b of buildings || []) {
      const cids = Array.from(buildingContacts.get(b.id) || []);
      const oids = uniq(cids.map((cid) => contactToOwner.get(cid) || '').filter(Boolean));
      countsBeforeByBuilding.set(b.id, {
        building_id: b.id,
        direccion: b.direccion,
        contacts: cids.length,
        owners_mapped: oids.length,
        hubspot_calls_live: uniq(cids.flatMap((cid) => assocByType.calls.get(cid) || [])).length,
        mirror_calls_before: uniq(cids.flatMap((cid) => (assocByType.calls.get(cid) || []).filter((id) => existingCalls.has(id)))).length,
        app_calls_before: appCallsBefore.filter((r) => oids.includes(r.owner_id)).length,
        hubspot_notes_live: uniq(cids.flatMap((cid) => assocByType.notes.get(cid) || [])).length,
        mirror_notes_before: uniq(cids.flatMap((cid) => (assocByType.notes.get(cid) || []).filter((id) => existingNotes.has(id)))).length,
        app_notes_before: appNotesBefore.filter((r) => oids.includes(r.owner_id)).length,
        hubspot_tasks_live: uniq(cids.flatMap((cid) => assocByType.tasks.get(cid) || [])).length,
        hubspot_meetings_live: uniq(cids.flatMap((cid) => assocByType.meetings.get(cid) || [])).length,
        hubspot_emails_live: uniq(cids.flatMap((cid) => assocByType.emails.get(cid) || [])).length,
      });
    }

    let mirrorCallsUpserted = 0;
    let mirrorNotesUpserted = 0;
    let mirrorTasksUpserted = 0;
    let callsPromoted = 0;
    let notesPromoted = 0;

    if (doSync) {
      const callsToRead = idsByType.calls;
      const notesToRead = idsByType.notes;
      const tasksToRead = includeGlobalTasks ? idsByType.tasks : [];

      const [callObjs, noteObjs, taskObjs] = await Promise.all([
        callsToRead.length ? batchReadObjects('calls', callsToRead, CALL_PROPS) : Promise.resolve([]),
        notesToRead.length ? batchReadObjects('notes', notesToRead, NOTE_PROPS) : Promise.resolve([]),
        tasksToRead.length ? batchReadObjects('tasks', tasksToRead, TASK_PROPS) : Promise.resolve([]),
      ]);

      const callRows = callObjs.map((o) => callMirrorRow(o, engagementToContacts.calls.get(String(o.id)) || [], existingCalls.get(String(o.id))));
      const noteRows = noteObjs.map((o) => noteMirrorRow(o, engagementToContacts.notes.get(String(o.id)) || [], existingNotes.get(String(o.id))));
      const taskRows = taskObjs.map((o) => taskMirrorRow(o, engagementToContacts.tasks.get(String(o.id)) || [], existingTasks.get(String(o.id))));
      mirrorCallsUpserted = await upsertRows(supabase, 'hubspot_calls', callRows);
      mirrorNotesUpserted = await upsertRows(supabase, 'hubspot_notes', noteRows);
      if (taskRows.length) mirrorTasksUpserted = await upsertRows(supabase, 'hubspot_tasks', taskRows);

      const existingAppCalls = new Set(appCallHsIdsBefore);
      const callInserts: any[] = [];
      for (const r of callRows) {
        const hsId = String(r.hs_id);
        if (existingAppCalls.has(hsId)) continue;
        const cids = (r.associated_contact_ids || []) as string[];
        const ownerId = cids.map((cid) => contactToOwner.get(String(cid))).find(Boolean);
        if (!ownerId) continue;
        const title = String(r.hs_call_title || '').trim();
        const bodyText = cleanHtml(String(r.hs_call_body || ''));
        callInserts.push({
          owner_id: ownerId,
          direccion: dirOf(String(r.hs_call_direction || '')),
          duracion_seg: r.hs_call_duration == null ? null : Math.round(Number(r.hs_call_duration || 0) / 1000),
          transcripcion: bodyText || null,
          transcripcion_url: r.hs_call_recording_url || null,
          fecha: r.hs_timestamp || r.hs_createdate || new Date().toISOString(),
          resumen: `[hs:${hsId}]${title ? ' ' + title : ''}`.slice(0, 4000),
          metadatos: { source: 'hubspot_live_reconcile', hs_id: hsId, hubspot_call_id: hsId, associated_contact_ids: cids, synced_at: new Date().toISOString() },
        });
        existingAppCalls.add(hsId);
      }
      for (const rowsChunk of chunk(callInserts, DB_BATCH)) {
        const { error } = await supabase.from('calls').insert(rowsChunk);
        if (error) throw error;
        callsPromoted += rowsChunk.length;
      }

      const existingAppNotes = new Set(appNoteHsIdsBefore);
      const noteInserts: any[] = [];
      for (const r of noteRows) {
        const hsId = String(r.hs_id);
        if (existingAppNotes.has(hsId)) continue;
        const cids = (r.associated_contact_ids || []) as string[];
        const ownerId = cids.map((cid) => contactToOwner.get(String(cid))).find(Boolean);
        if (!ownerId) continue;
        const bodyText = cleanHtml(String(r.hs_note_body || '')) || '(nota HubSpot sin texto)';
        noteInserts.push({
          owner_id: ownerId,
          texto: `[hs_note:${hsId}] ${bodyText}`.slice(0, 20000),
          etiquetas: ['hubspot', `hubspot:${hsId}`],
          created_at: r.hs_timestamp || r.hs_createdate || new Date().toISOString(),
        });
        existingAppNotes.add(hsId);
      }
      for (const rowsChunk of chunk(noteInserts, DB_BATCH)) {
        const { error } = await supabase.from('notes').insert(rowsChunk);
        if (error) throw error;
        notesPromoted += rowsChunk.length;
      }
    }

    const appCallsAfter = await fetchAppCallsForOwners(supabase, uniq(Array.from(contactToOwner.values())));
    const appNotesAfter = await fetchAppNotesForOwners(supabase, uniq(Array.from(contactToOwner.values())));
    const existingCallsAfter = await fetchExistingByHsId(supabase, 'hubspot_calls', idsByType.calls, 'hs_id, associated_contact_ids');
    const existingNotesAfter = await fetchExistingByHsId(supabase, 'hubspot_notes', idsByType.notes, 'hs_id, associated_contact_ids');

    const buildingsReport = Array.from(countsBeforeByBuilding.values()).map((r) => {
      const cids = Array.from(buildingContacts.get(r.building_id) || []);
      const oids = uniq(cids.map((cid) => contactToOwner.get(cid) || '').filter(Boolean));
      const afterCalls = appCallsAfter.filter((x) => oids.includes(x.owner_id)).length;
      const afterNotes = appNotesAfter.filter((x) => oids.includes(x.owner_id)).length;
      return {
        ...r,
        mirror_calls_after: uniq(cids.flatMap((cid) => (assocByType.calls.get(cid) || []).filter((id) => existingCallsAfter.has(id)))).length,
        app_calls_after: afterCalls,
        calls_added_app: afterCalls - r.app_calls_before,
        calls_gap_after_vs_hubspot: r.hubspot_calls_live - afterCalls,
        mirror_notes_after: uniq(cids.flatMap((cid) => (assocByType.notes.get(cid) || []).filter((id) => existingNotesAfter.has(id)))).length,
        app_notes_after: afterNotes,
        notes_added_app: afterNotes - r.app_notes_before,
        notes_gap_after_vs_hubspot: r.hubspot_notes_live - afterNotes,
      };
    }).sort((a, b) => (b.calls_added_app + b.notes_added_app) - (a.calls_added_app + a.notes_added_app));

    const alonsoId = '3402ffbd-8dbe-4257-8132-8730f3c2ba2a';
    const alonsoContacts = Array.from(buildingContacts.get(alonsoId) || []);
    const alonsoDetail = alonsoContacts.map((cid) => {
      const ownerId = contactToOwner.get(cid) || null;
      return {
        hs_contact_id: cid,
        nombre: contactName(contactInfo.get(cid)),
        owner_id: ownerId,
        llamadas_hubspot: (assocByType.calls.get(cid) || []).length,
        llamadas_app: ownerId ? appCallsAfter.filter((c) => c.owner_id === ownerId).length : 0,
        notas_hubspot: (assocByType.notes.get(cid) || []).length,
        notas_app: ownerId ? appNotesAfter.filter((n) => n.owner_id === ownerId).length : 0,
      };
    }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    const mariaJose = alonsoDetail.filter((r) => /maria|maría|jose|josé|coserr/i.test(r.nombre));

    const summary = {
      ok: true,
      action,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      cohort: { source: cohortSource, buildings: buildingIds.length, hubspot_deals: dealIds.length, live_contacts: allContactIds.length, mapped_contacts: Array.from(contactToOwner.keys()).length },
      live_hubspot: {
        calls: idsByType.calls.length,
        notes: idsByType.notes.length,
        tasks: idsByType.tasks.length,
        meetings: idsByType.meetings.length,
        emails: idsByType.emails.length,
      },
      before: {
        mirror_calls: existingCalls.size,
        mirror_notes: existingNotes.size,
        app_calls: appCallsBefore.length,
        app_notes: appNotesBefore.length,
      },
      synced: { mirror_calls_upserted: mirrorCallsUpserted, mirror_notes_upserted: mirrorNotesUpserted, mirror_tasks_upserted: mirrorTasksUpserted, calls_promoted: callsPromoted, notes_promoted: notesPromoted },
      after: {
        mirror_calls: existingCallsAfter.size,
        mirror_notes: existingNotesAfter.size,
        app_calls: appCallsAfter.length,
        app_notes: appNotesAfter.length,
      },
      dominant_failure_table_before: failures,
      buildings_report: buildingsReport,
      alonso_heredia_25: {
        building_id: alonsoId,
        direccion: buildingById.get(alonsoId)?.direccion || 'Calle Alonso Heredia 25',
        contacts: alonsoDetail,
        maria_jose_coserria_matches: mariaJose,
      },
    };

    return new Response(JSON.stringify(summary), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[hubspot_live_engagements_reconcile] error', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});