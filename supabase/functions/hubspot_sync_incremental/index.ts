// hubspot_sync_incremental
// Sync incremental por hs_lastmodifieddate para engagements HubSpot:
// calls, notes, communications, tasks, meetings. Upsert idempotente por hs_id en hubspot_<type>.
// Cursor por entidad guardado en hubspot_sync_state.metadatos.since_ts (ISO ms).
// Al finalizar calls, encadena auto_analyze_hubspot_calls (transcripción+VOSS).
//
// Params: { types?: string[], pages?: number, since_iso?: string, fallback_days?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

type EngType = "calls" | "notes" | "communications" | "tasks" | "meetings";

const TABLE: Record<EngType, string> = {
  calls: "hubspot_calls",
  notes: "hubspot_notes",
  communications: "hubspot_communications",
  tasks: "hubspot_tasks",
  meetings: "hubspot_meetings",
};

const PROPS: Record<EngType, string[]> = {
  calls: ["hs_call_title","hs_call_body","hs_call_summary","hs_call_status","hs_call_direction","hs_call_disposition","hs_call_duration","hs_call_recording_url","hs_call_to_number","hs_call_from_number","hs_call_transcription","hs_timestamp","hs_createdate","hs_lastmodifieddate","hubspot_owner_id"],
  notes: ["hs_note_body","hs_timestamp","hs_createdate","hs_lastmodifieddate"],
  communications: ["hs_communication_channel_type","hs_communication_body","hs_communication_logged_from","hs_timestamp","hs_createdate","hs_lastmodifieddate","hubspot_owner_id"],
  tasks: ["hs_task_subject","hs_task_body","hs_task_status","hs_task_priority","hs_task_type","hs_timestamp","hs_task_completion_date","hs_createdate","hs_lastmodifieddate"],
  meetings: ["hs_meeting_title","hs_meeting_body","hs_meeting_start_time","hs_meeting_end_time","hs_meeting_outcome","hs_timestamp","hs_createdate","hs_lastmodifieddate"],
};

const PAGE_LIMIT = 100;
const DEFAULT_PAGES = 20;

