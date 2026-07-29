// hubspot_companies_inc — sync incremental de COMPANIES por hs_lastmodifieddate.
// Casa contra external_ids (provider='hubspot', object_type='company') o por CIF.
// Solo actualiza filas ya existentes en public.companies; las no mapeadas se
// registran en hubspot_sync_log (metadatos.unmapped_ids) pero NO se crean filas nuevas.
//
// Params: { pages?: number, since_iso?: string, fallback_days?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "companies_inc";
const PAGE_LIMIT = 100;
const DEFAULT_PAGES = 10;

const PROPS = [
  "name", "domain", "phone", "createdate", "hs_lastmodifieddate",
  "cif", "dni__nif__cif",
];

function tsOrNull(v: any): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const pages: number = Math.max(1, Math.min(50, body.pages ?? DEFAULT_PAGES));
  const fallbackDays: number = body.fallback_days ?? 7;

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
  let pagesFetched = 0, seen = 0, updated = 0, unmapped = 0, maxSeenIso = sinceIso;
  const unmappedIds: string[] = [];

  try {
    for (let p = 0; p < pages; p++) {
      const searchBody: any = {
        filterGroups: [{ filters: [{ propertyName: "hs_lastmodifieddate", operator: "GT", value: String(sinceMs) }] }],
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
        properties: PROPS,
        limit: PAGE_LIMIT,
      };
      if (after) searchBody.after = after;
      const data = await hubspotFetch(`/crm/v3/objects/companies/search`, { method: "POST", body: JSON.stringify(searchBody) });
      pagesFetched++;
      const results: any[] = data?.results || [];
      if (!results.length) break;

      const hsIds = results.map((r) => String(r.id));
      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "company").eq("provider", "hubspot").eq("provider_object_type", "company")
        .in("provider_id", hsIds);
      const byHsId = new Map<string, string>();
      for (const r of ext ?? []) byHsId.set(String(r.provider_id), String(r.entity_id));

      // Fallback: match por CIF
      const cifsToLookup = results
        .filter((c) => !byHsId.has(String(c.id)))
        .map((c) => (c.properties?.cif || c.properties?.dni__nif__cif || "").trim())
        .filter(Boolean);
      const cifMap = new Map<string, string>();
      if (cifsToLookup.length) {
        const { data: byCif } = await sb.from("companies").select("id, cif").in("cif", cifsToLookup);
        for (const r of byCif ?? []) if (r.cif) cifMap.set(String(r.cif), String(r.id));
      }

      for (const c of results) {
        seen++;
        const props = c.properties || {};
        const lm = tsOrNull(props.hs_lastmodifieddate) || tsOrNull(c.updatedAt);
        if (lm && lm > maxSeenIso) maxSeenIso = lm;

        let companyId = byHsId.get(String(c.id));
        const cif = (props.cif || props.dni__nif__cif || "").trim() || null;
        if (!companyId && cif && cifMap.has(cif)) companyId = cifMap.get(cif);

        if (!companyId) {
          unmapped++;
          if (unmappedIds.length < 100) unmappedIds.push(String(c.id));
          continue;
        }

        // Merge metadatos preservando lo existente
        const { data: existing } = await sb.from("companies").select("metadatos, nombre, telefono, cif").eq("id", companyId).maybeSingle();
        const nextMeta = { ...(existing?.metadatos ?? {}) };
        nextMeta.hubspot = { ...(nextMeta.hubspot ?? {}), ...props, _hubspot_company_id: c.id, _last_inc_at: new Date().toISOString() };

        const patch: Record<string, any> = {
          metadatos: nextMeta,
          last_synced_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        if (!existing?.nombre && (props.name || props.domain)) patch.nombre = (props.name || props.domain).trim();
        if (!existing?.telefono && props.phone) patch.telefono = String(props.phone).trim();
        if (!existing?.cif && cif) patch.cif = cif;

        const { error: upErr } = await sb.from("companies").update(patch).eq("id", companyId);
        if (upErr) console.error(`[companies_inc] update ${companyId} fail: ${upErr.message}`);
        else updated++;
      }

      after = data?.paging?.next?.after;
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await sb.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: pagesFetched, records_upserted: updated,
      metadatos: { since: sinceIso, since_after: maxSeenIso, seen, updated, unmapped, unmapped_ids: unmappedIds },
    }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({
      last_run_status: "ok", last_run_at: finishedAt,
      cursor: maxSeenIso, last_error: null,
      metadatos: { ...meta, since_ts: maxSeenIso, last_seen: seen, last_updated: updated, last_unmapped: unmapped },
    }).eq("entity", ENTITY);

    return new Response(JSON.stringify({ ok: true, pages_fetched: pagesFetched, seen, updated, unmapped, since: sinceIso, since_after: maxSeenIso }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[companies_inc] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({ finished_at: new Date().toISOString(), status: "error", pages_fetched: pagesFetched, records_upserted: updated, error_message: msg }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({ last_run_status: "error", last_error: msg }).eq("entity", ENTITY);
    return new Response(JSON.stringify({ ok: false, error: msg, pages_fetched: pagesFetched, seen, updated }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});