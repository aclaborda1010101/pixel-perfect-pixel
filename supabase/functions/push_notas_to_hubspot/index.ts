// push_notas_to_hubspot — sube notas simples ya vinculadas a un edificio como
// engagement note en el deal de HubSpot correspondiente, adjuntando el PDF
// original (hs_attachment_ids = fileId). Idempotente: marca structured_json.pushed_to_hubspot='1'.
//
// Estrategia:
// 1) Lote de 25 notas con building_id NOT NULL y no marcadas como pushed/fuera_universo,
//    ordenadas por buildings.score_total DESC.
// 2) Para cada deal, cargar notas asociadas del espejo hubspot_notes; consultar al vuelo
//    hs_attachment_ids en HubSpot para saber si el fileId ya está adjunto.
// 3) Si no está, POST /crm/v3/objects/notes con associations al deal (typeId 214) y adjunto.
// 4) Marcar structured_json.pushed_to_hubspot='1'. 403 → log y stop.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "push_notas_to_hubspot";
const DEFAULT_BATCH = 25;

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
  const batchSize = Math.max(1, Math.min(50, Number(body.batch ?? DEFAULT_BATCH)));
  const t0 = Date.now();

  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { batch: batchSize } })
    .select("id").single();
  const logId = logRow?.id;

  let created = 0, skipped = 0, failed = 0, stopped403 = false;
  const errors: any[] = [];

  try {
    // 1) Candidatos: notas con building_id, no marcadas
    // usamos rango grande + join en app-side por simplicidad
    const { data: cand, error: candErr } = await sb.from("notas_simples")
      .select("id, file_url, building_id, structured_json, buildings:building_id(score_total)")
      .not("building_id", "is", null)
      .limit(batchSize * 6);
    if (candErr) throw candErr;

    const filtered = (cand || []).filter((r: any) => {
      const sj = r.structured_json || {};
      if (sj.pushed_to_hubspot === "1" || sj.pushed_to_hubspot === 1 || sj.pushed_to_hubspot === true) return false;
      if (sj.fuera_universo === "1" || sj.fuera_universo === true) return false;
      if (!extractFileId(r.file_url)) return false;
      return true;
    }).sort((a: any, b: any) => {
      const sa = Number(a?.buildings?.score_total ?? -1);
      const sb2 = Number(b?.buildings?.score_total ?? -1);
      return sb2 - sa;
    }).slice(0, batchSize);

    if (!filtered.length) {
      await sb.from("hubspot_sync_log").update({
        finished_at: new Date().toISOString(), status: "ok",
        records_upserted: 0, metadatos: { batch: batchSize, message: "no_candidates" },
      }).eq("id", logId);
      return new Response(JSON.stringify({ ok: true, message: "no_candidates", elapsed_ms: Date.now() - t0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2) Resolver dealId por edificio
    const buildingIds = Array.from(new Set(filtered.map((r: any) => r.building_id)));
    const { data: ext } = await sb.from("external_ids")
      .select("entity_id, provider_id")
      .eq("entity_type", "building").eq("provider", "hubspot")
      .in("entity_id", buildingIds);
    const buildingToDeal = new Map<string, string>();
    for (const r of ext || []) buildingToDeal.set(String(r.entity_id), String(r.provider_id));

    // 3) Para cada deal implicado, cargar notas espejo con ese deal
    const dealIds = Array.from(new Set(filtered.map((r: any) => buildingToDeal.get(String(r.building_id))).filter(Boolean))) as string[];
    const dealToNoteIds = new Map<string, string[]>();
    if (dealIds.length) {
      const { data: mirror } = await sb.from("hubspot_notes")
        .select("hs_id, associated_deal_ids")
        .overlaps("associated_deal_ids", dealIds);
      for (const n of mirror || []) {
        const nid = String((n as any).hs_id);
        for (const d of ((n as any).associated_deal_ids || [])) {
          const ds = String(d);
          if (!dealIds.includes(ds)) continue;
          if (!dealToNoteIds.has(ds)) dealToNoteIds.set(ds, []);
          dealToNoteIds.get(ds)!.push(nid);
        }
      }
    }

    // Fetch attachment ids for each of those notes (concurrencia moderada)
    const noteAttachmentsCache = new Map<string, string[]>();
    const allNoteIds = Array.from(new Set(Array.from(dealToNoteIds.values()).flat()));
    const conc = 5;
    for (let i = 0; i < allNoteIds.length; i += conc) {
      const slice = allNoteIds.slice(i, i + conc);
      await Promise.all(slice.map(async (nid) => {
        try {
          const r = await hubspotFetch(`/crm/v3/objects/notes/${nid}?properties=hs_attachment_ids`);
          noteAttachmentsCache.set(nid, splitAttachmentIds(r?.properties?.hs_attachment_ids));
        } catch { noteAttachmentsCache.set(nid, []); }
      }));
    }

    // 4) Procesar cada nota
    for (const nota of filtered) {
      if (stopped403) break;
      const fileId = extractFileId(nota.file_url)!;
      const dealId = buildingToDeal.get(String(nota.building_id));
      if (!dealId) { skipped++; continue; }

      // Ya adjunto?
      const notesOfDeal = dealToNoteIds.get(dealId) || [];
      const already = notesOfDeal.some((nid) => (noteAttachmentsCache.get(nid) || []).includes(fileId));
      if (already) {
        // Marcar como pushed para no re-evaluar
        const merged = { ...(nota.structured_json || {}), pushed_to_hubspot: "1", pushed_at: new Date().toISOString(), pushed_reason: "already_attached" };
        await sb.from("notas_simples").update({ structured_json: merged }).eq("id", nota.id);
        skipped++;
        continue;
      }

      // Crear nota vía HubSpot
      try {
        const payload = {
          properties: {
            hs_timestamp: new Date().toISOString(),
            hs_note_body: "Nota simple vinculada automáticamente por AffluxOS (verdad registral)",
            hs_attachment_ids: fileId,
          },
          associations: [
            { to: { id: dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 214 }] },
          ],
        };
        const created_note = await hubspotFetch(`/crm/v3/objects/notes`, {
          method: "POST", body: JSON.stringify(payload),
        });
        const newNoteId = created_note?.id ? String(created_note.id) : null;
        const merged = {
          ...(nota.structured_json || {}),
          pushed_to_hubspot: "1",
          pushed_at: new Date().toISOString(),
          pushed_note_id: newNoteId,
        };
        await sb.from("notas_simples").update({ structured_json: merged }).eq("id", nota.id);
        created++;
      } catch (e: any) {
        const msg = String(e?.message ?? e);
        failed++;
        errors.push({ nota_id: nota.id, deal_id: dealId, error: msg });
        console.error(`[push_notas_to_hubspot] fail nota=${nota.id} deal=${dealId}: ${msg}`);
        if (msg.includes("403") || /MISSING_SCOPES/i.test(msg)) {
          stopped403 = true;
          break;
        }
      }
    }

    const status = stopped403 ? "error" : "ok";
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status,
      records_upserted: created, records_failed: failed,
      error_message: stopped403 ? "HTTP 403 / MISSING_SCOPES — cron pausado" : null,
      metadatos: { batch: batchSize, created, skipped, failed, stopped403, errors: errors.slice(0, 20) },
    }).eq("id", logId);

    return new Response(JSON.stringify({
      ok: !stopped403, created, skipped, failed, stopped403,
      errors: errors.slice(0, 20), elapsed_ms: Date.now() - t0,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[push_notas_to_hubspot] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error", error_message: msg,
      records_upserted: created, records_failed: failed,
    }).eq("id", logId);
    return new Response(JSON.stringify({ ok: false, error: msg, created, failed }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});