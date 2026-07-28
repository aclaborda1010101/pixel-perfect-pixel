// hubspot_contacts_inc — sync incremental de CONTACTS de HubSpot.
// Detecta contactos nuevos/modificados desde el cursor (entity 'contacts_inc'),
// y para los que YA están mapeados a un owner (external_ids owner→contact),
// refresca campos vacíos y hace merge en owners.metadatos.
// Los contactos SIN mapping se dejan al flujo link_orphan_contacts (no crea owners aquí).
//
// Params: { pages?: number, since_iso?: string, fallback_days?: number }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders, CONTACT_PROPERTIES } from "../_shared/hubspot.ts";

const ENTITY = "contacts_inc";
const PAGE_LIMIT = 100;
const DEFAULT_PAGES = 20;

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
  let pagesFetched = 0, seen = 0, mappedUpdated = 0, unmapped = 0, maxSeenIso = sinceIso;

  try {
    for (let p = 0; p < pages; p++) {
      const searchBody: any = {
        filterGroups: [{ filters: [{ propertyName: "lastmodifieddate", operator: "GT", value: String(sinceMs) }] }],
        sorts: [{ propertyName: "lastmodifieddate", direction: "ASCENDING" }],
        properties: CONTACT_PROPERTIES,
        limit: PAGE_LIMIT,
      };
      if (after) searchBody.after = after;
      const data = await hubspotFetch(`/crm/v3/objects/contacts/search`, { method: "POST", body: JSON.stringify(searchBody) });
      pagesFetched++;
      const results: any[] = data?.results || [];
      if (!results.length) break;

      const hsIds = results.map((r) => String(r.id));
      const { data: ext } = await sb.from("external_ids")
        .select("entity_id, provider_id")
        .eq("entity_type", "owner").eq("provider", "hubspot").eq("provider_object_type", "contact")
        .in("provider_id", hsIds);
      const contactToOwner = new Map<string, string>();
      for (const r of ext ?? []) contactToOwner.set(String(r.provider_id), String(r.entity_id));

      for (const c of results) {
        seen++;
        const props = c.properties || {};
        const lm = tsOrNull(props.lastmodifieddate) || tsOrNull(c.updatedAt);
        if (lm && lm > maxSeenIso) maxSeenIso = lm;

        const ownerId = contactToOwner.get(String(c.id));
        if (!ownerId) { unmapped++; continue; }

        // Cargar el owner existente para no pisar datos con valores vacíos
        const { data: own } = await sb.from("owners")
          .select("id, nombre, email, telefono, metadatos, last_synced_at")
          .eq("id", ownerId).maybeSingle();
        if (!own) continue;

        const patch: Record<string, any> = { last_synced_at: new Date().toISOString() };
        const fullName = [props.firstname, props.lastname].filter(Boolean).join(" ").trim();
        if (!own.nombre && fullName) patch.nombre = fullName;
        if (!own.email && props.email) patch.email = String(props.email).trim();
        if (!own.telefono && (props.phone || props.mobilephone)) patch.telefono = String(props.phone || props.mobilephone).trim();

        // Merge metadatos: guardamos las propiedades bajo hubspot.<prop>
        const nextMeta = { ...(own.metadatos ?? {}) };
        nextMeta.hubspot = { ...(nextMeta.hubspot ?? {}), ...props };
        nextMeta.hubspot._last_inc_at = new Date().toISOString();
        patch.metadatos = nextMeta;

        const { error: upErr } = await sb.from("owners").update(patch).eq("id", ownerId);
        if (upErr) console.error(`[contacts_inc] update ${ownerId} fail: ${upErr.message}`);
        else mappedUpdated++;
      }

      after = data?.paging?.next?.after;
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    await sb.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: pagesFetched, records_upserted: mappedUpdated,
      metadatos: { since: sinceIso, since_after: maxSeenIso, seen, mapped_updated: mappedUpdated, unmapped },
    }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({
      last_run_status: "ok", last_run_at: finishedAt,
      cursor: maxSeenIso, last_error: null,
      metadatos: { ...meta, since_ts: maxSeenIso, last_seen: seen, last_updated: mappedUpdated, last_unmapped: unmapped },
    }).eq("entity", ENTITY);

    return new Response(JSON.stringify({ ok: true, pages_fetched: pagesFetched, seen, mapped_updated: mappedUpdated, unmapped, since: sinceIso, since_after: maxSeenIso, elapsed_ms: Date.now() - t0 }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[contacts_inc] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({ finished_at: new Date().toISOString(), status: "error", pages_fetched: pagesFetched, records_upserted: mappedUpdated, error_message: msg }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({ last_run_status: "error", last_error: msg }).eq("entity", ENTITY);
    return new Response(JSON.stringify({ ok: false, error: msg, pages_fetched: pagesFetched, seen }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});