function tsOrNull(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function intOrNull(v: any): number | null {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

function toRow(type: EngType, e: any): Record<string, unknown> {
  const p = e.properties || {};
  const assoc = e.associations || {};
  const contactIds: string[] = (assoc.contacts?.results || []).map((r: any) => String(r.id));
  const dealIds: string[] = (assoc.deals?.results || []).map((r: any) => String(r.id));
  const base = {
    hs_id: String(e.id),
    hs_timestamp: tsOrNull(p.hs_timestamp),
    hs_createdate: tsOrNull(p.hs_createdate ?? e.createdAt),
    hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
    associated_contact_ids: contactIds,
    associated_deal_ids: dealIds,
    raw: e,
    updated_at: new Date().toISOString(),
  };
  if (type === "calls") {
    return {
      ...base,
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
    };
  }
  if (type === "notes") {
    return { ...base, hs_note_body: p.hs_note_body || null };
  }
  if (type === "communications") {
    return {
      ...base,
      hs_communication_channel_type: p.hs_communication_channel_type || null,
      hs_communication_body: p.hs_communication_body || null,
      hs_communication_logged_from: p.hs_communication_logged_from || null,
      hs_owner_id: p.hubspot_owner_id || null,
    };
  }
  if (type === "tasks") {
    return {
      ...base,
      hs_task_subject: p.hs_task_subject || null,
      hs_task_body: p.hs_task_body || null,
      hs_task_status: p.hs_task_status || null,
      hs_task_priority: p.hs_task_priority || null,
      hs_task_type: p.hs_task_type || null,
      hs_task_completion_date: tsOrNull(p.hs_task_completion_date),
    };
  }
  // meetings
  return {
    ...base,
    hs_meeting_title: p.hs_meeting_title || null,
    hs_meeting_body: p.hs_meeting_body || null,
    hs_meeting_start_time: tsOrNull(p.hs_meeting_start_time),
    hs_meeting_end_time: tsOrNull(p.hs_meeting_end_time),
    hs_meeting_outcome: p.hs_meeting_outcome || null,
  };
}

async function fetchAssociations(type: EngType, id: string): Promise<{ contacts: string[]; deals: string[] }> {
  try {
    const j = await hubspotFetch(`/crm/v3/objects/${type}/${id}?associations=contacts,deals`);
    const assoc = j?.associations || {};
    return {
      contacts: (assoc.contacts?.results || []).map((r: any) => String(r.id)),
      deals: (assoc.deals?.results || []).map((r: any) => String(r.id)),
    };
  } catch { return { contacts: [], deals: [] }; }
}

async function syncType(supabase: any, type: EngType, pages: number, sinceIsoOverride: string | null, fallbackDays: number) {
  const entityKey = `${type}_inc`;
  // upsert row if missing
  await supabase.from("hubspot_sync_state").upsert({ entity: entityKey }, { onConflict: "entity" });
  const { data: state } = await supabase.from("hubspot_sync_state").select("metadatos,cursor").eq("entity", entityKey).single();
  const meta = state?.metadatos ?? {};
  const sinceIso: string = sinceIsoOverride ?? meta?.since_ts ?? new Date(Date.now() - fallbackDays * 86400_000).toISOString();
  const sinceMs = new Date(sinceIso).getTime();

  const { data: logRow } = await supabase.from("hubspot_sync_log").insert({ entity: entityKey, status: "running", metadatos: { since: sinceIso } }).select("id").single();
  const logId = logRow?.id;
    const runStartedAt = new Date().toISOString();
    await supabase.from("hubspot_sync_state").update({ last_run_status: "running", last_run_at: runStartedAt, last_error: null }).eq("entity", entityKey);
    // Mantiene actualizadas las filas legacy (`calls`, `notes`, etc.) para que
    // el panel de salud no parezca congelado: el cursor real sigue siendo *_inc.
    await supabase.from("hubspot_sync_state").upsert({
      entity: type,
      last_run_status: "running",
      last_run_at: runStartedAt,
      last_error: null,
      metadatos: { alias_of: entityKey, since_ts: sinceIso },
    }, { onConflict: "entity" });

  let after: string | undefined = undefined;
  let upserted = 0, failed = 0, pagesFetched = 0;
  let maxSeenIso = sinceIso;
  const newIdsWithRecording: string[] = [];

  try {
    for (let p = 0; p < pages; p++) {
      const body: any = {
        filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: String(sinceMs) }] }],
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
        properties: PROPS[type],
        limit: PAGE_LIMIT,
      };
      if (after) body.after = after;

      const data = await hubspotFetch(`/crm/v3/objects/${type}/search`, { method: "POST", body: JSON.stringify(body) });
      pagesFetched++;
      const results: any[] = data?.results || [];
      if (!results.length) break;

      // Enriquecer con asociaciones (concurrencia 5)
      const enriched: any[] = new Array(results.length);
      const concurrency = 5;
      for (let i = 0; i < results.length; i += concurrency) {
        const slice = results.slice(i, i + concurrency);
        const assocs = await Promise.all(slice.map((e) => fetchAssociations(type, String(e.id))));
        for (let j = 0; j < slice.length; j++) {
          const e = slice[j];
          e.associations = {
            contacts: { results: assocs[j].contacts.map((id: string) => ({ id, type: "contact_to_" + type })) },
            deals:    { results: assocs[j].deals.map((id: string)    => ({ id, type: "deal_to_" + type })) },
          };
          enriched[i + j] = e;
        }
      }

      const rows = enriched.map((e) => toRow(type, e));
      for (const r of rows) {
        const lm = r.hs_lastmodifieddate as string | null;
        if (lm && lm > maxSeenIso) maxSeenIso = lm;
        if (type === "calls" && (r as any).hs_call_recording_url && intOrNull((r as any).hs_call_duration) && ((r as any).hs_call_duration >= 45000)) {
          newIdsWithRecording.push(String(r.hs_id));
        }
      }
      const { error: upErr } = await supabase.from(TABLE[type]).upsert(rows, { onConflict: "hs_id" });
      if (upErr) { failed += rows.length; console.error(`[inc ${type}] upsert err:`, upErr.message); }
      else upserted += rows.length;

      after = data?.paging?.next?.after;
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await supabase.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed,
      metadatos: { since: sinceIso, since_after: maxSeenIso, new_calls_with_recording: newIdsWithRecording.length },
    }).eq("id", logId);
    await supabase.from("hubspot_sync_state").update({
      last_run_status: "ok", last_run_at: finishedAt,
      cursor: maxSeenIso,
      last_error: null,
      metadatos: { ...meta, since_ts: maxSeenIso, last_upserted: upserted },
    }).eq("entity", entityKey);
    await supabase.from("hubspot_sync_state").upsert({
      entity: type,
      cursor: maxSeenIso,
      last_run_status: "ok",
      last_run_at: finishedAt,
      last_error: null,
      metadatos: { alias_of: entityKey, since_ts: maxSeenIso, last_upserted: upserted },
    }, { onConflict: "entity" });

    return { ok: true, type, pages_fetched: pagesFetched, upserted, failed, since: sinceIso, since_after: maxSeenIso, new_calls_with_recording: newIdsWithRecording };
  } catch (e: any) {
    const msg = e?.message ?? "unknown";
    console.error(`[inc ${type}] error:`, msg);
    await supabase.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error",
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed, error_message: msg,
    }).eq("id", logId);
    await supabase.from("hubspot_sync_state").update({ last_run_status: "error", last_error: msg }).eq("entity", entityKey);
    await supabase.from("hubspot_sync_state").upsert({
      entity: type,
      last_run_status: "error",
      last_error: msg,
      metadatos: { alias_of: entityKey, since_ts: sinceIso },
    }, { onConflict: "entity" });
    return { ok: false, type, error: msg, upserted, pages_fetched: pagesFetched };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUP, SR);
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const types: EngType[] = (Array.isArray(body.types) && body.types.length ? body.types : ["calls","notes","communications","tasks","meetings"]) as EngType[];
  const pages: number = Math.max(1, Math.min(50, body.pages ?? DEFAULT_PAGES));
  const sinceIso: string | null = body.since_iso ?? null;
  const fallbackDays: number = body.fallback_days ?? 7;

  const run = async () => {
    const results: any[] = [];
    let anyNewCallForAnalysis = false;
    for (const t of types) {
      const r = await syncType(supabase, t, pages, sinceIso, fallbackDays);
      results.push(r);
      if (t === "calls" && r.ok && (r.new_calls_with_recording?.length ?? 0) > 0) anyNewCallForAnalysis = true;
    }

    // Encadenar: si entraron llamadas nuevas con grabación, dispara transcripción + auto-análisis.
    const chained: any = { transcribed: null, auto_analyzed: null };
    if (anyNewCallForAnalysis) {
      try {
        const rt = await fetch(`${SUP}/functions/v1/transcribe_calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
          body: JSON.stringify({ limit: 25 }),
        });
        chained.transcribed = { status: rt.status, ok: rt.ok };
      } catch (e) { chained.transcribed = { error: (e as Error).message }; }
      try {
        const ra = await fetch(`${SUP}/functions/v1/auto_analyze_hubspot_calls`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SR}` },
          body: JSON.stringify({ limit: 15 }),
        });
        chained.auto_analyzed = { status: ra.status, ok: ra.ok };
      } catch (e) { chained.auto_analyzed = { error: (e as Error).message }; }
    }
    return { ok: true, results, chained };
  };

  const background = body.background === true;
  if (background && (globalThis as any).EdgeRuntime?.waitUntil) {
    (globalThis as any).EdgeRuntime.waitUntil(run());
    return new Response(JSON.stringify({ ok: true, accepted: true, mode: "background", types }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify(await run()), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
