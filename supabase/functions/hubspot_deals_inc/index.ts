// hubspot_deals_inc — sync incremental de DEALS de HubSpot.
// Detecta deals nuevos/modificados desde el cursor (entity 'deals_inc'),
// upsert idempotente en public.hubspot_deals con associations=contacts.
// NO crea buildings ni owners. Tras cada lote intenta ejecutar
// public.sync_links_from_deals() (opcional, envuelto en try/catch).
//
// Params: { pages?: number, since_iso?: string, fallback_days?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "deals_inc";
const TABLE = "hubspot_deals";
const PAGE_LIMIT = 100;
const DEFAULT_PAGES = 20;

const DEAL_PROPS = [
  "dealname", "dealstage", "pipeline", "hubspot_owner_id",
  "amount", "closedate", "createdate", "hs_lastmodifieddate",
  "cobertura_del_edificio", "n_total_de_copropietarios",
];

function tsOrNull(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function numOrNull(v: any): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchContactIds(id: string): Promise<string[]> {
  try {
    const j = await hubspotFetch(`/crm/v3/objects/deals/${id}?associations=contacts`);
    const arr = j?.associations?.contacts?.results || [];
    return arr.map((r: any) => String(r.id));
  } catch { return []; }
}

function toRow(e: any, contactIds: string[]) {
  const p = e.properties || {};
  return {
    hs_id: String(e.id),
    dealname: p.dealname || null,
    dealstage: p.dealstage || null,
    pipeline: p.pipeline || null,
    hs_owner_id: p.hubspot_owner_id || null,
    amount: numOrNull(p.amount),
    closedate: tsOrNull(p.closedate),
    hs_createdate: tsOrNull(p.createdate ?? e.createdAt),
    hs_lastmodifieddate: tsOrNull(p.hs_lastmodifieddate ?? e.updatedAt),
    cobertura_del_edificio: p.cobertura_del_edificio || null,
    n_total_de_copropietarios: p.n_total_de_copropietarios || null,
    associated_contact_ids: contactIds,
    raw: e,
    updated_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const pages: number = Math.max(1, Math.min(80, body.pages ?? DEFAULT_PAGES));
  const fallbackDays: number = body.fallback_days ?? 7;
  const t0 = Date.now();

  await sb.from("hubspot_sync_state").upsert({ entity: ENTITY }, { onConflict: "entity" });
  const { data: state } = await sb.from("hubspot_sync_state").select("metadatos, cursor").eq("entity", ENTITY).single();
  const meta = state?.metadatos ?? {};
  const sinceIso: string = body.since_iso ?? state?.cursor ?? meta?.since_ts ?? new Date(Date.now() - fallbackDays * 86400_000).toISOString();
  const sinceMs = new Date(sinceIso).getTime();

  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { since: sinceIso } }).select("id").single();
  const logId = logRow?.id;
  const runStartedAt = new Date().toISOString();
  await sb.from("hubspot_sync_state").update({ last_run_status: "running", last_run_at: runStartedAt, last_error: null }).eq("entity", ENTITY);

  let after: string | undefined;
  let pagesFetched = 0, seen = 0, upserted = 0, failed = 0, maxSeenIso = sinceIso;

  try {
    for (let p = 0; p < pages; p++) {
      const searchBody: any = {
        filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: String(sinceMs) }] }],
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
        properties: DEAL_PROPS,
        limit: PAGE_LIMIT,
      };
      if (after) searchBody.after = after;
      const data = await hubspotFetch(`/crm/v3/objects/deals/search`, { method: "POST", body: JSON.stringify(searchBody) });
      pagesFetched++;
      const results: any[] = data?.results || [];
      if (!results.length) break;

      // Enriquecer con contactos asociados (concurrencia 5)
      const contactsByIdx: string[][] = new Array(results.length);
      const concurrency = 5;
      for (let i = 0; i < results.length; i += concurrency) {
        const slice = results.slice(i, i + concurrency);
        const cs = await Promise.all(slice.map((e) => fetchContactIds(String(e.id))));
        for (let j = 0; j < slice.length; j++) contactsByIdx[i + j] = cs[j];
      }

      const rows = results.map((e, i) => toRow(e, contactsByIdx[i] || []));
      for (const r of rows) {
        const lm = r.hs_lastmodifieddate as string | null;
        if (lm && lm > maxSeenIso) maxSeenIso = lm;
      }
      seen += rows.length;
      const { error: upErr } = await sb.from(TABLE).upsert(rows, { onConflict: "hs_id" });
      if (upErr) { failed += rows.length; console.error(`[deals_inc] upsert err:`, upErr.message); }
      else upserted += rows.length;

      // Best-effort: reconciliar mapeos deal→edificio si la función existe
      try { await sb.rpc("sync_links_from_deals"); } catch (e) { /* opcional */ }

      after = data?.paging?.next?.after;
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await sb.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: pagesFetched, records_upserted: upserted, records_failed: failed,
      metadatos: { since: sinceIso, since_after: maxSeenIso, seen },
    }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({
      last_run_status: "ok", last_run_at: finishedAt,
      cursor: maxSeenIso, last_error: null,
      metadatos: { ...meta, since_ts: maxSeenIso, last_seen: seen, last_upserted: upserted },
    }).eq("entity", ENTITY);

    return new Response(JSON.stringify({ ok: true, pages_fetched: pagesFetched, seen, upserted, failed, since: sinceIso, since_after: maxSeenIso, elapsed_ms: Date.now() - t0 }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[deals_inc] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({ finished_at: new Date().toISOString(), status: "error", pages_fetched: pagesFetched, records_upserted: upserted, error_message: msg }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({ last_run_status: "error", last_error: msg }).eq("entity", ENTITY);
    return new Response(JSON.stringify({ ok: false, error: msg, pages_fetched: pagesFetched, seen, upserted }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});