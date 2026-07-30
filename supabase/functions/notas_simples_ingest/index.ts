// notas_simples_ingest — escanea TODAS las notas HubSpot con hs_attachment_ids
// (sin filtro de fecha por defecto) y descarga los PDFs que aún no existan en
// notas_simples.file_url ('hs_<fileId>.pdf'). Ignora
// adjuntos no-PDF (vídeos, imágenes). Inserta filas con status='listo' y
// structured_json.needs_extract='1' para que notas_simples_reparse las procese.
//
// Cursor: hubspot_sync_state.entity='notas_simples_ingest' (informativo; solo se
// usa si se llama con { full_scan: false }).
// Log: hubspot_sync_log.entity='notas_simples_ingest'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";
import { hubspotFetch, corsHeaders } from "../_shared/hubspot.ts";

const ENTITY = "notas_simples_ingest";
const DEFAULT_PAGES = 60;
const DEFAULT_PAGE_LIMIT = 100;
const INITIAL_SINCE_ISO = "2026-05-11T00:00:00.000Z"; // fecha del último import masivo

function splitAttachmentIds(v: unknown): string[] {
  if (v == null) return [];
  return String(v).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const pages: number = Math.max(1, Math.min(300, Number(body.pages ?? DEFAULT_PAGES)));
  const pageLimit: number = Math.max(10, Math.min(100, Number(body.page_limit ?? DEFAULT_PAGE_LIMIT)));
  const resetCursor: boolean = body.reset_cursor === true;
  // Por defecto barrido completo: hay notas con adjunto de 2025 nunca descargadas.
  const fullScan: boolean = body.full_scan !== false;

  const t0 = Date.now();

  await sb.from("hubspot_sync_state").upsert({ entity: ENTITY }, { onConflict: "entity" });
  if (resetCursor) {
    await sb.from("hubspot_sync_state").update({ cursor: null, metadatos: {} }).eq("entity", ENTITY);
  }
  const { data: state } = await sb.from("hubspot_sync_state").select("cursor, metadatos").eq("entity", ENTITY).single();
  const sinceIso: string = state?.cursor ?? INITIAL_SINCE_ISO;
  const sinceMs = new Date(sinceIso).getTime();
  const prevMeta: any = (state?.metadatos as any) ?? {};
  // Reanudación del barrido completo: guardamos el último hs_createdate procesado.
  const scanCursor: string | null = resetCursor ? null : (prevMeta.scan_cursor ?? null);
  const scanMs: number | null = scanCursor ? new Date(scanCursor).getTime() : null;

  const { data: logRow } = await sb.from("hubspot_sync_log")
    .insert({ entity: ENTITY, status: "running", metadatos: { since: fullScan ? null : sinceIso, full_scan: fullScan } })
    .select("id").single();
  const logId = logRow?.id;

  let pagesFetched = 0;
  let notesScanned = 0;
  let fetched = 0;      // GET /files/v3/files/{id}
  let pdfs = 0;         // extension === pdf
  let insertados = 0;
  let saltadosNoPdf = 0;
  let yaExisten = 0;
  let errores403 = 0;
  let maxSeen = sinceIso;
  let after: string | undefined;
  const primeros403: string[] = [];

  try {
    for (let p = 0; p < pages; p++) {
      const filters: any[] = [{ propertyName: "hs_attachment_ids", operator: "HAS_PROPERTY" }];
      if (fullScan) {
        if (scanMs != null) {
          filters.push({ propertyName: "hs_createdate", operator: "GT", value: String(scanMs) });
        }
      } else {
        filters.push({ propertyName: "hs_createdate", operator: "GT", value: String(sinceMs) });
      }
      const searchBody: any = {
        filterGroups: [{ filters }],
        sorts: [{ propertyName: "hs_createdate", direction: "ASCENDING" }],
        properties: ["hs_attachment_ids", "hs_createdate"],
        limit: pageLimit,
      };
      if (after) searchBody.after = after;

      const data = await hubspotFetch(`/crm/v3/objects/notes/search`, {
        method: "POST", body: JSON.stringify(searchBody),
      });
      pagesFetched++;
      const results: any[] = data?.results || [];
      if (!results.length) { scanExhausted = true; break; }

      // 1) Junta todos los fileIds candidatos de la página
      const noteFiles: Array<{ noteId: string; fileIds: string[]; createdate: string | null }> = [];
      const allFileIds = new Set<string>();
      for (const n of results) {
        notesScanned++;
        const cd = n?.properties?.hs_createdate ?? null;
        if (cd) {
          const iso = new Date(cd).toISOString();
          if (iso > maxSeen) maxSeen = iso;
        }
        const ids = splitAttachmentIds(n?.properties?.hs_attachment_ids);
        if (!ids.length) continue;
        noteFiles.push({ noteId: String(n.id), fileIds: ids, createdate: cd });
        for (const f of ids) allFileIds.add(f);
      }

      // 2) ¿Cuáles ya están en notas_simples?
      const existingSet = new Set<string>();
      if (allFileIds.size) {
        const urls = [...allFileIds].map((f) => `hs_${f}.pdf`);
        const { data: existing } = await sb.from("notas_simples")
          .select("file_url").in("file_url", urls);
        for (const r of existing ?? []) {
          const m = String((r as any).file_url ?? "").match(/hs_([0-9]+)\.pdf/i);
          if (m) existingSet.add(m[1]);
        }
      }

      // 3) Procesa cada note → fileIds no existentes
      for (const nf of noteFiles) {
        const missing = nf.fileIds.filter((f) => !existingSet.has(f));
        if (!missing.length) { yaExisten += nf.fileIds.length; continue; }

        // Asociaciones a deals para resolver building_id
        let dealIds: string[] = [];
        try {
          const full = await hubspotFetch(`/crm/v3/objects/notes/${nf.noteId}?associations=deals`);
          dealIds = (full?.associations?.deals?.results || []).map((r: any) => String(r.id));
        } catch { /* opcional */ }

        let buildingId: string | null = null;
        if (dealIds.length) {
          const { data: ext } = await sb.from("external_ids")
            .select("entity_id, provider_id")
            .eq("entity_type", "building").eq("provider", "hubspot")
            .in("provider_id", dealIds);
          buildingId = (ext?.[0] as any)?.entity_id ?? null;
        }

        for (const fileId of missing) {
          existingSet.add(fileId); // evita reprocesar en la misma página
          try {
            fetched++;
            const meta = await hubspotFetch(`/files/v3/files/${fileId}`);
            const ext = String(meta?.extension ?? "").toLowerCase();
            if (ext !== "pdf") { saltadosNoPdf++; continue; }
            pdfs++;

            // Signed URL (endpoint específico)
            let signed: any = null;
            try {
              signed = await hubspotFetch(`/files/v3/files/${fileId}/signed-url`);
            } catch (e) {
              console.warn(`[ingest] signed-url ${fileId}: ${(e as Error).message}`);
            }
            const url: string | undefined = signed?.url ?? meta?.url;
            if (!url) { console.warn(`[ingest] sin URL para ${fileId}`); continue; }

            const r = await fetch(url);
            if (!r.ok) { console.warn(`[ingest] download ${fileId} ${r.status}`); continue; }
            const pdfBytes = new Uint8Array(await r.arrayBuffer());

            const objectPath = `hs_${fileId}.pdf`;
            const { error: upErr } = await sb.storage.from("notas-simples")
              .upload(objectPath, pdfBytes, { contentType: "application/pdf", upsert: true });
            if (upErr) { console.warn(`[ingest] upload ${fileId}: ${upErr.message}`); continue; }

            const { error: insErr } = await sb.from("notas_simples").insert({
              file_url: objectPath,
              status: "listo",
              building_id: buildingId,
              structured_json: { needs_extract: "1", origen: "hs_ingest", hs_note_id: nf.noteId, hs_file_id: fileId },
            });
            if (insErr) {
              console.warn(`[ingest] insert ${fileId}: ${insErr.message}`);
              continue;
            }
            insertados++;
          } catch (e: any) {
            const msg = String(e?.message ?? e);
            if (msg.includes("403")) {
              errores403++;
              if (primeros403.length < 3) primeros403.push(`${fileId}: ${msg.slice(0, 300)}`);
              // No reintentar en bucle: aborta el resto de la página
              throw new Error(`FILES_403: ${msg}`);
            }
            console.warn(`[ingest] file ${fileId}: ${msg.slice(0, 200)}`);
          }
        }
      }

      after = data?.paging?.next?.after;
      if (!after) { scanExhausted = true; break; }
    }

    const finishedAt = new Date().toISOString();
    await sb.from("hubspot_sync_log").update({
      finished_at: finishedAt, status: "ok",
      pages_fetched: pagesFetched, records_upserted: insertados, records_failed: errores403,
      metadatos: {
        since: sinceIso, since_after: maxSeen,
        notes_scanned: notesScanned, fetched, pdfs, insertados,
        saltados_no_pdf: saltadosNoPdf, ya_existen: yaExisten,
      },
    }).eq("id", logId);

    await sb.from("hubspot_sync_state").update({
      last_run_status: "ok", last_run_at: finishedAt,
      cursor: maxSeen, last_error: null,
      metadatos: { insertados, pdfs, saltados_no_pdf: saltadosNoPdf, full_scan: fullScan, notes_scanned: notesScanned },
    }).eq("entity", ENTITY);

    return new Response(JSON.stringify({
      ok: true, pages_fetched: pagesFetched, notes_scanned: notesScanned,
      fetched, pdfs, insertados, saltados_no_pdf: saltadosNoPdf, ya_existen: yaExisten,
      since: sinceIso, since_after: maxSeen, elapsed_ms: Date.now() - t0,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    console.error(`[notas_simples_ingest] error: ${msg}`);
    await sb.from("hubspot_sync_log").update({
      finished_at: new Date().toISOString(), status: "error",
      pages_fetched: pagesFetched, records_upserted: insertados,
      error_message: msg,
      metadatos: { primeros_403: primeros403, notes_scanned: notesScanned, fetched, pdfs, insertados, saltados_no_pdf: saltadosNoPdf },
    }).eq("id", logId);
    await sb.from("hubspot_sync_state").update({ last_run_status: "error", last_error: msg }).eq("entity", ENTITY);
    return new Response(JSON.stringify({ ok: false, error: msg, insertados, primeros_403: primeros403 }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});