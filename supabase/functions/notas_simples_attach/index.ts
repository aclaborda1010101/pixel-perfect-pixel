// notas_simples_attach — vincula notas_simples.building_id NULL a un edificio
// resolviendo fileId → HubSpot note (hs_attachment_ids) → deal asociado →
// external_ids (entity_type='building', provider='hubspot', provider_id=deal).
//
// Estrategia:
//   1) Recolectamos fileIds pendientes desde notas_simples.file_url ('hs_<fileId>.pdf').
//   2) Recorremos engagement notes vía search (hs_attachment_ids HAS_PROPERTY,
//      ordenadas por hs_lastmodifieddate ASC desde cursor), pidiendo la propiedad
//      hs_attachment_ids y las asociaciones a deals.
//   3) Para cada note construimos mapa fileId → dealIds. Cruzamos con external_ids
//      para obtener building_id y hacemos UPDATE en notas_simples.
//
// Params: { pages?: number, page_limit?: number, reset_cursor?: boolean }
// Registro: hubspot_sync_log (entity='notas_simples_attach') y hubspot_sync_state.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "notas_simples_attach";
const DEFAULT_PAGES = 40;
const DEFAULT_PAGE_LIMIT = 100;

function extractFileId(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const m = String(fileUrl).match(/hs_([0-9]+)\.pdf/i);
  return m ? m[1] : null;
}

function splitAttachmentIds(v: unknown): string[] {
  if (v == null) return [];
  return String(v).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const SUP = Deno.env.get("SUPABASE_URL")!;
  const SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUP, SR);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const pages: number = Math.max(1, Math.min(200, Number(body.pages ?? DEFAULT_PAGES)));
  const pageLimit: number = Math.max(10, Math.min(100, Number(body.page_limit ?? DEFAULT_PAGE_LIMIT)));
  const resetCursor: boolean = body.reset_cursor === true;

  const t0 = Date.now();

  // 1) Recolectar fileIds pendientes (notas sin building_id)
  const pending = new Map<string, string[]>(); // fileId → nota_ids
  {
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("notas_simples")
        .select("id, file_url")
        .is("building_id", null)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || !data.length) break;
      for (const r of data) {
        const fid = extractFileId(r.file_url as any);
        if (!fid) continue;
        if (!pending.has(fid)) pending.set(fid, []);
        pending.get(fid)!.push(String(r.id));
      }
      if (data.length < PAGE) break;
    }
  }

  const initialPending = pending.size;
  await sb.from("hubspot_sync_state").upsert({ entity: ENTITY }, { onConflict: "entity" });
  if (resetCursor) {
    await sb.from("hubspot_sync_state").update({ cursor: null, metadatos: {} }).eq("entity", ENTITY);
  }
  const { data: state } = await sb.from("hubspot_sync_state").select("cursor, metadatos").eq("entity", ENTITY).single();
  const sinceIso: string = state?.cursor ?? new Date(0).toISOString();
  const sinceMs = new Date(sinceIso).getTime();

  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { since: sinceIso, initial_pending: initialPending } })
    .select("id").single();
  const logId = logRow?.id;

  let pagesFetched = 0, notesScanned = 0, attached = 0, notesWithoutDeal = 0;
  let after: string | undefined;
  let maxSeen = sinceIso;

  try {
    for (let p = 0; p < pages; p++) {
      if (pending.size === 0) break; // ya no queda nada pendiente
      const searchBody: any = {
        filterGroups: [{ filters: [
          { propertyName: "hs_attachment_ids", operator: "HAS_PROPERTY" },
          { propertyName: "hs_lastmodifieddate", operator: "GT", value: String(sinceMs) },
        ] }],
        sorts: [{ propertyName: "hs_lastmodifieddate", direction: "ASCENDING" }],
        properties: ["hs_attachment_ids", "hs_lastmodifieddate", "hs_timestamp"],
        limit: pageLimit,
      };
      if (after) searchBody.after = after;

      const data = await hubspotFetch(`/crm/v3/objects/notes/search`, {
        method: "POST", body: JSON.stringify(searchBody),
      });
      pagesFetched++;
      const results: any[] = data?.results || [];
      if (!results.length) break;

      // Para cada note, GET con associations=deals (concurrencia moderada)
      const conc = 5;
      for (let i = 0; i < results.length; i += conc) {
        const slice = results.slice(i, i + conc);
        await Promise.all(slice.map(async (n: any) => {
          notesScanned++;
          const lm = n?.properties?.hs_lastmodifieddate ?? null;
          if (lm) {
            const iso = new Date(lm).toISOString();
            if (iso > maxSeen) maxSeen = iso;
          }
          const attIds = splitAttachmentIds(n?.properties?.hs_attachment_ids);
          const matchedFileIds = attIds.filter((fid) => pending.has(fid));
          if (!matchedFileIds.length) return; // note irrelevante para nuestro backlog

          let dealIds: string[] = [];
          try {
            const full = await hubspotFetch(`/crm/v3/objects/notes/${n.id}?associations=deals`);
            dealIds = (full?.associations?.deals?.results || []).map((r: any) => String(r.id));
          } catch { /* red opcional */ }

          if (!dealIds.length) { notesWithoutDeal++; return; }

          // deal → building_id via external_ids
          const { data: ext } = await sb.from("external_ids")
            .select("entity_id, provider_id")
            .eq("entity_type", "building").eq("provider", "hubspot")
            .in("provider_id", dealIds);
          const buildingId = ext?.[0]?.entity_id;
          if (!buildingId) return;

          for (const fid of matchedFileIds) {
            const notaIds = pending.get(fid) || [];
            if (!notaIds.length) continue;
            const { error: upErr } = await sb.from("notas_simples")
              .update({ building_id: buildingId })
              .in("id", notaIds)
              .is("building_id", null);
            if (!upErr) {
              attached += notaIds.length;
              pending.delete(fid);
            } else {
              console.error(`[notas_simples_attach] update fail file=${fid}: ${upErr.message}`);
            }
          }
        }));
      }

      after = data?.paging?.next?.after;
      if (!after) break;
    }

    const finishedAt = new Date().toISOString();
    const remaining = pending.size;
    await sb.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: pagesFetched, records_upserted: attached, records_failed: 0,
      metadatos: { since: sinceIso, since_after: maxSeen, notes_scanned: notesScanned, attached, notes_without_deal: notesWithoutDeal, initial_pending: initialPending, remaining_pending: remaining },
    }).eq("id", logId);

    await sb.from("hubspot_sync_state").update({
      last_run_status: "ok", last_run_at: finishedAt,
      cursor: maxSeen,
      last_error: null,
      metadatos: { last_attached: attached, last_scanned: notesScanned, initial_pending: initialPending, remaining_pending: remaining },
    }).eq("entity", ENTITY);

    return new Response(JSON.stringify({
      ok: true, pages_fetched: pagesFetched, notes_scanned: notesScanned,
      attached, notes_without_deal: notesWithoutDeal,
      initial_pending: initialPending, remaining_pending: remaining,
      since: sinceIso, since_after: maxSeen, elapsed_ms: Date.now() - t0,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[notas_simples_attach] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error",
      pages_fetched: pagesFetched, records_upserted: attached,
      error_message: msg,
    }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({ last_run_status: "error", last_error: msg }).eq("entity", ENTITY);
    return new Response(JSON.stringify({ ok: false, error: msg, attached, pages_fetched: pagesFetched }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});